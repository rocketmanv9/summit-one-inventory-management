// Buyable item groups — shared server logic (item 11).
//
// Admins define named groups of catalog items gated to HR position titles (item
// 11 admin surface). The two consumer endpoints share position gating with item
// 04 (resolveCallerPurchaseIdentity) and the draft-PO plumbing with item 06
// (rpc_create_purchase_order + the guided-purchase helpers). This module holds
// the pieces the /mine and /request routes share: loading a caller's allowed
// groups, and resolving a catalog item's best vendor/price from vendor_items.
//
// SERVER-ONLY — pass in a tenant-scoped service-role supabase client.

import { resolveCallerPurchaseIdentity } from '@/lib/purchase-links';

/**
 * How a buyable-group item is actually fulfilled (snap-and-buy item 02):
 *  - 'catalog'       — drafts onto a PO via preferred_vendor_id / best
 *                      vendor_items row. The pre-fulfillment behavior; default.
 *  - 'vendor_item'   — pinned to one specific supply_chain.vendor_items row;
 *                      drafting always uses that row's vendor + unit_cost.
 *  - 'external_link' — ordered OUTSIDE the app (e.g. an estimator's personal
 *                      Canva file). Opened, never drafted onto a PO.
 */
export type FulfillmentKind = 'catalog' | 'vendor_item' | 'external_link';

/**
 * Per-item fulfillment info served to consumers (/mine, /preview) — ADDITIVE
 * response field; item 08 renders this on mobile. `configured_for_caller` is the
 * "will this actually work for me?" bit: false means an external_link item has
 * no URL for the caller (render "not configured for you — tell an admin") or a
 * vendor_item pin dangles. Never a silent dead-end.
 */
export interface ItemFulfillment {
  kind: FulfillmentKind;
  /** external_link only: the caller's person-link URL, else the item's fallback URL, else null. */
  url: string | null;
  /** external_link only: admin-set display label for the link (e.g. "Canva — business cards"). */
  link_label: string | null;
  /** Vendor the line would draft against (vendor_item pin, or best-known for catalog). */
  vendor_id: string | null;
  vendor: string | null;
  price: number | null;
  configured_for_caller: boolean;
}

export interface BuyableGroupItem {
  /** buyable_item_group_items.id — keys person-link overrides for external_link items. */
  group_item_id: string;
  catalog_item_id: string;
  default_qty: number;
  /** Admin-pinned vendor for this line (overrides vendor_items resolution). */
  preferred_vendor_id: string | null;
  fulfillment_kind: FulfillmentKind;
  external_url: string | null;
  link_label: string | null;
  /** vendor_item kind: the pinned supply_chain.vendor_items row. */
  vendor_item_id: string | null;
  name: string | null;
  sku: string | null;
  uom_term_id: string | null;
}

export interface BuyableGroup {
  id: string;
  name: string;
  description: string | null;
  items: BuyableGroupItem[];
}

/**
 * Load the groups (with items) the CALLER's HR position allows. Admins see every
 * active group. Position match is server-side via resolveCallerPurchaseIdentity —
 * the exact same email → hr_people → positions.title path item 04 uses.
 *
 * Returns only active groups; item names/SKUs/UOMs are joined from the inventory
 * catalog. Groups with no items are dropped (nothing to buy).
 */
export async function loadAllowedGroupsForCaller(
  supabase: any,
  tenantId: string,
  userId: string,
): Promise<{ isAdmin: boolean; positionTitle: string | null; hrPersonId: string | null; groups: BuyableGroup[] }> {
  const { isAdmin, positionTitle, hrPersonId } = await resolveCallerPurchaseIdentity(supabase, tenantId, userId);
  const groups = await loadGroupsForPosition(supabase, tenantId, { isAdmin, positionTitle });
  return { isAdmin, positionTitle, hrPersonId, groups };
}

/**
 * The position-filter + item-join core of loadAllowedGroupsForCaller, with the
 * identity supplied by the caller instead of resolved from the session. This is
 * what the admin "preview as position" surface (item 02, tyler-ideas sprint)
 * uses to answer "what will an Estimator see?" — pass { isAdmin: false,
 * positionTitle } and you get EXACTLY the consumer filter.
 */
