// Isabelle's vendor recommender — shared server logic (sprint item 01).
//
// Answers "who should I buy <item> from?" with a ranked, honest, tiered list:
//
//   Tier 1 (tenant)  — vendors you already deal with, ranked exactly the way the
//                      draft-PO / shopping-list resolver ranks: preferred first,
//                      then cheapest. Carries unit_cost, lead_time_days, min_order_qty
//                      and a `fastest` marker so "cheapest vs fastest" is answerable,
//                      plus a `last_paid` signal (most recent placed PO for the item).
//   Tier 2 (catalog) — only when you have NO vendors on file for the item: up to 3
//                      real candidates from the shared GV vendor_catalog, matched by
//                      the item's category → an industry tag (best-effort).
//   Tier 3 (web)     — when Tiers 1 & 2 are both empty: a flag that a web search is
//                      available (item 04 owns actually running it) plus a suggested
//                      query. No web call happens here.
//
// This DELIBERATELY reuses the existing per-item vendor_items ranking that
// /api/inventory/purchasing/shopping-list/suggest and @/lib/shopping-list already
// implement — it does not fork or mutate that logic. The tenant tier below reads
// the exact same active vendor_items rows and applies the exact same sort
// (preferred, then cheapest, nulls last) those flows use.
//
// SERVER-ONLY. Pass a tenant-scoped service-role supabase client.

import { getCatalogClient } from '@/lib/vendors';

// PO statuses that mean the order was actually placed — same list the shopping-list
// suggest route and Create-PO order-context use for the last_paid signal.
const PLACED_STATUSES = [
  'sent', 'placed', 'acknowledged', 'ordered', 'in_transit',
  'partially_received', 'fully_received', 'closed',
];

export interface TenantVendorOption {
  vendor_id: string;
  vendor_name: string | null;
  unit_cost: number | null;
  lead_time_days: number | null;
  min_order_qty: number | null;
  is_preferred: boolean;
  /** True for the single lowest-lead-time option (answers "who's fastest?"). */
  is_fastest: boolean;
  source: 'tenant';
}

export interface CatalogVendorOption {
  catalog_vendor_id: string;
  name: string;
  city: string | null;
  state: string | null;
  industry_tags: string[];
  source: 'catalog';
}

