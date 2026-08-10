// External order sessions — shared server logic (item 06).
//
// A session is opened against an item-04 external purchase link; the mobile
// guided browser (item 07) streams screenshots up while the user shops the
// external site; on completion AI vision turns the captures into a draft PO with
// the screenshots attached. The human always places the real order — we only
// watch and record.
//
// This module holds the pieces the routes share: the capture storage bucket
// name, the stale-session sweep, AI vision extraction over the captures, and the
// vendor-lite fallback used when a link has no linked vendor.
//
// SERVER-ONLY — pass in a tenant-scoped service-role supabase client.

import OpenAI from 'openai';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getGVClient } from '@/lib/gv';

/** Private storage bucket for guided-purchase screenshots (see migration 04). */
export const CAPTURES_BUCKET = 'external-order-captures';

/** Cap on captures per session — enough for a multi-page checkout, bounded. */
export const MAX_CAPTURES = 30;

/** Active sessions older than this are swept to 'abandoned'. */
export const STALE_SESSION_HOURS = 24;

/** Vision model for extraction. gpt-4o is vision-capable; keep separate from the
 *  gpt-4o-search-preview used by the vendor web-search routes. */
const VISION_MODEL = 'gpt-4o';

// ── Extraction shapes (also the item-07 contract for `extracted`) ────────────

export interface ExtractedLine {
  description: string;
  qty: number | null;
  unit_price: number | null;
  /** 'high' | 'medium' | 'low' — how sure the model is about THIS line. */
  confidence: 'high' | 'medium' | 'low';
}

export interface ExtractionConfidence {
  vendor: 'high' | 'medium' | 'low';
  items: 'high' | 'medium' | 'low';
  total: 'high' | 'medium' | 'low';
}

export interface ExtractionResult {
  /** The site/vendor the captures came from (e.g. "Canva", "Grainger"). */
  site: string | null;
  items: ExtractedLine[];
  order_total: number | null;
  /** Order/confirmation number if visible in the captures. */
  order_number: string | null;
  confidence: ExtractionConfidence;
  /** Human-readable caveats surfaced onto the draft PO ("total unclear…"). */
  notes: string[];
  /** True when AI ran; false when it was skipped (no key) or failed. */
  ai_ran: boolean;
}

/** An empty shell — used when there are no captures, no cart is visible, or AI is
 *  unavailable. Never invents lines. */
export function emptyExtraction(notes: string[] = []): ExtractionResult {
  return {
    site: null,
    items: [],
    order_total: null,
    order_number: null,
    confidence: { vendor: 'low', items: 'low', total: 'low' },
    notes,
    ai_ran: false,
  };
}

// ── Sweep ─────────────────────────────────────────────────────────────────────

/**
 * Mark this tenant's stale 'active' sessions (older than STALE_SESSION_HOURS)
 * as 'abandoned'. Called lazily whenever a session list/read runs, and by the
 * optional cron. Best-effort: never throws into the caller.
 */