export async function loadGroupsForPosition(
  supabase: any,
  tenantId: string,
  opts: { isAdmin: boolean; positionTitle: string | null },
): Promise<BuyableGroup[]> {
  const { isAdmin, positionTitle } = opts;
  const sc = supabase.schema('supply_chain');

  const { data: groups } = await sc
    .from('buyable_item_groups')
    .select('id, name, description, allowed_positions')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .limit(500);

  // Admins see every active group; everyone else sees only groups whose
  // allowed_positions contains their exact HR position title.
  const visible = (groups ?? []).filter((g: any) => {
    if (isAdmin) return true;
    if (!positionTitle) return false;
    return Array.isArray(g.allowed_positions) && g.allowed_positions.includes(positionTitle);
  });
  if (visible.length === 0) return [];

  const groupIds = visible.map((g: any) => g.id);
  const { data: items } = await sc
    .from('buyable_item_group_items')
    .select('id, group_id, catalog_item_id, default_qty, preferred_vendor_id, sort_order, fulfillment_kind, external_url, link_label, vendor_item_id')
    .in('group_id', groupIds)
    .order('sort_order', { ascending: true })
    .limit(5000);

  const catalogIds = new Set<string>((items ?? []).map((it: any) => it.catalog_item_id));
  const catalogMap = new Map<string, any>();
  if (catalogIds.size > 0) {
    const { data: cat } = await supabase
      .schema('inventory')
      .from('catalog_items')
      .select('id, name, sku, uom_term_id')
      .in('id', Array.from(catalogIds))
      .limit(5000);
    for (const c of cat ?? []) catalogMap.set(c.id, c);
  }

  const itemsByGroup = new Map<string, BuyableGroupItem[]>();
  for (const it of items ?? []) {
    const c = catalogMap.get(it.catalog_item_id);
    if (!itemsByGroup.has(it.group_id)) itemsByGroup.set(it.group_id, []);
    itemsByGroup.get(it.group_id)!.push({
      group_item_id: it.id,
      catalog_item_id: it.catalog_item_id,
      default_qty: it.default_qty ?? 1,
      preferred_vendor_id: it.preferred_vendor_id ?? null,
      fulfillment_kind: (it.fulfillment_kind ?? 'catalog') as FulfillmentKind,
      external_url: it.external_url ?? null,
      link_label: it.link_label ?? null,
      vendor_item_id: it.vendor_item_id ?? null,
      name: c?.name ?? null,
      sku: c?.sku ?? null,
      uom_term_id: c?.uom_term_id ?? null,
    });
  }

  const result: BuyableGroup[] = visible
    .map((g: any) => ({
      id: g.id,
      name: g.name,
      description: g.description ?? null,
      items: itemsByGroup.get(g.id) ?? [],
    }))
    .filter((g: BuyableGroup) => g.items.length > 0);

  return result;
}

/**
 * Shape a loaded group set into the consumer payload the /mine route (and the
 * preview-as admin surface) serve: each item annotated with a UOM label (GV,
 * best-effort), the best-known unit cost, and the vendor it would draft against.
 * Extracted from /mine so preview-as renders EXACTLY the consumer response.
 *
 * `callerHrPersonId` (optional) resolves external_link items to the CALLER's
 * per-person URL: person link → item external_url → null (rendered as "not
 * configured for you"). /mine passes the caller's hr_person; /preview passes
 * none (position lens has no specific person), so preview shows the fallback.
 *
 * Each item carries an ADDITIVE `fulfillment` object (see ItemFulfillment) —
 * item 08's mobile contract. Existing fields are unchanged for 'catalog' items.
 */
