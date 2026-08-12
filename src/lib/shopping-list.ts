// Shopping list → vendor suggestions — shared server logic (item 15).
//
// Give a buyer a "here's what I need" flow: a list of catalog items (added by
// search or matched from a pasted free-text list) is resolved to per-item vendor
// options and a whole-list vendor SPLIT, then handed to the normal draft-PO path
// grouped by the chosen vendor.
//
// This reuses the exact per-item resolution the buyable-groups / draft-PO path
// uses (resolveBestVendorItems in @/lib/buyable-groups) and the vendor_items
// pricing table. It adds two legible pieces on top:
//   1. matchCatalogLines — deterministic free-text → catalog matching (exact
//      sku/name, then token-overlap fuzzy) so a pasted list resolves without an
//      LLM round-trip. Unmatched lines are flagged, never dropped.
//   2. computeVendorSplit — the whole-list split: each item goes to its best
//      vendor; totals per vendor are summed; a "fewest vendors" consolidation
//      alternative is offered when it costs within CONSOLIDATE_THRESHOLD of the
//      cheapest split. Dumb, documented heuristic — no scoring engine.
//
// SERVER-ONLY — pass in a tenant-scoped service-role supabase client.

/**
 * A pasted free-text line's match against the catalog. `matched` items carry the
 * resolved catalog id; unmatched lines carry the raw text so the UI can flag them
 * ("no catalog match — add an item?") instead of silently dropping them.
 */
export interface CatalogMatch {
  /** The raw line the user pasted/typed (already trimmed of a leading qty). */
  query: string;
  /** Parsed leading quantity if the line began with a number (e.g. "5 x ..."). */
  qty: number;
  catalog_item_id: string | null;
  name: string | null;
  sku: string | null;
  uom_term_id: string | null;
  /** How the match was made — surfaced so a "fuzzy" match can ask to confirm. */
  match_kind: 'exact_sku' | 'exact_name' | 'fuzzy' | 'none';
  /** 0..1 overlap score for fuzzy matches (1 for exact); 0 when unmatched. */
  score: number;
}

interface CatalogRow {
  id: string;
  name: string | null;
  sku: string | null;
  uom_term_id: string | null;
}

/** Lowercase, collapse whitespace, strip punctuation to spaces for tokenizing. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function tokens(s: string): string[] {
  return norm(s).split(' ').filter((t) => t.length > 1);
}

/**
 * Parse a pasted line into { qty, query }. Recognises a leading quantity written
 * as "5 item", "5x item", "5 x item", "5*item" — the common ways people write a
 * shopping list. No leading number → qty defaults to 1.
 */
export function parseListLine(raw: string): { qty: number; query: string } {
  const line = raw.trim();
  const m = line.match(/^(\d+(?:\.\d+)?)\s*(?:x|\*)?\s+(.+)$/i);
  if (m) {
    const qty = Number(m[1]);
    if (Number.isFinite(qty) && qty > 0) return { qty, query: m[2].trim() };
  }
  return { qty: 1, query: line };
}

/**
 * Deterministically match free-text lines to catalog items. Loads the active
 * catalog once (bounded) and, per line, tries: exact SKU, exact name, then a
 * token-overlap fuzzy match (Jaccard over word tokens). A fuzzy match only wins
 * above FUZZY_MIN so unrelated lines fall through to `none` and get flagged.
 *
 * Deliberately LLM-free: pasted construction shopping lists are short and use the
 * item's real name/sku, so this resolves them instantly and predictably. The AI
 * item-suggest path stays for *creating* brand-new catalog items.
 */
const FUZZY_MIN = 0.34;