export async function sweepStaleSessions(supabase: any, tenantId: string): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_SESSION_HOURS * 3600 * 1000).toISOString();
  const sc = supabase.schema('supply_chain');
  const { data, error } = await sc
    .from('external_order_sessions')
    .update({ status: 'abandoned', updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .lt('started_at', cutoff)
    .select('id');
  if (error) return 0;
  return (data ?? []).length;
}

// ── Session owner guard ───────────────────────────────────────────────────────

export interface OrderSession {
  id: string;
  tenant_id: string;
  link_id: string;
  user_id: string;
  status: 'active' | 'completed' | 'abandoned' | 'cancelled';
  capture_count: number;
  extracted: ExtractionResult | null;
  draft_po_id: string | null;
  notes: string | null;
}

/**
 * Load a session and assert the caller owns it. Session routes are gated to the
 * session owner (the worker who started the guided purchase), not just the
 * tenant. Throws 404 if missing (don't leak existence), 403 if not the owner.
 */
export async function loadOwnedSession(
  supabase: any,
  tenantId: string,
  userId: string,
  sessionId: string,
): Promise<OrderSession> {
  const sc = supabase.schema('supply_chain');
  const { data, error } = await sc
    .from('external_order_sessions')
    .select('id, tenant_id, link_id, user_id, status, capture_count, extracted, draft_po_id, notes')
    .eq('id', sessionId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw AppError.internal(error.message);
  if (!data) throw AppError.notFound('Order session not found.');
  if (data.user_id !== userId) throw AppError.forbidden('This order session belongs to someone else.');
  return data as OrderSession;
}

// ── Vendor-lite fallback ──────────────────────────────────────────────────────

/**
 * Resolve the vendor to bill a guided-purchase PO against.
 *
 * `rpc_create_purchase_order` requires a real vendor row, but item-04 links may
 * have no `vendor_id` (Canva isn't a vendor). For those, we resolve-or-create a
 * single per-tenant placeholder vendor ("Guided Purchase (external site)") so the
 * PO is valid and flows through the normal approval gate. The site name lives in
 * the PO notes/lines, not in a throwaway vendor per site (out of scope: vendor
 * auto-creation for link sites).
 */
export async function resolveGuidedPurchaseVendorId(
  supabase: any,
  tenantId: string,
  linkVendorId: string | null,
): Promise<string> {
  if (linkVendorId) return linkVendorId;

  const sc = supabase.schema('supply_chain');
  const PLACEHOLDER_CODE = 'GUIDED-EXT';

  const { data: existing } = await sc
    .from('vendors')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('code', PLACEHOLDER_CODE)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: created, error } = await sc
    .from('vendors')
    .upsert(
      {
        tenant_id: tenantId,
        name: 'Guided Purchase (external site)',
        code: PLACEHOLDER_CODE,
        active: true,
        notes: 'Placeholder vendor for guided-purchase POs whose external site is not a tracked vendor. The actual site is recorded on each PO.',
        last_event_id: crypto.randomUUID(),
      },
      { onConflict: 'tenant_id,code' },
    )
    .select('id')
    .single();
  if (error || !created?.id) {
    throw AppError.internal(`Could not resolve a vendor for the guided purchase: ${error?.message ?? 'unknown'}`);
  }
  return created.id;
}

// ── Delivery location ─────────────────────────────────────────────────────────

/**
 * Resolve a delivery location for the guided-purchase PO. rpc_create_purchase_order
 * requires either a delivery (ship) or pickup location; guided purchases don't
 * collect one, so we default to the tenant's ship-to yard (same convention the
 * AI restock draft uses: is_default_ship_to first, else any location). Returns
 * null if the tenant has no locations at all.
 */
export async function resolveDefaultShipToLocationId(supabase: any, tenantId: string): Promise<string | null> {
  const { data } = await supabase
    .schema('inventory')
    .from('locations')
    .select('id, is_default_ship_to')
    .eq('tenant_id', tenantId)
    .order('is_default_ship_to', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Resolve the "Each" UOM term id from GV. Free-text PO lines must carry a
 * uom_term_id (DB constraint chk_noncatalog_has_uom); guided-purchase lines have
 * no catalog item, so we default them to Each. Returns null if GV is unreachable.
 */
export async function resolveEachUomTermId(tenantId: string): Promise<string | null> {
  try {
    const gv = getGVClient();
    return await gv.resolveTermId(tenantId, 'uom', 'EA', true);
  } catch {
    return null;
  }
}

// ── AI vision extraction ──────────────────────────────────────────────────────

/**
 * Run AI vision over a session's capture images and return structured order
 * data. Degrades gracefully:
 *   - no OPENAI_API_KEY  → empty shell, needs-manual-entry note, ai_ran=false.
 *   - no captures         → empty shell.
 *   - no cart/checkout visible → items:[] (never hallucinates lines).
 *   - AI error            → empty shell + note, ai_ran=false.
 *
 * `images` are base64 data URLs (data:image/...;base64,...).
 */
export async function extractOrderFromCaptures(
  images: string[],
  siteHint: string | null,
): Promise<ExtractionResult> {
  if (images.length === 0) {
    return emptyExtraction(['No screenshots were captured for this session — nothing to extract.']);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return emptyExtraction([
      'AI extraction unavailable (OPENAI_API_KEY not configured) — enter the order lines manually against the attached screenshots.',
    ]);
  }

  // Vision cost/latency guard: at most ~8 images, low detail.
  const imageParts = images.slice(0, 8).map((url) => ({
    type: 'image_url' as const,
    image_url: { url, detail: 'low' as const },
  }));

  const systemPrompt = [
    'You are a procurement assistant for a construction/industrial company.',
    'You will be shown SCREENSHOTS a worker took while shopping on an external website',
    `${siteHint ? `(the site is "${siteHint}"). ` : '. '}` +
      'The screenshots may show a product page, a shopping cart, or a checkout/confirmation page.',
    '',
    'Extract the ORDER the worker is placing. Return ONLY a valid JSON object (no markdown fences):',
    '  site          — the store/vendor name shown, or null',
    '  items         — array of { description, qty, unit_price, confidence }',
    '                  qty and unit_price are numbers (null if not visible);',
    '                  confidence is "high" | "medium" | "low" for THAT line',
    '  order_total   — the order total as a number, or null if not clearly shown',
    '  order_number  — the order/confirmation number if visible, else null',
    '  confidence    — { vendor, items, total } each "high" | "medium" | "low"',
    '  notes         — array of short caveats for anything unclear (e.g. "total not shown in captures")',
    '',
    'CRITICAL RULES:',
    '- NEVER invent line items. If the screenshots show no cart or checkout with items,',
    '  return items: [] and a note explaining nothing was orderable in the captures.',
    '- Only report a number (qty, unit_price, total) you can actually read; otherwise use null and lower confidence.',
    '- Prefer the cart/checkout page over the product page when both are present.',
  ].join('\n');

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Here are the screenshots, in order. Extract the order as JSON.' },
            ...imageParts,
          ] as any,
        },
      ],
      temperature: 0.1,
      max_tokens: 1200,
    });

    const content = completion.choices?.[0]?.message?.content?.trim();
    if (!content) return emptyExtraction(['AI returned an empty response — verify the order manually.']);

    let jsonStr = content;
    const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) jsonStr = fence[1].trim();
    const raw = JSON.parse(jsonStr);

    return normalizeExtraction(raw);
  } catch (err: any) {
    return emptyExtraction([
      `AI extraction failed (${err?.message ?? 'unknown error'}) — enter the order lines manually against the attached screenshots.`,
    ]);
  }
}