export async function buildConsumerGroupsPayload(
  supabase: any,
  tenantId: string,
  groups: BuyableGroup[],
  warn?: (msg: string, meta?: Record<string, unknown>) => void,
  callerHrPersonId?: string | null,
): Promise<Array<{
  group: { id: string; name: string; description: string | null };
  items: Array<{
    catalog_item_id: string;
    name: string | null;
    uom: string | null;
    default_qty: number;
    est_unit_cost: number | null;
    preferred_vendor_name: string | null;
    fulfillment: ItemFulfillment;
  }>;
}>> {
  const allItems = groups.flatMap((g) => g.items);
  const allCatalogIds = allItems
    .filter((it) => it.fulfillment_kind !== 'external_link')
    .map((it) => it.catalog_item_id);
  const uomTermIds = Array.from(
    new Set(groups.flatMap((g) => g.items.map((it) => it.uom_term_id).filter(Boolean))),
  ) as string[];

  const bestVendors = await resolveBestVendorItems(supabase, tenantId, allCatalogIds);

  // vendor_item pins: load the exact pinned rows (vendor + price come from them).
  const pinnedRows = await resolveVendorItemRows(
    supabase,
    allItems.filter((it) => it.fulfillment_kind === 'vendor_item' && it.vendor_item_id).map((it) => it.vendor_item_id!),
  );

  // external_link per-person overrides for the caller (if we know who they are).
  const linkItemIds = allItems.filter((it) => it.fulfillment_kind === 'external_link').map((it) => it.group_item_id);
  const personLinks = callerHrPersonId
    ? await loadPersonLinkUrls(supabase, tenantId, linkItemIds, callerHrPersonId)
    : new Map<string, string>();

  // UOM labels from GV — best-effort; null on failure. displayLabels resolves the
  // exact term ids (via rpc_gv_display_labels), which also picks up tenant-specific
  // terms that a domain listing (buildLabelMap) can miss.
  const uomLabels: Record<string, string> = {};
  if (uomTermIds.length > 0) {
    try {
      const { getGVClient } = await import('@/lib/gv');
      const gv = getGVClient();
      const results = await gv.displayLabels(tenantId, uomTermIds as any);
      for (const r of results) uomLabels[r.term_id as unknown as string] = r.label;
    } catch (e: any) {
      warn?.('buyable_groups.uom_labels_failed', { error: e?.message });
    }
  }

  return groups.map((g) => ({
    group: { id: g.id, name: g.name, description: g.description },
    items: g.items.map((it) => {
      // An admin-pinned vendor overrides the resolved one for the display name,
      // but we only have a price from the resolved best row.
      const best = bestVendors.get(it.catalog_item_id);
      const fulfillment = resolveItemFulfillment(it, best, pinnedRows, personLinks);
      return {
        catalog_item_id: it.catalog_item_id,
        name: it.name,
        uom: it.uom_term_id ? uomLabels[it.uom_term_id] ?? null : null,
        default_qty: it.default_qty,
        // Legacy display fields track the fulfillment resolution so pre-item-08
        // clients still show the honest vendor/price for vendor_item pins
        // (external_link items have neither — they're opened, not purchased).
        est_unit_cost: fulfillment.kind === 'catalog' ? best?.unit_cost ?? null : fulfillment.price,
        preferred_vendor_name: fulfillment.kind === 'catalog' ? best?.vendor_name ?? null : fulfillment.vendor,
        fulfillment,
      };
    }),
  }));
}

/**
 * The per-item fulfillment resolution (shared by /mine, /preview, and /request
 * documentation): catalog → best-known vendor; vendor_item → the pinned
 * vendor_items row (dangling/inactive pin = not configured); external_link →
 * caller's person link, else the item's fallback URL, else not configured.
 */
function resolveItemFulfillment(
  it: BuyableGroupItem,
  best: VendorItemBest | undefined,
  pinnedRows: Map<string, PinnedVendorItemRow>,
  personLinks: Map<string, string>,
): ItemFulfillment {
  if (it.fulfillment_kind === 'external_link') {
    const url = personLinks.get(it.group_item_id) ?? it.external_url ?? null;
    return {
      kind: 'external_link',
      url,
      link_label: it.link_label,
      vendor_id: null,
      vendor: null,
      price: null,
      configured_for_caller: url != null,
    };
  }

  if (it.fulfillment_kind === 'vendor_item') {
    const row = it.vendor_item_id ? pinnedRows.get(it.vendor_item_id) : undefined;
    return {
      kind: 'vendor_item',
      url: null,
      link_label: null,
      vendor_id: row?.vendor_id ?? null,
      vendor: row?.vendor_name ?? null,
      price: row?.unit_cost ?? null,
      configured_for_caller: !!row,
    };
  }

  return {
    kind: 'catalog',
    url: null,
    link_label: null,
    vendor_id: best?.vendor_id ?? null,
    vendor: best?.vendor_name ?? null,
    price: best?.unit_cost ?? null,
    configured_for_caller: true,
  };
}

/** A pinned vendor_items row (vendor_item fulfillment), joined with its vendor name. */
export interface PinnedVendorItemRow {
  id: string;
  vendor_id: string;
  vendor_name: string | null;
  unit_cost: number | null;
}

/**
 * Load specific vendor_items rows by id (the vendor_item pins) with vendor names.
 * Inactive or missing rows are absent from the map — the pin resolves as "not
 * configured" instead of drafting against a stale price.
 */
