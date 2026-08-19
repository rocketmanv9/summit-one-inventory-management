/**
 * Price wars — detection + round math (kits/amazon/fleet sprint, item 09).
 *
 * "We buy the same cones from three vendors at three prices." This module finds
 * those items and does the arithmetic; the routes and the arena page render it.
 *
 * DETECTION IS A QUERY, NOT A TABLE. A war candidate is any catalog item where
 * two or more distinct vendors have given us a price — from either side:
 *   - supply_chain.vendor_items  (a standing price on file), or
 *   - supply_chain.purchase_order_lines joined to purchase_orders.vendor_id
 *     (a price we actually paid).
 * The union means an item counts even if one vendor was a one-off PO and never
 * got a vendor_items row.
 *
 * TRUTHFULNESS. Every number this module produces traces to a row someone can
 * point at: a vendor_items.unit_cost, a PO line we paid, or a quote a human
 * recorded in the round. Nothing is modelled, forecast, or inferred. The AI
 * routes consume this shape and are forbidden (by system prompt) from inventing
 * anything outside it — see the two routes under /api/inventory/price-wars.
 */

import { AppError } from '@rocketmanv9/chassis/errors';

/** How far back "what we spend on this" looks. Trailing twelve months. */
export const SPEND_WINDOW_MONTHS = 12;

/** Below this spread there's no war worth fighting — everyone's already level. */
export const MIN_INTERESTING_SPREAD_PCT = 1;

export interface VendorPrice {
  vendor_id: string;
  vendor_name: string;
  vendor_code: string | null;
  contact_email: string | null;
  /** Cheapest price this vendor has ever given us (standing or paid). */
  best_unit_cost: number;
  /** Most recent price from this vendor, standing price preferred. */
  last_unit_cost: number;
  /** Standing catalogue price on vendor_items, when there is one. */
  catalog_unit_cost: number | null;
  vendor_sku: string | null;
  lead_time_days: number | null;
  /** Units bought from this vendor in the window. */
  qty_last_12m: number;
  /** Dollars spent with this vendor on this item in the window. */
  spend_last_12m: number;
  /** Most recent PO date we bought this item from them. */
  last_ordered_at: string | null;
  /** True when this vendor holds the current low price. */
  is_low: boolean;
}

export interface WarCandidate {
  catalog_item_id: string;
  name: string;
  sku: string | null;
  vendor_count: number;
  low_unit_cost: number;
  high_unit_cost: number;
  /** (high - low) / low, as a percentage. The headline "they're this far apart". */
  spread_pct: number;
  /** Trailing-12-month units and dollars across ALL vendors. */
  qty_last_12m: number;
  spend_last_12m: number;
  /** Blended price we actually paid in the window (spend / qty), when we bought any. */
  avg_paid_unit_cost: number | null;
  /**
   * What the last 12 months would have cost at the current low price, subtracted
   * from what it did cost. Zero when we bought nothing (spread is still the hook).
   */
  potential_savings_12m: number;
  vendors: VendorPrice[];
  /** An open round already exists for this item — the arena link, not a button. */
  open_round_id: string | null;
}