export interface RecommendVendorResult {
  resolved: boolean;
  item: { id: string; name: string | null; uom_term_id: string | null } | null;
  /** Which tier the options came from. 'none' only when the item didn't resolve. */
  tier: 'tenant' | 'catalog' | 'web' | 'none';
  /** The single best pick (tenant tier only), with a plain-language reason. */
  recommended: { vendor_id: string; reason: 'preferred' | 'cheapest' | 'only' } | null;
  /** Tenant options OR catalog candidates, depending on tier. */
  options: TenantVendorOption[] | CatalogVendorOption[];
  /** Most recent placed-PO price for the item (tenant tier), when known. */
  last_paid: { unit_cost: number; date: string | null; vendor_name: string | null } | null;
  web_search_available: boolean;
  suggested_query: string | null;
  /** Short human-readable summary Isabelle can read back verbatim. */
  message: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lowercase, collapse whitespace and punctuation for token comparison. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/**
 * Lightweight English singularizer so "Fuel Cans" resolves to "Fuel Can".
 * Not a full stemmer — just folds the common plural endings so token-overlap
 * scoring and ilike matching don't miss on a trailing "s". Leaves short words
 * ("gas", "ppe") and already-singular words alone.
 */
function singularize(w: string): string {
  if (w.length <= 3) return w;
  if (/(ss|us|is)$/.test(w)) return w; // glass, status, axis — not plurals
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y'; // batteries → battery
  if (/(ches|shes|xes|zes|ses)$/.test(w)) return w.slice(0, -2); // boxes → box
  if (/s$/.test(w)) return w.slice(0, -1); // cans → can
  return w;
}

function tokens(s: string): string[] {
  return norm(s)
    .split(' ')
    .filter((t) => t.length > 1)
    .map(singularize);
}

// Best-effort keyword → industry_tag mapping. GV item categories rarely carry a
// gv_category_term_id, so we lean on the category name + item name text. These
// codes are the real vendor_catalog_industry_tags vocabulary (lowercased to match
// what the catalog client returns).
const TAG_KEYWORDS: Array<{ tag: string; words: string[] }> = [
  { tag: 'asphalt', words: ['asphalt', 'hma', 'hot mix', 'bitumen', 'tack', 'binder', 'aggregate base'] },
  { tag: 'paving', words: ['pave', 'paving', 'paver'] },
  { tag: 'pavement', words: ['pavement', 'crack', 'sealcoat', 'seal coat', 'striping', 'wheel stop', 'wheelstop'] },
  { tag: 'concrete', words: ['concrete', 'ready-mix', 'ready mix', 'rebar', 'cement', 'sand', 'gravel', 'aggregate'] },
  { tag: 'masonry', words: ['masonry', 'brick', 'block', 'mortar', 'stone'] },
  { tag: 'coating', words: ['coating', 'sealant', 'sealer', 'epoxy'] },
  { tag: 'paint', words: ['paint', 'primer', 'striping paint'] },
  { tag: 'chemicals', words: ['chemical', 'solvent', 'additive', 'admixture'] },
  { tag: 'equipment', words: ['equipment', 'excavator', 'loader', 'compactor', 'roller', 'machine', 'tool'] },
  { tag: 'rental', words: ['rental', 'rent', 'lease'] },
  { tag: 'maintenance', words: ['maintenance', 'repair', 'parts', 'filter', 'lubricant', 'grease', 'oil'] },
  { tag: 'industrial', words: ['industrial', 'fastener', 'hardware', 'bolt', 'nut'] },
];

/**
 * Best-effort map the item's category name + item name to one or more GV industry
 * tag codes. Returns tags in priority order (most specific first). Empty when
 * nothing recognisable — the caller then queries the catalog broadly.
 */
export function inferIndustryTags(itemName: string | null, categoryName: string | null): string[] {
  const hay = norm([itemName, categoryName].filter(Boolean).join(' '));
  if (!hay) return [];
  const hits: string[] = [];
  for (const { tag, words } of TAG_KEYWORDS) {
    if (words.some((w) => hay.includes(w))) hits.push(tag);
  }
  return hits;
}

/**
 * Resolve an item_ref (UUID or free text) to a catalog item. Exported so other
 * Isabelle tools (e.g. draft_po_preview) resolve item names the exact same way —
 * one predictable, LLM-free matcher, no forks.
 */
export async function resolveItem(
  supabase: any,
  itemRef: string,
): Promise<{ id: string; name: string | null; uom_term_id: string | null; category_id: string | null } | null> {
  const inv = supabase.schema('inventory');
  const ref = itemRef.trim();

  // 1) Direct UUID.
  if (UUID_RE.test(ref)) {
    const { data } = await inv
      .from('catalog_items')
      .select('id, name, uom_term_id, category_id')
      .eq('id', ref)
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }

  const nq = norm(ref);
  if (!nq) return null;

  // 2) Exact name match (case-insensitive), then a scoped ilike, then token-overlap
  //    fuzzy — the same predictable, LLM-free resolution the shopping-list matcher
  //    uses for pasted lines.
  const { data: exact } = await inv
    .from('catalog_items')
    .select('id, name, uom_term_id, category_id')
    .eq('active', true)
    .ilike('name', ref)
    .limit(1)
    .maybeSingle();
  if (exact) return exact;

  const { data: like } = await inv
    .from('catalog_items')
    .select('id, name, uom_term_id, category_id')
    .eq('active', true)
    .ilike('name', `%${ref}%`)
    .limit(10);
  if (like && like.length > 0) {
    // Prefer the shortest name that contains the query (tightest match).
    const sorted = [...like].sort((a: any, b: any) => (a.name?.length ?? 999) - (b.name?.length ?? 999));
    return sorted[0];
  }

  // 3) Token-overlap fuzzy over the active catalog.
  const qToks = new Set(tokens(ref));
  if (qToks.size === 0) return null;
  const { data: all } = await inv
    .from('catalog_items')
    .select('id, name, uom_term_id, category_id')
    .eq('active', true)
    .limit(5000);
  let best: { row: any; score: number } | null = null;
  for (const row of all ?? []) {
    const cToks = new Set(tokens(row.name ?? ''));
    if (cToks.size === 0) continue;
    let inter = 0;
    for (const t of qToks) if (cToks.has(t)) inter++;
    if (inter === 0) continue;
    const union = qToks.size + cToks.size - inter;
    const score = inter / union;
    if (!best || score > best.score) best = { row, score };
  }
  if (best && best.score >= 0.34) return best.row;
  return null;
}

/**
 * Core recommender. Resolves the item, builds the tenant tier from the SAME active
 * vendor_items rows + ranking the shopping-list flow uses, and falls back to the GV
 * catalog then a web-available flag. Never throws on "nothing found" — returns a
 * resolved:false / empty-options result the caller/UI handles.
 */
export async function recommendVendorForItem(
  supabase: any,
  tenantId: string,
  input: { item_ref: string; qty?: number; location_id?: string },
): Promise<RecommendVendorResult> {
  const empty = (over: Partial<RecommendVendorResult>): RecommendVendorResult => ({
    resolved: false,
    item: null,
    tier: 'none',
    recommended: null,
    options: [],
    last_paid: null,
    web_search_available: false,
    suggested_query: null,
    message: '',
    ...over,
  });

  const itemRef = (input.item_ref ?? '').trim();
  if (!itemRef) {
    return empty({ message: 'No item was specified. Tell me what you need a vendor for.' });
  }

  const item = await resolveItem(supabase, itemRef);
  if (!item) {
    return empty({
      message: `I couldn't find "${itemRef}" in the catalog. Add it first, then I can recommend a vendor.`,
    });
  }

  const inv = supabase.schema('inventory');
  const sc = supabase.schema('supply_chain');

  // ── Tier 1: tenant vendors from active vendor_items ─────────────────────────
  const { data: viRows } = await sc
    .from('vendor_items')
    .select('vendor_id, unit_cost, lead_time_days, min_order_qty, is_preferred, active')
    .eq('catalog_item_id', item.id)
    .limit(5000);
  const activeVi = (viRows ?? []).filter((r: any) => r.active !== false && r.vendor_id);

  if (activeVi.length > 0) {
    const vendorIds = [...new Set(activeVi.map((r: any) => r.vendor_id))];
    const vendorNames = new Map<string, string>();
    const { data: vendors } = await sc.from('vendors').select('id, name').in('id', vendorIds).limit(5000);
    for (const v of vendors ?? []) vendorNames.set(v.id, v.name);

    // Dedupe per vendor: keep preferred, else cheapest (mirrors the suggest route).
    const byVendor = new Map<string, TenantVendorOption>();
    for (const r of activeVi) {
      const opt: TenantVendorOption = {
        vendor_id: r.vendor_id,
        vendor_name: vendorNames.get(r.vendor_id) ?? null,
        unit_cost: r.unit_cost != null ? Number(r.unit_cost) : null,
        lead_time_days: r.lead_time_days != null ? Number(r.lead_time_days) : null,
        min_order_qty: r.min_order_qty != null ? Number(r.min_order_qty) : null,
        is_preferred: !!r.is_preferred,
        is_fastest: false,
        source: 'tenant',
      };
      const cur = byVendor.get(r.vendor_id);
      const better =
        !cur ||
        (opt.is_preferred && !cur.is_preferred) ||
        (opt.is_preferred === cur.is_preferred && (opt.unit_cost ?? Infinity) < (cur.unit_cost ?? Infinity));
      if (better) byVendor.set(r.vendor_id, opt);
    }

    const options = [...byVendor.values()].sort((a, b) => {
      if (a.is_preferred !== b.is_preferred) return a.is_preferred ? -1 : 1;
      return (a.unit_cost ?? Number.MAX_VALUE) - (b.unit_cost ?? Number.MAX_VALUE);
    });

    // Mark the single fastest option (lowest known lead time).
    let fastestIdx = -1;
    for (let i = 0; i < options.length; i++) {
      const lt = options[i].lead_time_days;
      if (lt == null) continue;
      if (fastestIdx < 0 || lt < (options[fastestIdx].lead_time_days ?? Infinity)) fastestIdx = i;
    }
    if (fastestIdx >= 0) options[fastestIdx].is_fastest = true;

    // last_paid: most recent placed/received PO line for this item.
    const lastPaid = await fetchLastPaid(sc, tenantId, item.id, vendorNames);

    const top = options[0];
    const reason: 'preferred' | 'cheapest' | 'only' =
      options.length === 1 ? 'only' : top.is_preferred ? 'preferred' : 'cheapest';
    const price = top.unit_cost != null ? ` at $${top.unit_cost.toFixed(2)}` : '';
    const reasonText =
      reason === 'preferred' ? 'your preferred vendor' : reason === 'cheapest' ? 'the cheapest option' : 'your only vendor on file';
    const message =
      `For ${item.name}, I'd go with ${top.vendor_name ?? 'a vendor'}${price} — ${reasonText}.` +
      (options.length > 1 ? ` ${options.length} vendors carry it.` : '');

    return {
      resolved: true,
      item: { id: item.id, name: item.name, uom_term_id: item.uom_term_id },
      tier: 'tenant',
      recommended: { vendor_id: top.vendor_id, reason },
      options,
      last_paid: lastPaid,
      web_search_available: false,
      suggested_query: null,
      message,
    };
  }

  // ── Tier 2: GV catalog fallback ─────────────────────────────────────────────
  let categoryName: string | null = null;
  if (item.category_id) {
    const { data: cat } = await inv
      .from('item_categories')
      .select('name')
      .eq('id', item.category_id)
      .limit(1)
      .maybeSingle();
    categoryName = cat?.name ?? null;
  }

  const catalogOptions = await fetchCatalogCandidates(item.name, categoryName);
  if (catalogOptions.length > 0) {
    const message =
      `You don't have a vendor on file for ${item.name} yet. From the shared catalog, ` +
      `${catalogOptions.map((c) => c.name).join(', ')} look like good fits — say "add <name> from the catalog" to bring one in.`;
    return {
      resolved: true,
      item: { id: item.id, name: item.name, uom_term_id: item.uom_term_id },
      tier: 'catalog',
      recommended: null,
      options: catalogOptions,
      last_paid: null,
      web_search_available: false,
      suggested_query: null,
      message,
    };
  }

  // ── Tier 3: web search available ────────────────────────────────────────────
  const city = await fetchLocationCity(inv, tenantId, input.location_id);
  const suggestedQuery = `${item.name} supplier${city ? ` near ${city}` : ''}`.trim();
  return {
    resolved: true,
    item: { id: item.id, name: item.name, uom_term_id: item.uom_term_id },
    tier: 'web',
    recommended: null,
    options: [],
    last_paid: null,
    web_search_available: true,
    suggested_query: suggestedQuery,
    message:
      `No vendors on file for ${item.name} and nothing matched in the shared catalog. ` +
      `I can search the web — try "${suggestedQuery}".`,
  };
}

/** Most recent placed/received PO line price for an item, or null. */
async function fetchLastPaid(
  sc: any,
  tenantId: string,
  catalogItemId: string,
  vendorNames: Map<string, string>,
): Promise<{ unit_cost: number; date: string | null; vendor_name: string | null } | null> {
  const { data: poLines } = await sc
    .from('purchase_order_lines')
    .select('unit_cost, po_id')
    .eq('tenant_id', tenantId)
    .eq('catalog_item_id', catalogItemId)
    .not('unit_cost', 'is', null)
    .gt('unit_cost', 0)
    .limit(1000);
  const poIds = [...new Set((poLines ?? []).map((l: any) => l.po_id))];
  if (poIds.length === 0) return null;
  const { data: pos } = await sc
    .from('purchase_orders')
    .select('id, status, vendor_id, vendor_name_snapshot, ordered_at, sent_at, order_date, created_at')
    .in('id', poIds)
    .in('status', PLACED_STATUSES)
    .limit(1000);
  const poById = new Map<string, any>((pos ?? []).map((p: any) => [p.id, p]));
  const placedAt = (po: any): string | null => po.ordered_at || po.sent_at || po.order_date || po.created_at || null;
  const candidates = (poLines ?? [])
    .map((l: any) => ({ line: l, po: poById.get(l.po_id) }))
    .filter((c: any) => c.po)
    .sort((a: any, b: any) => (placedAt(b.po) || '').localeCompare(placedAt(a.po) || ''));
  const winner = candidates[0];
  if (!winner) return null;
  return {
    unit_cost: Number(winner.line.unit_cost),
    date: placedAt(winner.po),
    vendor_name: winner.po.vendor_name_snapshot ?? (winner.po.vendor_id ? vendorNames.get(winner.po.vendor_id) ?? null : null),
  };
}

/**
 * Up to 3 GV vendor_catalog candidates for the item, ranked by industry-tag
 * overlap. Best-effort: infer tags from item/category name; when nothing's
 * inferable, browse the catalog broadly and rank by how many inferred tags each
 * vendor carries (so a totally unknown item still returns generalists).
 */
async function fetchCatalogCandidates(
  itemName: string | null,
  categoryName: string | null,
): Promise<CatalogVendorOption[]> {
  let catalog: ReturnType<typeof getCatalogClient>;
  try {
    catalog = getCatalogClient();
  } catch {
    return [];
  }

  const wantedTags = inferIndustryTags(itemName, categoryName);

  let vendors: any[] = [];
  try {
    if (wantedTags.length > 0) {
      // Pull vendors for the most-specific inferred tag first, widening as needed.
      const seen = new Set<string>();
      for (const tag of wantedTags) {
        const rows = await catalog.list({ industry: tag, activeOnly: true }).catch(() => []);
        for (const v of rows) {
          if (!seen.has(v.id)) { seen.add(v.id); vendors.push(v); }
        }
        if (vendors.length >= 8) break;
      }
    }
    // Fall back to a broad list when tag-filtered came up empty.
    if (vendors.length === 0) {
      vendors = await catalog.list({ activeOnly: true }).catch(() => []);
    }
  } catch {
    return [];
  }

  if (vendors.length === 0) return [];

  // Rank by overlap between the vendor's tags and our inferred tags; ties keep
  // catalog order. When we inferred nothing, all overlaps are 0 and we just take
  // the first few generalists.
  const scored = vendors.map((v: any) => {
    const tags: string[] = (v.industry_tags || v.tags || []).map((t: string) => t.toLowerCase());
    const overlap = wantedTags.filter((t) => tags.includes(t)).length;
    return { v, tags, overlap };
  });
  scored.sort((a, b) => b.overlap - a.overlap);
  const top = scored.slice(0, 3);

  // Fetch city/state best-effort (catalog addresses are sparse; never block on it).
  const out: CatalogVendorOption[] = [];
  for (const { v, tags } of top) {
    let city: string | null = null;
    let state: string | null = null;
    try {
      const addrs = await catalog.listAddresses(v.id);
      const primary = addrs.find((a: any) => a.address_type === 'general') || addrs[0];
      if (primary) { city = primary.city ?? null; state = primary.state ?? null; }
    } catch {
      /* addresses optional */
    }
    out.push({
      catalog_vendor_id: v.id,
      name: v.name,
      city,
      state,
      industry_tags: tags,
      source: 'catalog',
    });
  }
  return out;
}

/** Location city for a suggested web-search query, or null. */
async function fetchLocationCity(inv: any, tenantId: string, locationId?: string): Promise<string | null> {
  try {
    if (locationId) {
      const { data } = await inv
        .from('locations')
        .select('city, state')
        .eq('tenant_id', tenantId)
        .eq('id', locationId)
        .limit(1)
        .maybeSingle();
      if (data?.city) return [data.city, data.state].filter(Boolean).join(', ');
    }
    // No location given — use any active location with a city on file.
    const { data } = await inv
      .from('locations')
      .select('city, state')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .not('city', 'is', null)
      .limit(1)
      .maybeSingle();
    if (data?.city) return [data.city, data.state].filter(Boolean).join(', ');
  } catch {
    /* best effort */
  }
  return null;
}
