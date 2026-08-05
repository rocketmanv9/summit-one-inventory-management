/**
 * GET /api/inventory/purchasing/order-context?item_ids=a,b&location_id=x
 *
 * Powers the "order more" prefill on the Create PO page. For each catalog item
 * it returns an honest price hint, and — when a location is given — the best
 * vendor to default the PO to. All read-only, cross-schema (supply_chain +
 * inventory), so it runs server-side: the browser client can't join across
 * schemas reliably, and the in-browser RPCs return empty against prod.
 *
 * Per item it returns:
 *  - last_paid:      most recent PO line in a placed/received status (any
 *                    vendor), carrying the real paid price + date + vendor.
 *  - catalog_price:  vendor_items list price (cheapest active row) as a
 *                    fallback "catalog" estimate when there's no PO history.
 *
 * Top-level (needs a single item + location) it returns suggested_vendor:
 *  - the location's preferred vendor if they carry the item, else the vendor of
 *    the item's most recent real PO, else null — each with a `reason` for the UI.
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// PO statuses that mean the order was actually placed with the vendor — these
// lines carry a price someone committed to (vs. a draft/quote/cancelled guess).
const PLACED_STATUSES = [
  'sent', 'placed', 'acknowledged', 'ordered', 'in_transit',
  'partially_received', 'fully_received', 'closed',
];

interface PriceHint {
  unit_cost: number;
  date: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
}

interface ItemContext {
  catalog_item_id: string;
  last_paid: PriceHint | null;
  catalog_price: { unit_cost: number; vendor_id: string | null; vendor_name: string | null } | null;
}

export const GET = createSessionReadRoute(
  async ({ req, session }) => {
    const sc = getAdminClient().schema('supply_chain');
    const inv = getAdminClient().schema('inventory');
    const tenantId = session.tenantId;

    const url = new URL(req.url);
    const itemIdsParam = url.searchParams.get('item_ids') || url.searchParams.get('item_id') || '';
    const locationId = url.searchParams.get('location_id') || null;
    const itemIds = [...new Set(itemIdsParam.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 50);

    if (itemIds.length === 0) {
      return Response.json({ data: { items: {}, suggested_vendor: null } });
    }

    // --- Last paid price: most recent placed/received PO line per item ---------
    // Pull recent placed PO lines for these items, newest order first, then keep
    // the first (newest) we see for each item. Join headers for date + vendor.
    const { data: lines } = await sc
      .from('purchase_order_lines')
      .select('catalog_item_id, unit_cost, po_id')
      .eq('tenant_id', tenantId)
      .in('catalog_item_id', itemIds)
      .not('unit_cost', 'is', null)
      .gt('unit_cost', 0)
      .limit(500);

    const poIds = [...new Set((lines ?? []).map((l: any) => l.po_id))];
    const poById: Record<string, any> = {};
    if (poIds.length > 0) {
      const { data: pos } = await sc
        .from('purchase_orders')
        .select('id, status, vendor_id, vendor_name_snapshot, ordered_at, sent_at, order_date, created_at')
        .in('id', poIds)
        .in('status', PLACED_STATUSES)
        .limit(500);
      for (const po of pos ?? []) poById[po.id] = po;
    }

    // Resolve vendor names not captured in the snapshot column.
    const lineVendorIds = [
      ...new Set(Object.values(poById).map((p: any) => p.vendor_id).filter(Boolean)),
    ] as string[];

    // Effective "placed" timestamp for recency + display.
    const placedAt = (po: any): string | null =>
      po.ordered_at || po.sent_at || po.order_date || po.created_at || null;

    const lastPaidByItem: Record<string, PriceHint> = {};
    // Sort candidate lines by their PO's placed date, newest first, keep first.
    const candidates = (lines ?? [])
      .map((l: any) => ({ line: l, po: poById[l.po_id] }))
      .filter((c) => c.po) // only lines whose PO is in a placed status
      .sort((a, b) => {
        const da = placedAt(a.po) || '';
        const db = placedAt(b.po) || '';
        return db.localeCompare(da);
      });
    for (const c of candidates) {
      const itemId = c.line.catalog_item_id;
      if (lastPaidByItem[itemId]) continue;
      lastPaidByItem[itemId] = {
        unit_cost: Number(c.line.unit_cost),
        date: placedAt(c.po),
        vendor_id: c.po.vendor_id ?? null,
        vendor_name: c.po.vendor_name_snapshot ?? null,
      };
    }

    // --- Catalog fallback price: cheapest active vendor_items row per item -----
    // Note: no `active` filter — that column exists on some environments but
    // not others (schema drift), and a list price is advisory either way.
    const { data: vendorItems } = await sc
      .from('vendor_items')
      .select('catalog_item_id, unit_cost, vendor_id')
      .eq('tenant_id', tenantId)
      .in('catalog_item_id', itemIds)
      .not('unit_cost', 'is', null)
      .gt('unit_cost', 0)
      .limit(500);

    const cheapestByItem: Record<string, { unit_cost: number; vendor_id: string | null }> = {};
    for (const vi of vendorItems ?? []) {
      const itemId = vi.catalog_item_id;
      const cost = Number(vi.unit_cost);
      if (!cheapestByItem[itemId] || cost < cheapestByItem[itemId].unit_cost) {
        cheapestByItem[itemId] = { unit_cost: cost, vendor_id: vi.vendor_id ?? null };
      }
    }

    // Collect all vendor ids needing a name (from last-paid without a snapshot,
    // and from catalog rows) and resolve them in one query.
    const vendorIdsToName = [
      ...new Set([
        ...lineVendorIds,
        ...Object.values(cheapestByItem).map((c) => c.vendor_id).filter(Boolean) as string[],
      ]),
    ];
    const vendorNameById: Record<string, string> = {};
    if (vendorIdsToName.length > 0) {
      const { data: vendors } = await sc
        .from('vendors')
        .select('id, name')
        .in('id', vendorIdsToName)
        .limit(500);
      for (const v of vendors ?? []) vendorNameById[v.id] = v.name;
    }

    // Backfill last-paid vendor names from the vendors table when the PO had no
    // snapshot, and assemble per-item context.
    const items: Record<string, ItemContext> = {};
    for (const itemId of itemIds) {
      const lp = lastPaidByItem[itemId] ?? null;
      if (lp && !lp.vendor_name && lp.vendor_id) {
        lp.vendor_name = vendorNameById[lp.vendor_id] ?? null;
      }
      const cheap = cheapestByItem[itemId] ?? null;
      items[itemId] = {
        catalog_item_id: itemId,
        last_paid: lp,
        catalog_price: cheap
          ? {
              unit_cost: cheap.unit_cost,
              vendor_id: cheap.vendor_id,
              vendor_name: cheap.vendor_id ? vendorNameById[cheap.vendor_id] ?? null : null,
            }
          : null,
      };
    }

    // --- Suggested vendor for the prefill (single primary item + location) -----
    // Preferred vendor of the location if they carry the item; else the vendor
    // of the item's most recent real PO; else nothing (user picks).
    const primaryItem = itemIds[0];
    let suggestedVendor: { vendor_id: string; vendor_name: string | null; reason: string } | null = null;

    if (primaryItem) {
      let preferredVendorId: string | null = null;
      if (locationId) {
        const { data: loc } = await inv
          .from('locations')
          .select('id, name, preferred_vendor_id')
          .eq('id', locationId)
          .maybeSingle();
        preferredVendorId = (loc as any)?.preferred_vendor_id ?? null;

        if (preferredVendorId) {
          // Does the preferred vendor actually carry this item?
          const { data: carries } = await sc
            .from('vendor_items')
            .select('vendor_id')
            .eq('tenant_id', tenantId)
            .eq('vendor_id', preferredVendorId)
            .eq('catalog_item_id', primaryItem)
            .limit(1);
          if (carries && carries.length > 0) {
            const name =
              vendorNameById[preferredVendorId] ??
              (await resolveVendorName(sc, preferredVendorId));
            suggestedVendor = {
              vendor_id: preferredVendorId,
              vendor_name: name,
              reason: `Preferred vendor for ${(loc as any)?.name ?? 'this location'}`,
            };
          }
        }
      }

      // Fall back to the vendor of the item's most recent real PO.
      if (!suggestedVendor) {
        const lp = lastPaidByItem[primaryItem];
        if (lp?.vendor_id) {
          suggestedVendor = {
            vendor_id: lp.vendor_id,
            vendor_name: lp.vendor_name ?? vendorNameById[lp.vendor_id] ?? null,
            reason: 'Vendor of the most recent order for this item',
          };
        }
      }
    }

    return Response.json({ data: { items, suggested_vendor: suggestedVendor } });
  },
  { serviceName: SERVICE_NAME },
);

async function resolveVendorName(sc: any, vendorId: string): Promise<string | null> {
  const { data } = await sc.from('vendors').select('name').eq('id', vendorId).maybeSingle();
  return data?.name ?? null;
}