export async function matchCatalogLines(
  supabase: any,
  lines: Array<{ qty: number; query: string }>,
): Promise<CatalogMatch[]> {
  const inv = supabase.schema('inventory');
  const { data: rows } = await inv
    .from('catalog_items')
    .select('id, name, sku, uom_term_id')
    .eq('active', true)
    .limit(5000);
  const catalog: CatalogRow[] = rows ?? [];

  // Precompute lookup structures once.
  const bySku = new Map<string, CatalogRow>();
  const byName = new Map<string, CatalogRow>();
  const tokenized = catalog.map((c) => ({
    row: c,
    toks: new Set(tokens([c.name, c.sku].filter(Boolean).join(' '))),
  }));
  for (const c of catalog) {
    if (c.sku) bySku.set(norm(c.sku), c);
    if (c.name) byName.set(norm(c.name), c);
  }

  const toMatch = (row: CatalogRow, kind: CatalogMatch['match_kind'], score: number, q: string, qty: number): CatalogMatch => ({
    query: q,
    qty,
    catalog_item_id: row.id,
    name: row.name,
    sku: row.sku,
    uom_term_id: row.uom_term_id,
    match_kind: kind,
    score,
  });

  return lines.map(({ qty, query }) => {
    const nq = norm(query);
    if (!nq) {
      return { query, qty, catalog_item_id: null, name: null, sku: null, uom_term_id: null, match_kind: 'none', score: 0 };
    }
    const skuHit = bySku.get(nq);
    if (skuHit) return toMatch(skuHit, 'exact_sku', 1, query, qty);
    const nameHit = byName.get(nq);
    if (nameHit) return toMatch(nameHit, 'exact_name', 1, query, qty);

    // Fuzzy: Jaccard overlap of tokens, best candidate wins above threshold.
    const qToks = new Set(tokens(query));
    if (qToks.size > 0) {
      let best: { row: CatalogRow; score: number } | null = null;
      for (const cand of tokenized) {
        if (cand.toks.size === 0) continue;
        let inter = 0;
        for (const t of qToks) if (cand.toks.has(t)) inter++;
        if (inter === 0) continue;
        const union = qToks.size + cand.toks.size - inter;
        const score = inter / union;
        if (!best || score > best.score) best = { row: cand.row, score };
      }
      if (best && best.score >= FUZZY_MIN) {
        return toMatch(best.row, 'fuzzy', Number(best.score.toFixed(2)), query, qty);
      }
    }
    return { query, qty, catalog_item_id: null, name: null, sku: null, uom_term_id: null, match_kind: 'none', score: 0 };
  });
}

// ── Whole-list vendor split ───────────────────────────────────────────────────

/**
 * When a "fewest vendors" consolidation costs no more than this fraction above
 * the cheapest per-item split, we offer it as an alternative. e.g. 0.10 = show
 * consolidation when it's within 10% of the cheapest option. Legible on purpose.
 */
export const CONSOLIDATE_THRESHOLD = 0.1;

export interface SplitLineInput {
  catalog_item_id: string;
  qty: number;
  name: string | null;
  /** All active vendor options for this item, from vendor_items. */
  options: Array<{ vendor_id: string; vendor_name: string | null; unit_cost: number | null; is_preferred: boolean }>;
}

export interface SplitVendorBucket {
  vendor_id: string;
  vendor_name: string | null;
  item_count: number;
  /** Sum of qty × unit_cost across this bucket's lines (priced lines only). */
  subtotal: number;
  /** True when at least one line in this bucket has no known unit_cost. */
  has_unpriced: boolean;
  catalog_item_ids: string[];
}

export interface VendorSplit {
  /** Buckets keyed by vendor, most items first. */
  buckets: SplitVendorBucket[];
  /** Total priced spend across all buckets. */
  total: number;
  /** Catalog items with no vendor option at all — never assigned, always flagged. */
  unassigned_item_ids: string[];
  /** Number of distinct vendors this split uses. */
  vendor_count: number;
}

export interface SplitResult {
  /** Cheapest split: each item to its own best (preferred, then cheapest) vendor. */
  recommended: VendorSplit;
  /**
   * "Fewest vendors" alternative: assign every item to the single vendor that
   * can cover the most items (ties broken by lowest total), leaving items that
   * vendor can't carry on their own best vendor. Only present when it beats the
   * recommended vendor_count AND costs within CONSOLIDATE_THRESHOLD.
   */
  consolidated: VendorSplit | null;
  /** Plain-language note explaining whether/why consolidation is offered. */
  consolidation_note: string;
}

/** The best option for an item: preferred first, then cheapest (nulls last). */
function bestOption(opts: SplitLineInput['options']): SplitLineInput['options'][number] | null {
  if (opts.length === 0) return null;
  return [...opts].sort((a, b) => {
    if (a.is_preferred !== b.is_preferred) return a.is_preferred ? -1 : 1;
    return (a.unit_cost ?? Number.MAX_VALUE) - (b.unit_cost ?? Number.MAX_VALUE);
  })[0];
}

