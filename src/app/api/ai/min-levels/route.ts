/**
 * AI Min-Levels API Route (automagic 01 — the unlock)
 *
 * Proposes min_stock_level / reorder_point / reorder_qty for every stock item
 * from its real velocity + count history. The server:
 *   1. Refreshes mv_item_velocity + mv_low_stock_summary (rpc_refresh_min_level_views)
 *      so proposals use fresh numbers.
 *   2. Assembles per-item facts (rpc_min_level_facts): velocity, on-hand,
 *      count-variance, category, tracking_mode, last-paid unit cost.
 *   3. Applies a DETERMINISTIC FLOOR — an item with no movement history AND no
 *      count history gets a null proposal + "not enough history", never a
 *      hallucinated number.
 *   4. Batches the items with history through the model (one call per ~24 items)
 *      to classify each (steady / sporadic / serialized / dead) and propose
 *      min/reorder/qty with a one-line rationale.
 *
 * Nothing is written here — this route only proposes. Acceptance happens on the
 * explicit POST /api/inventory/min-levels call. Mirrors the OpenAI + GV pattern
 * of /api/ai/item-suggest.
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import OpenAI from 'openai';
import { getGVClient } from '@/lib/gv';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Serialized/individually-tracked assets don't carry a stock reorder point.
const NON_STOCK_TRACKING = new Set(['serialized']);

// How many items to hand the model in one call. 56 items → 2-3 calls, not 56.
const BATCH_SIZE = 24;

interface ItemFacts {
  catalog_item_id: string;
  sku: string;
  name: string;
  category_name: string | null;
  tracking_mode: string;
  uom_term_id: string | null;
  seasonal: boolean | null;
  last_event_id: string;
  current_reorder_point: number | null;
  current_min_stock_level: number | null;
  qty_on_hand: number;
  qty_available: number;
  usage_30d: number;
  usage_60d: number;
  usage_90d: number;
  daily_rate_30d: number;
  days_of_stock: number | null;
  movement_days: number;
  count_events: number;
  count_variance_abs: number;
  last_unit_cost: number | null;
}

type Classification = 'steady' | 'sporadic' | 'serialized' | 'dead';

interface Proposal {
  catalog_item_id: string;
  sku: string;
  name: string;
  category_name: string | null;
  uom_label: string | null;
  tracking_mode: string;
  last_event_id: string;
  qty_on_hand: number;
  qty_available: number;
  usage_30d: number;
  usage_90d: number;
  current_reorder_point: number | null;
  current_min_stock_level: number | null;
  // Proposal (null when there isn't enough history to responsibly propose).
  classification: Classification;
  min_stock_level: number | null;
  reorder_point: number | null;
  reorder_qty: number | null;
  rationale: string;
  // Distinguishes "we ran the model" from "we floored this to null pre-model".
  enough_history: boolean;
  // Loosely-tracked (estimate mode): the on-hand these levels reason from is an
  // estimate, so the wizard shows a "based on an estimate" caveat.
  loose_tracking: boolean;
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

// Effective daily consumption rate. Prefer the 30d window; fall back to the
// widest window that actually saw movement, so a burst 45 days ago isn't
// silently read as "zero usage".
function effectiveDailyRate(f: ItemFacts): number {
  if (f.usage_30d > 0) return f.usage_30d / 30;
  if (f.usage_60d > 0) return f.usage_60d / 60;
  if (f.usage_90d > 0) return f.usage_90d / 90;
  return 0;
}

function hasHistory(f: ItemFacts): boolean {
  return f.movement_days > 0 || f.usage_90d > 0 || f.count_events > 0;
}

export const POST = createSessionReadRoute(async ({ session, log }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw AppError.internal('AI proposals unavailable — OPENAI_API_KEY not configured.');
  }

  const tenantId = session.tenantId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  const inv = (supabase as any).schema('inventory');

  // 1. Freshen velocity (and the low-stock rollup) before reading facts.
  const { error: refreshErr } = await inv.rpc('rpc_refresh_min_level_views');
  if (refreshErr) {
    // Non-fatal: stale velocity still yields useful proposals. Log and continue.
    log.warn('min_levels.refresh_failed', { error: refreshErr.message });
  }

  // 2. Assemble facts.
  const { data: factsRaw, error: factsErr } = await inv.rpc('rpc_min_level_facts', {
    p_tenant_id: tenantId,
  });
  if (factsErr) throw AppError.internal(`Failed to assemble item facts: ${factsErr.message}`);

  const facts: ItemFacts[] = (factsRaw || []).map((r: any) => ({
    catalog_item_id: r.catalog_item_id,
    sku: r.sku,
    name: r.name,
    category_name: r.category_name ?? null,
    tracking_mode: r.tracking_mode,
    uom_term_id: r.uom_term_id ?? null,
    seasonal: r.seasonal ?? null,
    last_event_id: r.last_event_id,
    current_reorder_point: r.current_reorder_point != null ? num(r.current_reorder_point) : null,
    current_min_stock_level: r.current_min_stock_level != null ? num(r.current_min_stock_level) : null,
    qty_on_hand: num(r.qty_on_hand),
    qty_available: num(r.qty_available),
    usage_30d: num(r.usage_30d),
    usage_60d: num(r.usage_60d),
    usage_90d: num(r.usage_90d),
    daily_rate_30d: num(r.daily_rate_30d),
    days_of_stock: r.days_of_stock != null ? num(r.days_of_stock) : null,
    movement_days: num(r.movement_days),
    count_events: num(r.count_events),
    count_variance_abs: num(r.count_variance_abs),
    last_unit_cost: r.last_unit_cost != null ? num(r.last_unit_cost) : null,
  }));

  if (facts.length === 0) {
    return Response.json({ proposals: [], summary: { total: 0, proposed: 0, no_history: 0 } });
  }

  // Which of these items are loosely tracked — so the wizard can caveat any
  // level reasoned from an estimated on-hand. One cheap lookup; the facts RPC
  // doesn't carry the flag.
  const looseIds = new Set<string>();
  {
    const { data: looseRows } = await inv
      .from('catalog_items')
      .select('id')
      .eq('loose_tracking', true)
      .in('id', facts.map((f) => f.catalog_item_id))
      .limit(facts.length);
    for (const r of looseRows || []) looseIds.add((r as any).id);
  }

  // UOM labels for display (GV is a separate project — resolve via the SDK).
  let uomLabelMap: Record<string, string> = {};
  try {
    const gv = getGVClient();
    const rawMap = await gv.buildLabelMap(tenantId, 'uom');
    uomLabelMap = rawMap instanceof Map ? Object.fromEntries(rawMap) : (rawMap as Record<string, string>);
  } catch {
    uomLabelMap = {};
  }
  const uomLabel = (f: ItemFacts): string | null =>
    f.uom_term_id ? uomLabelMap[f.uom_term_id] || null : null;

  // 3. Deterministic floor — split items with usable history from the rest.
  const withHistory = facts.filter(hasHistory);
  const noHistory = facts.filter((f) => !hasHistory(f));

  const proposals: Proposal[] = [];

  for (const f of noHistory) {
    proposals.push({
      catalog_item_id: f.catalog_item_id,
      sku: f.sku,
      name: f.name,
      category_name: f.category_name,
      uom_label: uomLabel(f),
      tracking_mode: f.tracking_mode,
      last_event_id: f.last_event_id,
      qty_on_hand: f.qty_on_hand,
      qty_available: f.qty_available,
      usage_30d: f.usage_30d,
      usage_90d: f.usage_90d,
      current_reorder_point: f.current_reorder_point,
      current_min_stock_level: f.current_min_stock_level,
      classification: 'dead',
      min_stock_level: null,
      reorder_point: null,
      reorder_qty: null,
      rationale: 'Not enough usage or count history to propose a level yet.',
      enough_history: false,
      loose_tracking: looseIds.has(f.catalog_item_id),
    });
  }

  // 4. Batch the history items through the model.
  const openai = new OpenAI({ apiKey });
  const batches: ItemFacts[][] = [];
  for (let i = 0; i < withHistory.length; i += BATCH_SIZE) {
    batches.push(withHistory.slice(i, i + BATCH_SIZE));
  }

  const systemPrompt = [
    'You are an inventory planning specialist for construction, infrastructure, and industrial companies.',
    'For each item you are given real 30/60/90-day usage, on-hand, count-variance, and cost facts.',
    'Classify each item and propose stocking levels a mid-size company would actually run.',
    '',
    'Return ONLY a valid JSON object: { "items": [ { ... } ] } — no markdown fences.',
    'Each element MUST include:',
    '  catalog_item_id — echo back exactly the id given',
    '  classification  — one of: "steady" (regular predictable draw), "sporadic" (occasional/lumpy), "serialized" (individually tracked asset, not a stock level), "dead" (effectively no movement)',
    '  min_stock_level — integer safety floor (units on hand that should trigger concern), or null',
    '  reorder_point   — integer level at which to reorder (>= min_stock_level), or null',
    '  reorder_qty     — integer quantity to order when reordering (a sensible order size), or null',
    '  rationale       — ONE short line explaining the numbers (mention the rate/usage you used)',
    '',
    'Rules:',
    '- Base levels on the effective daily rate provided (effective_daily_rate) and a reasonable lead time (assume ~7-14 days unless usage implies otherwise).',
    '  reorder_point ≈ demand over lead time + a safety buffer; min_stock_level ≈ the safety buffer alone.',
    '- For "serialized" items, return null for all three levels (they are tracked as individual assets, not stock).',
    '- For "dead" items (rate ~0 and no recent movement), return null for all three — do NOT invent a number.',
    '- Higher count_variance_abs → a little more safety buffer (the count is less reliable).',
    '- Keep numbers whole and operationally sane; never propose a reorder_point below min_stock_level.',
    '- Respect the unit of measure — levels are in that unit.',
  ].join('\n');

  let modelCalls = 0;
  const proposalById = new Map<string, any>();

  for (const batch of batches) {
    const userPayload = {
      items: batch.map((f) => ({
        catalog_item_id: f.catalog_item_id,
        name: f.name,
        sku: f.sku,
        category: f.category_name,
        uom: uomLabel(f),
        tracking_mode: f.tracking_mode,
        seasonal: f.seasonal,
        qty_on_hand: f.qty_on_hand,
        qty_available: f.qty_available,
        usage_30d: f.usage_30d,
        usage_60d: f.usage_60d,
        usage_90d: f.usage_90d,
        effective_daily_rate: Number(effectiveDailyRate(f).toFixed(3)),
        movement_days_90d: f.movement_days,
        count_events: f.count_events,
        count_variance_abs: f.count_variance_abs,
        last_unit_cost: f.last_unit_cost,
        current_reorder_point: f.current_reorder_point,
      })),
    };

    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Propose levels for these items:\n${JSON.stringify(userPayload)}` },
        ],
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      });
    } catch (err: any) {
      modelCalls++;
      if (err.status === 429 || err.code === 'insufficient_quota') {
        throw AppError.internal('AI quota exceeded — check OpenAI billing or try again later.');
      }
      if (err.status === 401) {
        throw AppError.internal('AI authentication failed — check OPENAI_API_KEY.');
      }
      throw AppError.internal('Failed to generate min-level proposals. Try again.');
    }
    modelCalls++;

    const content = completion.choices?.[0]?.message?.content;
    if (!content) continue;
    let parsed: any;
    try {
      let jsonStr = content.trim();
      const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) jsonStr = fence[1].trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      log.warn('min_levels.parse_failed', { snippet: content.slice(0, 120) });
      continue;
    }
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    for (const it of items) {
      if (it && typeof it.catalog_item_id === 'string') proposalById.set(it.catalog_item_id, it);
    }
  }

  const VALID_CLASS: Classification[] = ['steady', 'sporadic', 'serialized', 'dead'];
  const cleanLevel = (v: unknown): number | null => {
    if (v == null) return null;
    const n = typeof v === 'string' ? parseFloat(v) : (v as number);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n);
  };

  for (const f of withHistory) {
    const ai = proposalById.get(f.catalog_item_id);
    const classification: Classification =
      ai && VALID_CLASS.includes(ai.classification) ? ai.classification : 'sporadic';

    let min = cleanLevel(ai?.min_stock_level);
    let rop = cleanLevel(ai?.reorder_point);
    let qty = cleanLevel(ai?.reorder_qty);

    // Serialized items and things the model called dead carry no stock level.
    if (NON_STOCK_TRACKING.has(f.tracking_mode) || classification === 'serialized' || classification === 'dead') {
      min = null;
      rop = null;
      qty = null;
    }
    // Guardrail: reorder_point must never sit below the safety floor.
    if (min != null && rop != null && rop < min) rop = min;

    proposals.push({
      catalog_item_id: f.catalog_item_id,
      sku: f.sku,
      name: f.name,
      category_name: f.category_name,
      uom_label: uomLabel(f),
      tracking_mode: f.tracking_mode,
      last_event_id: f.last_event_id,
      qty_on_hand: f.qty_on_hand,
      qty_available: f.qty_available,
      usage_30d: f.usage_30d,
      usage_90d: f.usage_90d,
      current_reorder_point: f.current_reorder_point,
      current_min_stock_level: f.current_min_stock_level,
      classification,
      min_stock_level: min,
      reorder_point: rop,
      reorder_qty: qty,
      rationale:
        typeof ai?.rationale === 'string' && ai.rationale.trim()
          ? ai.rationale.trim()
          : classification === 'serialized'
            ? 'Serialized asset — tracked individually, not by stock level.'
            : classification === 'dead'
              ? 'No meaningful recent movement — no level proposed.'
              : 'Proposed from recent usage.',
      enough_history: true,
      loose_tracking: looseIds.has(f.catalog_item_id),
    });
  }

  // Preserve the category-grouped order the facts RPC returned.
  const order = new Map(facts.map((f, i) => [f.catalog_item_id, i]));
  proposals.sort((a, b) => (order.get(a.catalog_item_id)! - order.get(b.catalog_item_id)!));

  const proposedCount = proposals.filter((p) => p.reorder_point != null || p.min_stock_level != null).length;

  log.info(
    `[AI Min-Levels] tenant=${tenantId} items=${facts.length} history=${withHistory.length} ` +
      `no_history=${noHistory.length} model_calls=${modelCalls} proposed=${proposedCount}`,
  );

  return Response.json({
    proposals,
    summary: {
      total: facts.length,
      with_history: withHistory.length,
      no_history: noHistory.length,
      proposed: proposedCount,
      model_calls: modelCalls,
    },
  });
}, { serviceName: SERVICE_NAME });