export async function resolveVendorItemRows(
  supabase: any,
  vendorItemIds: string[],
): Promise<Map<string, PinnedVendorItemRow>> {
  const out = new Map<string, PinnedVendorItemRow>();
  const ids = Array.from(new Set(vendorItemIds));
  if (ids.length === 0) return out;

  const sc = supabase.schema('supply_chain');
  const { data: rows } = await sc
    .from('vendor_items')
    .select('id, vendor_id, unit_cost, active')
    .in('id', ids)
    .limit(1000);

  const active = (rows ?? []).filter((r: any) => r.active !== false && r.vendor_id);
  const vendorIds = Array.from(new Set<string>(active.map((r: any) => r.vendor_id)));
  const vendorNames = new Map<string, string>();
  if (vendorIds.length > 0) {
    const { data: vendors } = await sc
      .from('vendors')
      .select('id, name')
      .in('id', vendorIds)
      .limit(1000);
    for (const v of vendors ?? []) vendorNames.set(v.id, v.name);
  }

  for (const r of active) {
    out.set(r.id, {
      id: r.id,
      vendor_id: r.vendor_id,
      vendor_name: vendorNames.get(r.vendor_id) ?? null,
      unit_cost: r.unit_cost != null ? Number(r.unit_cost) : null,
    });
  }
  return out;
}

/**
 * Active per-person link URLs for one hr_person across a set of group items.
 * Map key = group_item_id.
 */
export async function loadPersonLinkUrls(
  supabase: any,
  tenantId: string,
  groupItemIds: string[],
  hrPersonId: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (groupItemIds.length === 0) return out;

  const sc = supabase.schema('supply_chain');
  const { data: rows } = await sc
    .from('buyable_item_person_links')
    .select('group_item_id, url, active')
    .eq('tenant_id', tenantId)
    .eq('hr_person_id', hrPersonId)
    .in('group_item_id', groupItemIds)
    .limit(1000);

  for (const r of rows ?? []) {
    if (r.active !== false && r.url) out.set(r.group_item_id, r.url);
  }
  return out;
}

/** The best (cheapest, preference-weighted) vendor row for a catalog item. */
export interface VendorItemBest {
  catalog_item_id: string;
  vendor_id: string;
  unit_cost: number | null;
  vendor_name: string | null;
}

/**
 * Resolve the best vendor_items row per catalog item: preferred first, then
 * cheapest. Reads supply_chain.vendor_items (the PO-side pricing table) and joins
 * vendor names. Only active rows. Returns a map keyed by catalog_item_id; items
 * with no vendor_items row are simply absent (caller falls back to free-text).
 */
export async function resolveBestVendorItems(
  supabase: any,
  tenantId: string,
  catalogItemIds: string[],
): Promise<Map<string, VendorItemBest>> {
  const out = new Map<string, VendorItemBest>();
  if (catalogItemIds.length === 0) return out;

  const sc = supabase.schema('supply_chain');
  const { data: rows } = await sc
    .from('vendor_items')
    .select('catalog_item_id, vendor_id, unit_cost, is_preferred, active')
    .in('catalog_item_id', catalogItemIds)
    .limit(5000);

  const active = (rows ?? []).filter((r: any) => r.active !== false && r.vendor_id);
  const vendorIds = new Set<string>(active.map((r: any) => r.vendor_id));
  const vendorNames = new Map<string, string>();
  if (vendorIds.size > 0) {
    const { data: vendors } = await sc
      .from('vendors')
      .select('id, name')
      .in('id', Array.from(vendorIds))
      .limit(5000);
    for (const v of vendors ?? []) vendorNames.set(v.id, v.name);
  }

  // Pick the winning row per catalog item: preferred beats non-preferred; among
  // equals, the lower unit_cost wins (nulls rank last).
  const better = (a: any, b: any): boolean => {
    if (!!a.is_preferred !== !!b.is_preferred) return !!a.is_preferred;
    const ac = a.unit_cost == null ? Infinity : Number(a.unit_cost);
    const bc = b.unit_cost == null ? Infinity : Number(b.unit_cost);
    return ac < bc;
  };

  const winners = new Map<string, any>();
  for (const r of active) {
    const cur = winners.get(r.catalog_item_id);
    if (!cur || better(r, cur)) winners.set(r.catalog_item_id, r);
  }

  for (const [catId, r] of winners) {
    out.set(catId, {
      catalog_item_id: catId,
      vendor_id: r.vendor_id,
      unit_cost: r.unit_cost != null ? Number(r.unit_cost) : null,
      vendor_name: vendorNames.get(r.vendor_id) ?? null,
    });
  }
  return out;
}