/** Roll a per-item vendor assignment into vendor buckets + totals. */
function buildSplit(
  assignments: Array<{ line: SplitLineInput; vendor: SplitLineInput['options'][number] }>,
  unassigned: string[],
): VendorSplit {
  const byVendor = new Map<string, SplitVendorBucket>();
  let total = 0;
  for (const { line, vendor } of assignments) {
    let b = byVendor.get(vendor.vendor_id);
    if (!b) {
      b = { vendor_id: vendor.vendor_id, vendor_name: vendor.vendor_name, item_count: 0, subtotal: 0, has_unpriced: false, catalog_item_ids: [] };
      byVendor.set(vendor.vendor_id, b);
    }
    b.item_count += 1;
    b.catalog_item_ids.push(line.catalog_item_id);
    if (vendor.unit_cost != null) total += vendor.unit_cost * line.qty, (b.subtotal += vendor.unit_cost * line.qty);
    else b.has_unpriced = true;
  }
  const buckets = [...byVendor.values()].sort((a, b) => b.item_count - a.item_count || a.subtotal - b.subtotal);
  return { buckets, total, unassigned_item_ids: unassigned, vendor_count: buckets.length };
}

/**
 * Compute the recommended per-item split and (when worthwhile) a fewest-vendors
 * consolidation. Items with no vendor option are collected into unassigned_item_ids
 * on both splits — the caller surfaces them as "no vendor on file".
 */
export function computeVendorSplit(lines: SplitLineInput[]): SplitResult {
  const priced = lines.filter((l) => l.options.length > 0);
  const unassigned = lines.filter((l) => l.options.length === 0).map((l) => l.catalog_item_id);

  // Recommended: each item to its own best vendor.
  const recAssign = priced.map((line) => ({ line, vendor: bestOption(line.options)! }));
  const recommended = buildSplit(recAssign, unassigned);

  // Nothing to consolidate if the recommendation already uses one vendor.
  if (recommended.vendor_count <= 1) {
    return {
      recommended,
      consolidated: null,
      consolidation_note:
        recommended.vendor_count === 1
          ? 'Every item on this list is covered by a single vendor — no split needed.'
          : 'No priced vendor options for these items yet.',
    };
  }

  // Consolidation: the vendor that can carry the most items becomes the anchor;
  // items that vendor can't carry stay on their own best vendor.
  const coverage = new Map<string, { vendor: SplitLineInput['options'][number]; count: number }>();
  for (const line of priced) {
    for (const opt of line.options) {
      const cur = coverage.get(opt.vendor_id);
      if (cur) cur.count += 1;
      else coverage.set(opt.vendor_id, { vendor: opt, count: 1 });
    }
  }
  const anchorEntry = [...coverage.values()].sort((a, b) => b.count - a.count)[0];

  let consolidated: VendorSplit | null = null;
  let note: string;
  if (anchorEntry && anchorEntry.count > 1) {
    const anchorId = anchorEntry.vendor.vendor_id;
    const conAssign = priced.map((line) => {
      const onAnchor = line.options.find((o) => o.vendor_id === anchorId);
      return { line, vendor: onAnchor ?? bestOption(line.options)! };
    });
    const con = buildSplit(conAssign, unassigned);
    // Only offer it if it actually uses fewer vendors and stays within budget.
    const within = recommended.total <= 0 || con.total <= recommended.total * (1 + CONSOLIDATE_THRESHOLD);
    if (con.vendor_count < recommended.vendor_count && within) {
      consolidated = con;
      const extra = con.total - recommended.total;
      note =
        extra <= 0.005
          ? `Consolidating to ${con.vendor_count} vendor${con.vendor_count === 1 ? '' : 's'} costs the same — fewer orders to place.`
          : `Consolidating to ${con.vendor_count} vendor${con.vendor_count === 1 ? '' : 's'} costs about $${extra.toFixed(2)} more (within ${Math.round(CONSOLIDATE_THRESHOLD * 100)}%) but means fewer orders.`;
    } else if (con.vendor_count < recommended.vendor_count) {
      const extra = con.total - recommended.total;
      note = `Consolidating to fewer vendors would cost about $${extra.toFixed(2)} more (over the ${Math.round(CONSOLIDATE_THRESHOLD * 100)}% threshold) — keeping the cheaper split.`;
    } else {
      note = 'No consolidation saves orders here — each vendor covers different items.';
    }
  } else {
    note = 'No single vendor covers more than one item — the split is already minimal.';
  }

  return { recommended, consolidated, consolidation_note: note };
}
