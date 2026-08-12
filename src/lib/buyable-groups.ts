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

export interface BuyableGroupItem {
  catalog_item_id: string;
  default_qty: number;
  /** Admin-pinned vendor for this line (overrides vendor_items resolution). */
  preferred_vendor_id: string | null;
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
): Promise<{ isAdmin: boolean; positionTitle: string | null; groups: BuyableGroup[] }> {
  const { isAdmin, positionTitle } = await resolveCallerPurchaseIdentity(supabase, tenantId, userId);
  const groups = await loadGroupsForPosition(supabase, tenantId, { isAdmin, positionTitle });
  return { isAdmin, positionTitle, groups };
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
    .select('group_id, catalog_item_id, default_qty, preferred_vendor_id, sort_order')
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
      catalog_item_id: it.catalog_item_id,
      default_qty: it.default_qty ?? 1,
      preferred_vendor_id: it.preferred_vendor_id ?? null,
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
 */
export async function buildConsumerGroupsPayload(
  supabase: any,
  tenantId: string,
  groups: BuyableGroup[],
  warn?: (msg: string, meta?: Record<string, unknown>) => void,
): Promise<Array<{
  group: { id: string; name: string; description: string | null };
  items: Array<{
    catalog_item_id: string;
    name: string | null;
    uom: string | null;
    default_qty: number;
    est_unit_cost: number | null;
    preferred_vendor_name: string | null;
  }>;
}>> {
  const allCatalogIds = groups.flatMap((g) => g.items.map((it) => it.catalog_item_id));
  const uomTermIds = Array.from(
    new Set(groups.flatMap((g) => g.items.map((it) => it.uom_term_id).filter(Boolean))),
  ) as string[];

  const bestVendors = await resolveBestVendorItems(supabase, tenantId, allCatalogIds);

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
      return {
        catalog_item_id: it.catalog_item_id,
        name: it.name,
        uom: it.uom_term_id ? uomLabels[it.uom_term_id] ?? null : null,
        default_qty: it.default_qty,
        est_unit_cost: best?.unit_cost ?? null,
        preferred_vendor_name: best?.vendor_name ?? null,
      };
    }),
  }));
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