const CONF = new Set(['high', 'medium', 'low']);
function conf(v: unknown): 'high' | 'medium' | 'low' {
  return typeof v === 'string' && CONF.has(v) ? (v as any) : 'low';
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Coerce the model's JSON into a strict ExtractionResult. Drops garbage lines. */
export function normalizeExtraction(raw: any): ExtractionResult {
  const items: ExtractedLine[] = Array.isArray(raw?.items)
    ? raw.items
        .filter((it: any) => it && typeof it.description === 'string' && it.description.trim().length > 0)
        .map((it: any) => ({
          description: String(it.description).trim().slice(0, 500),
          qty: num(it.qty),
          unit_price: num(it.unit_price),
          confidence: conf(it.confidence),
        }))
    : [];

  const notes: string[] = Array.isArray(raw?.notes)
    ? raw.notes.filter((n: any) => typeof n === 'string' && n.trim()).map((n: string) => n.trim().slice(0, 300))
    : [];

  return {
    site: typeof raw?.site === 'string' && raw.site.trim() ? raw.site.trim().slice(0, 200) : null,
    items,
    order_total: num(raw?.order_total),
    order_number: typeof raw?.order_number === 'string' && raw.order_number.trim() ? raw.order_number.trim().slice(0, 120) : null,
    confidence: {
      vendor: conf(raw?.confidence?.vendor),
      items: conf(raw?.confidence?.items),
      total: conf(raw?.confidence?.total),
    },
    notes,
    ai_ran: true,
  };
}
