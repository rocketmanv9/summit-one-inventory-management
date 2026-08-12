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
 *
 * When a location is given it also returns, per item, the "smart flags" the
 * Create PO page shows to discourage buying what the company already has:
 *  - stock:     on-hand/available at the destination yard and at every other
 *               yard (available = qty_on_hand − qty_reserved), so the UI can
 *               flag "already N here" and "surplus at another yard — transfer?".
 *  - open_pos:  live purchase orders (placed, not yet fully received) already
 *               covering this item — "already on order".
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

// PO statuses that mean the order is live and still coming — buying more of the
// same item risks double-ordering. Draft/awaiting-approval count (someone is
// already trying to buy it); fully_received/closed/cancelled/voided do not.
const OPEN_PO_STATUSES = [
  'draft', 'awaiting_approval', 'pending_approval', 'approved',
  'sent', 'placed', 'acknowledged', 'ordered', 'in_transit', 'partially_received',
];

interface PriceHint {
  unit_cost: number;
  date: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
}

/** Stock at one yard for one item, available = on_hand − reserved. */
interface StockAtLocation {
  location_id: string;
  location_name: string | null;
  on_hand: number;
  reserved: number;
  available: number;
}

/** A live PO already covering an item — feeds the "already on order" flag. */
interface OpenPO {
  po_id: string;
  po_number: string | null;
  status: string;
  qty_outstanding: number;
  placed_at: string | null;
  vendor_name: string | null;
}

interface ItemContext {
  catalog_item_id: string;
  last_paid: PriceHint | null;
  catalog_price: { unit_cost: number; vendor_id: string | null; vendor_name: string | null } | null;
  /** On-hand/available at the destination yard (present when a location is given). */
  stock_here: StockAtLocation | null;
  /** Other yards with available stock, best (most available) first. */
  stock_elsewhere: StockAtLocation[];
  /** Live POs already covering this item, newest first. */
  open_pos: OpenPO[];
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

    // --- Smart flags: stock on hand by location + open POs (per item) ---------
    // Both are batched across all items in one query each, so adding lines never
    // fans out into N+1. Stock joins location names; available = on_hand −
    // reserved (the balance table already tracks reserved). Only computed when a
    // destination location is given (the flags are relative to where it ships).
    const stockByItem: Record<string, StockAtLocation[]> = {};
    const openPosByItem: Record<string, OpenPO[]> = {};

    if (locationId) {
      const { data: balances } = await inv
        .from('stock_balances')
        .select('catalog_item_id, location_id, qty_on_hand, qty_reserved, qty_available')
        .eq('tenant_id', tenantId)
        .in('catalog_item_id', itemIds)
        .limit(2000);

      const balanceLocIds = [...new Set((balances ?? []).map((b: any) => b.location_id).filter(Boolean))];
      const locNameById: Record<string, string> = {};
      if (balanceLocIds.length > 0) {
        const { data: locs } = await inv
          .from('locations')
          .select('id, name')
          .in('id', balanceLocIds)
          .limit(2000);
        for (const l of locs ?? []) locNameById[l.id] = l.name;
      }

      for (const b of balances ?? []) {
        const onHand = Number(b.qty_on_hand ?? 0);
        const reserved = Number(b.qty_reserved ?? 0);
        // Trust the stored available when present, else derive it.
        const available = b.qty_available != null ? Number(b.qty_available) : onHand - reserved;
        (stockByItem[b.catalog_item_id] ||= []).push({
          location_id: b.location_id,
          location_name: locNameById[b.location_id] ?? null,
          on_hand: onHand,
          reserved,
          available,
        });
      }

      // Open POs already covering these items: pull live-status headers, then
      // their lines for our items, and sum outstanding qty (ordered − received)
      // per (item, PO). One header query + one line query — no per-item calls.
      const { data: openPoHeaders } = await sc
        .from('purchase_orders')
        .select('id, po_number, status, vendor_id, vendor_name_snapshot, ordered_at, sent_at, order_date, created_at')
        .eq('tenant_id', tenantId)
        .in('status', OPEN_PO_STATUSES)
        .order('created_at', { ascending: false })
        .limit(500);

      const openPoById: Record<string, any> = {};
      for (const po of openPoHeaders ?? []) openPoById[po.id] = po;
      const openPoIds = Object.keys(openPoById);

      if (openPoIds.length > 0) {
        const { data: openLines } = await sc
          .from('purchase_order_lines')
          .select('catalog_item_id, po_id, qty_ordered, qty_received')
          .eq('tenant_id', tenantId)
          .in('catalog_item_id', itemIds)
          .in('po_id', openPoIds)
          .limit(2000);

        // Sum outstanding per (item, po) so a PO with the item on two lines
        // shows once with the combined remaining quantity.
        const outstandingByItemPo: Record<string, Record<string, number>> = {};
        for (const ln of openLines ?? []) {
          const outstanding = Math.max(0, Number(ln.qty_ordered ?? 0) - Number(ln.qty_received ?? 0));
          if (outstanding <= 0) continue;
          const perPo = (outstandingByItemPo[ln.catalog_item_id] ||= {});
          perPo[ln.po_id] = (perPo[ln.po_id] ?? 0) + outstanding;
        }

        // Names for any open-PO vendor not carried in the snapshot column.
        const openVendorIds = [
          ...new Set(
            Object.values(openPoById)
              .filter((p: any) => !p.vendor_name_snapshot && p.vendor_id)
              .map((p: any) => p.vendor_id),
          ),
        ] as string[];
        const missing = openVendorIds.filter((id) => !vendorNameById[id]);
        if (missing.length > 0) {
          const { data: vs } = await sc.from('vendors').select('id, name').in('id', missing).limit(500);
          for (const v of vs ?? []) vendorNameById[v.id] = v.name;
        }

        for (const [itemId, perPo] of Object.entries(outstandingByItemPo)) {
          const rows: OpenPO[] = Object.entries(perPo).map(([poId, qty]) => {
            const po = openPoById[poId];
            return {
              po_id: poId,
              po_number: po?.po_number ?? null,
              status: po?.status ?? '',
              qty_outstanding: qty,
              placed_at: placedAt(po),
              vendor_name: po?.vendor_name_snapshot ?? (po?.vendor_id ? vendorNameById[po.vendor_id] ?? null : null),
            };
          });
          // Newest first (undated last).
          rows.sort((a, b) => (b.placed_at || '').localeCompare(a.placed_at || ''));
          openPosByItem[itemId] = rows;
        }
      }
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
      const stockRows = stockByItem[itemId] ?? [];
      const stockHere = locationId ? stockRows.find((s) => s.location_id === locationId) ?? null : null;
      const stockElsewhere = stockRows
        .filter((s) => s.location_id !== locationId && s.available > 0)
        .sort((a, b) => b.available - a.available);
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
        stock_here: stockHere,
        stock_elsewhere: stockElsewhere,
        open_pos: openPosByItem[itemId] ?? [],
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