interface RawPriceRow {
  catalog_item_id: string;
  vendor_id: string;
  unit_cost: number;
  source: 'catalog' | 'po';
  observed_at: string | null;
  qty: number;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** ISO date `SPEND_WINDOW_MONTHS` back from today, for the PO window filter. */
export function spendWindowStart(now = new Date()): string {
  const d = new Date(now);
  d.setMonth(d.getMonth() - SPEND_WINDOW_MONTHS);
  return d.toISOString().slice(0, 10);
}

/**
 * Pull every vendor price signal for a tenant and fold it into ranked candidates.
 *
 * `supabase` is a tenant service client; `sc` is its supply_chain schema handle.
 * Kept as one function so the route and any future cron share the exact math.
 */
export async function findWarCandidates(
  supabase: any,
  tenantId: string,
  opts: { limit?: number; catalogItemId?: string | null } = {},
): Promise<WarCandidate[]> {
  const sc = supabase.schema('supply_chain');
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

  // ── 1. Standing prices on vendor_items ─────────────────────────────────────
  let viQuery = sc
    .from('vendor_items')
    .select('catalog_item_id, vendor_id, unit_cost, vendor_sku, lead_time_days, updated_at, active')
    .eq('tenant_id', tenantId)
    .not('unit_cost', 'is', null)
    .gt('unit_cost', 0)
    .limit(20000);
  if (opts.catalogItemId) viQuery = viQuery.eq('catalog_item_id', opts.catalogItemId);
  const { data: vendorItems, error: viErr } = await viQuery;
  if (viErr) throw AppError.internal(`vendor_items read failed: ${viErr.message}`);

  const activeVendorItems = (vendorItems ?? []).filter((r: any) => r.active !== false);

  // ── 2. Prices we actually paid, trailing 12 months ─────────────────────────
  const windowStart = spendWindowStart();
  let poQuery = sc
    .from('purchase_orders')
    .select('id, vendor_id, order_date, created_at, purchase_order_lines(catalog_item_id, unit_cost, qty_ordered)')
    .eq('tenant_id', tenantId)
    .not('vendor_id', 'is', null)
    .gte('order_date', windowStart)
    .limit(5000);
  const { data: pos, error: poErr } = await poQuery;
  if (poErr) throw AppError.internal(`purchase order history read failed: ${poErr.message}`);

  const priceRows: RawPriceRow[] = [];
  for (const r of activeVendorItems) {
    priceRows.push({
      catalog_item_id: r.catalog_item_id,
      vendor_id: r.vendor_id,
      unit_cost: Number(r.unit_cost),
      source: 'catalog',
      observed_at: r.updated_at ?? null,
      qty: 0,
    });
  }
  for (const po of pos ?? []) {
    for (const line of po.purchase_order_lines ?? []) {
      const cost = num(line.unit_cost);
      if (!line.catalog_item_id || cost === null || cost <= 0) continue;
      if (opts.catalogItemId && line.catalog_item_id !== opts.catalogItemId) continue;
      priceRows.push({
        catalog_item_id: line.catalog_item_id,
        vendor_id: po.vendor_id,
        unit_cost: cost,
        source: 'po',
        observed_at: po.order_date ?? po.created_at ?? null,
        qty: num(line.qty_ordered) ?? 0,
      });
    }
  }
  if (priceRows.length === 0) return [];

  // ── 3. Fold: item → vendor → price facts ───────────────────────────────────
  type VendorAgg = {
    best: number;
    catalog: number | null;
    catalogAt: string | null;
    lastPaid: number | null;
    lastPaidAt: string | null;
    qty: number;
    spend: number;
    vendor_sku: string | null;
    lead_time_days: number | null;
  };
  const byItem = new Map<string, Map<string, VendorAgg>>();
  const catalogMeta = new Map<string, { vendor_sku: string | null; lead_time_days: number | null }>();
  for (const r of activeVendorItems) {
    catalogMeta.set(`${r.catalog_item_id}:${r.vendor_id}`, {
      vendor_sku: r.vendor_sku ?? null,
      lead_time_days: r.lead_time_days ?? null,
    });
  }

  for (const row of priceRows) {
    if (!byItem.has(row.catalog_item_id)) byItem.set(row.catalog_item_id, new Map());
    const vendors = byItem.get(row.catalog_item_id)!;
    const meta = catalogMeta.get(`${row.catalog_item_id}:${row.vendor_id}`);
    const agg = vendors.get(row.vendor_id) ?? {
      best: row.unit_cost,
      catalog: null,
      catalogAt: null,
      lastPaid: null,
      lastPaidAt: null,
      qty: 0,
      spend: 0,
      vendor_sku: meta?.vendor_sku ?? null,
      lead_time_days: meta?.lead_time_days ?? null,
    };
    agg.best = Math.min(agg.best, row.unit_cost);
    if (row.source === 'catalog') {
      agg.catalog = row.unit_cost;
      agg.catalogAt = row.observed_at;
    } else {
      if (!agg.lastPaidAt || (row.observed_at ?? '') >= agg.lastPaidAt) {
        agg.lastPaid = row.unit_cost;
        agg.lastPaidAt = row.observed_at;
      }
      agg.qty += row.qty;
      agg.spend += row.qty * row.unit_cost;
    }
    vendors.set(row.vendor_id, agg);
  }

  // ── 4. Keep only genuine multi-vendor items with a real spread ─────────────
  const contenders: Array<{ itemId: string; vendors: Map<string, VendorAgg> }> = [];
  for (const [itemId, vendors] of byItem) {
    if (vendors.size < 2) continue;
    const costs = Array.from(vendors.values()).map((v) => v.best);
    const lo = Math.min(...costs);
    const hi = Math.max(...costs);
    if (lo <= 0) continue;
    if (((hi - lo) / lo) * 100 < MIN_INTERESTING_SPREAD_PCT) continue;
    contenders.push({ itemId, vendors });
  }
  if (contenders.length === 0) return [];

  // ── 5. Display joins: item names, vendor names/emails, open rounds ─────────
  const itemIds = contenders.map((c) => c.itemId);
  const vendorIds = Array.from(new Set(contenders.flatMap((c) => Array.from(c.vendors.keys()))));

  const [{ data: items }, { data: vendorRows }, { data: openRounds }] = await Promise.all([
    supabase.schema('inventory').from('catalog_items').select('id, name, sku').in('id', itemIds).limit(5000),
    sc.from('vendors').select('id, name, code, contact_email, po_email').in('id', vendorIds).limit(5000),
    sc.from('quote_rounds').select('id, catalog_item_id').eq('tenant_id', tenantId).eq('status', 'open').limit(500),
  ]);

  const itemMap = new Map<string, any>((items ?? []).map((i: any) => [i.id, i]));
  const vendorMap = new Map<string, any>((vendorRows ?? []).map((v: any) => [v.id, v]));
  const openByItem = new Map<string, string>((openRounds ?? []).map((r: any) => [r.catalog_item_id, r.id]));

  const candidates: WarCandidate[] = [];
  for (const { itemId, vendors } of contenders) {
    const item = itemMap.get(itemId);
    // A price for an item that no longer exists in the catalog isn't actionable.
    if (!item) continue;

    const costs = Array.from(vendors.values()).map((v) => v.best);
    const lo = Math.min(...costs);
    const hi = Math.max(...costs);

    let qty = 0;
    let spend = 0;
    const vendorList: VendorPrice[] = [];
    for (const [vendorId, agg] of vendors) {
      const v = vendorMap.get(vendorId);
      if (!v) continue;
      qty += agg.qty;
      spend += agg.spend;
      vendorList.push({
        vendor_id: vendorId,
        vendor_name: v.name,
        vendor_code: v.code ?? null,
        contact_email: v.contact_email ?? v.po_email ?? null,
        best_unit_cost: round2(agg.best),
        // "Last" prefers the standing catalogue price — that's what we'd pay on
        // the next PO — and falls back to the last price we actually paid.
        last_unit_cost: round2(agg.catalog ?? agg.lastPaid ?? agg.best),
        catalog_unit_cost: agg.catalog !== null ? round2(agg.catalog) : null,
        vendor_sku: agg.vendor_sku,
        lead_time_days: agg.lead_time_days,
        qty_last_12m: round2(agg.qty),
        spend_last_12m: round2(agg.spend),
        last_ordered_at: agg.lastPaidAt,
        is_low: agg.best === lo,
      });
    }
    if (vendorList.length < 2) continue;

    vendorList.sort((a, b) => a.best_unit_cost - b.best_unit_cost);

    // Savings = what the window actually cost minus what it would have cost at
    // the current low. Never negative; zero when we bought nothing.
    const savings = qty > 0 ? Math.max(0, spend - qty * lo) : 0;

    candidates.push({
      catalog_item_id: itemId,
      name: item.name,
      sku: item.sku ?? null,
      vendor_count: vendorList.length,
      low_unit_cost: round2(lo),
      high_unit_cost: round2(hi),
      spread_pct: round2(((hi - lo) / lo) * 100),
      qty_last_12m: round2(qty),
      spend_last_12m: round2(spend),
      avg_paid_unit_cost: qty > 0 ? round2(spend / qty) : null,
      potential_savings_12m: round2(savings),
      vendors: vendorList,
      open_round_id: openByItem.get(itemId) ?? null,
    });
  }

  // Money first; when nothing has been bought yet, the widest spread wins.
  candidates.sort((a, b) =>
    b.potential_savings_12m - a.potential_savings_12m ||
    b.spread_pct - a.spread_pct ||
    b.vendor_count - a.vendor_count,
  );

  return candidates.slice(0, limit);
}

// ── Round-side helpers ───────────────────────────────────────────────────────

export interface BidStanding {
  bid_id: string;
  vendor_id: string;
  vendor_name: string;
  status: 'invited' | 'quoted' | 'declined';
  baseline_unit_cost: number | null;
  current_quote: number | null;
  /** current_quote vs baseline, as a percentage. Negative = they came down. */
  move_pct: number | null;
  is_low: boolean;
  rank: number | null;
}

/**
 * Rank a round's bids: real quotes ascending, then the yet-to-answer, then the
 * declines. `is_low` is only ever true for a vendor who actually quoted.
 */
export function rankBids(bids: Array<any>): BidStanding[] {
  const quoted = bids.filter((b) => b.status === 'quoted' && num(b.current_quote) !== null);
  const low = quoted.length > 0 ? Math.min(...quoted.map((b) => Number(b.current_quote))) : null;

  const standing = bids.map((b) => {
    const quote = num(b.current_quote);
    const baseline = num(b.baseline_unit_cost);
    return {
      bid_id: b.id,
      vendor_id: b.vendor_id,
      vendor_name: b.vendor_name ?? 'Vendor',
      status: b.status as BidStanding['status'],
      baseline_unit_cost: baseline,
      current_quote: quote,
      move_pct: quote !== null && baseline !== null && baseline > 0
        ? round2(((quote - baseline) / baseline) * 100)
        : null,
      is_low: b.status === 'quoted' && quote !== null && low !== null && quote === low,
      rank: null as number | null,
    };
  });

  const order = (s: BidStanding) => (s.status === 'quoted' && s.current_quote !== null ? 0 : s.status === 'declined' ? 2 : 1);
  standing.sort((a, b) => {
    const oa = order(a); const ob = order(b);
    if (oa !== ob) return oa - ob;
    if (oa === 0) return (a.current_quote ?? 0) - (b.current_quote ?? 0);
    return a.vendor_name.localeCompare(b.vendor_name);
  });

  let rank = 0;
  for (const s of standing) {
    if (s.status === 'quoted' && s.current_quote !== null) s.rank = ++rank;
  }
  return standing;
}

/** The lowest price actually recorded in this round, or null if nobody has quoted. */
export function currentLow(bids: Array<any>): { unit_cost: number; vendor_id: string; vendor_name: string } | null {
  let best: { unit_cost: number; vendor_id: string; vendor_name: string } | null = null;
  for (const b of bids) {
    if (b.status !== 'quoted') continue;
    const q = num(b.current_quote);
    if (q === null) continue;
    if (!best || q < best.unit_cost) {
      best = { unit_cost: q, vendor_id: b.vendor_id, vendor_name: b.vendor_name ?? 'Vendor' };
    }
  }
  return best;
}

/** Savings if the round's target quantity were bought at `unitCost` instead of `baseline`. */
export function roundSavings(targetQty: number, baseline: number | null, unitCost: number | null): number | null {
  if (baseline === null || unitCost === null || !Number.isFinite(targetQty)) return null;
  return round2(Math.max(0, (baseline - unitCost) * targetQty));
}

// ── Recommendation ───────────────────────────────────────────────────────────

export interface WinnerReasonLine {
  vendor_id: string;
  vendor_name: string;
  unit_cost: number;
  /** unit_cost vs the round baseline, as a percentage. Negative = cheaper. */
  move_pct: number | null;
  is_winner: boolean;
}

export interface WinnerRecommendation {
  /** True only when at least one vendor has actually quoted a price. */
  has_recommendation: boolean;
  winner_vendor_id: string | null;
  winner_vendor_name: string | null;
  winner_unit_cost: number | null;
  /** Second-cheapest quote, when one exists — "you beat this by X". */
  runner_up_vendor_name: string | null;
  runner_up_unit_cost: number | null;
  /** Savings vs baseline across the round's target quantity, when computable. */
  savings_vs_baseline: number | null;
  /** How much cheaper the winner is than the runner-up per unit (>= 0). */
  margin_over_runner_up: number | null;
  /** Vendors who quoted, cheapest first — the per-line reasoning. */
  quoted: WinnerReasonLine[];
  /** How many invited vendors have not replied yet. */
  awaiting_count: number;
  awaiting_vendor_names: string[];
  declined_count: number;
  /** A plain-English line the UI can show verbatim. */
  summary: string;
}

/**
 * Recommend a winner from a round's bids: the lowest qualifying quote, with the
 * runner-up, savings vs baseline, and who's still silent. Never invents a price
 * — only vendors who actually quoted are eligible, and if nobody has quoted the
 * recommendation is honestly empty. Reuses `rankBids` so the arena and this
 * agree on ordering.
 */
export function recommendWinner(
  bids: Array<any>,
  opts: { targetQty?: number; baseline?: number | null } = {},
): WinnerRecommendation {
  const standings = rankBids(bids);
  const targetQty = Number(opts.targetQty) > 0 ? Number(opts.targetQty) : 1;
  const baseline = opts.baseline !== undefined && opts.baseline !== null ? Number(opts.baseline) : null;

  const quoted = standings.filter((s) => s.status === 'quoted' && s.current_quote !== null);
  const awaiting = standings.filter((s) => s.status === 'invited');
  const declined = standings.filter((s) => s.status === 'declined');

  const quotedLines: WinnerReasonLine[] = quoted.map((s, i) => ({
    vendor_id: s.vendor_id,
    vendor_name: s.vendor_name,
    unit_cost: Number(s.current_quote),
    move_pct: s.move_pct,
    is_winner: i === 0,
  }));

  if (quoted.length === 0) {
    return {
      has_recommendation: false,
      winner_vendor_id: null,
      winner_vendor_name: null,
      winner_unit_cost: null,
      runner_up_vendor_name: null,
      runner_up_unit_cost: null,
      savings_vs_baseline: null,
      margin_over_runner_up: null,
      quoted: [],
      awaiting_count: awaiting.length,
      awaiting_vendor_names: awaiting.map((s) => s.vendor_name),
      declined_count: declined.length,
      summary: awaiting.length > 0
        ? `No quotes yet — waiting on ${awaiting.length} vendor${awaiting.length === 1 ? '' : 's'}.`
        : 'No quotes recorded in this round yet.',
    };
  }

  const winner = quoted[0];
  const runnerUp = quoted[1] ?? null;
  const savings = roundSavings(targetQty, baseline, Number(winner.current_quote));
  const margin = runnerUp ? round2(Math.max(0, Number(runnerUp.current_quote) - Number(winner.current_quote))) : null;

  const winnerCost = Number(winner.current_quote);
  const parts: string[] = [
    `Recommended: ${winner.vendor_name} at $${winnerCost.toFixed(2)}/unit`,
  ];
  if (savings !== null && savings > 0) parts.push(`saves $${savings.toFixed(2)} vs baseline`);
  if (runnerUp) parts.push(`beats ${runnerUp.vendor_name} ($${Number(runnerUp.current_quote).toFixed(2)})`);
  if (awaiting.length > 0) parts.push(`${awaiting.length} vendor${awaiting.length === 1 ? '' : 's'} still to reply`);

  return {
    has_recommendation: true,
    winner_vendor_id: winner.vendor_id,
    winner_vendor_name: winner.vendor_name,
    winner_unit_cost: winnerCost,
    runner_up_vendor_name: runnerUp?.vendor_name ?? null,
    runner_up_unit_cost: runnerUp ? Number(runnerUp.current_quote) : null,
    savings_vs_baseline: savings,
    margin_over_runner_up: margin,
    quoted: quotedLines,
    awaiting_count: awaiting.length,
    awaiting_vendor_names: awaiting.map((s) => s.vendor_name),
    declined_count: declined.length,
    summary: parts.join(' · ') + '.',
  };
}
