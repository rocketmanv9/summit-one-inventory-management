import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { loadAllowedGroupsForCaller, resolveBestVendorItems } from '@/lib/buyable-groups';
import {
  resolveDefaultShipToLocationId,
  resolveEachUomTermId,
  resolveGuidedPurchaseVendorId,
} from '@/lib/external-orders';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Item 12 contract (mobile quick action) ───────────────────────────────────
//   POST /api/inventory/buyable-groups/request
//     body { items: [ { catalog_item_id, qty } ], delivery_location_id?, note? }
//     → 200 { data: { purchase_orders: [ { po_id, po_number, status, vendor_id | null, line_count } ] } }
//   Validates server-side that EVERY requested item is inside a group the
//   CALLER's HR position allows (admins may buy from all). Then drafts PO(s)
//   through the normal rpc_create_purchase_order path (so the standard approval
//   gate applies — never bypassed). Lines are grouped by resolved vendor:
//   the item's admin-pinned preferred_vendor_id, else the best vendor_items row
//   (preferred, then cheapest). Items with a KNOWN vendor go on catalog lines to
//   that vendor's PO; items with NO known vendor go as free-text lines on a single
//   fallback PO billed to the per-tenant "Guided Purchase" placeholder vendor
//   (same one item 06 uses) so buyers can assign a real vendor before approving.
//   Multiple vendors → multiple draft POs (simplest correct; documented choice).
//   Auth: session, idempotent. Returns the created PO id(s)/number(s).

const RequestSchema = z.object({
  items: z
    .array(z.object({ catalog_item_id: z.string().uuid(), qty: z.number().positive().max(100000) }))
    .min(1)
    .max(200),
  delivery_location_id: z.string().uuid().optional(),
  note: z.string().max(2000).optional(),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, idempotencyKey }) => {
  const body = RequestSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;
  const userId = ctx.userId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  const sc = (supabase as any).schema('supply_chain');

  // 1) Load the caller's allowed groups and build the set of catalog items they
  //    may buy, with each item's admin-pinned preferred vendor and UOM.
  const { groups } = await loadAllowedGroupsForCaller(supabase, tenantId, userId);
  const allowed = new Map<string, { preferred_vendor_id: string | null; uom_term_id: string | null; name: string | null }>();
  for (const g of groups) {
    for (const it of g.items) {
      // First group wins if an item appears in more than one allowed group.
      if (!allowed.has(it.catalog_item_id)) {
        allowed.set(it.catalog_item_id, {
          preferred_vendor_id: it.preferred_vendor_id,
          uom_term_id: it.uom_term_id,
          name: it.name,
        });
      }
    }
  }

  // 2) Validate every requested item is allowed. Reject the whole request if any
  //    isn't — never silently drop a line the caller can't buy.
  const requested = new Map<string, number>();
  for (const it of body.items) {
    if (!allowed.has(it.catalog_item_id)) {
      throw AppError.forbidden('One or more requested items are not in a group your position is allowed to buy from.');
    }
    requested.set(it.catalog_item_id, (requested.get(it.catalog_item_id) ?? 0) + it.qty);
  }

  // 3) Resolve delivery location (caller-provided, else tenant default ship-to).
  const deliveryLocationId = body.delivery_location_id ?? (await resolveDefaultShipToLocationId(supabase, tenantId));
  if (!deliveryLocationId) {
    throw AppError.badRequest('No delivery location is configured for this tenant — add a location before requesting items.');
  }

  // 4) Resolve each item's vendor: admin pin first, else best vendor_items row.
  const catalogIds = Array.from(requested.keys());
  const bestVendors = await resolveBestVendorItems(supabase, tenantId, catalogIds);

  // Bucket lines by vendor. `null` bucket = no known vendor → free-text lines on
  // the placeholder-vendor PO.
  const byVendor = new Map<string | null, Array<{ catalog_item_id: string; qty: number; unit_cost: number | null }>>();
  for (const [catId, qty] of requested) {
    const pinned = allowed.get(catId)!.preferred_vendor_id;
    const best = bestVendors.get(catId);
    const vendorId = pinned ?? best?.vendor_id ?? null;
    const unitCost = pinned ? null : best?.unit_cost ?? null;
    if (!byVendor.has(vendorId)) byVendor.set(vendorId, []);
    byVendor.get(vendorId)!.push({ catalog_item_id: catId, qty, unit_cost: unitCost });
  }

  // Free-text lines (no vendor) need a UOM; default to Each like item 06.
  const eachUom = byVendor.has(null) ? await resolveEachUomTermId(tenantId) : null;

  const noteSuffix = body.note?.trim() ? `\nRequester note: ${body.note.trim()}` : '';
  const createdPOs: Array<{ po_id: string | null; po_number: string | null; status: string | null; vendor_id: string | null; line_count: number }> = [];

  // 5) Draft one PO per vendor bucket through the normal RPC (approval gate applies).
  for (const [vendorId, lines] of byVendor) {
    let poVendorId: string;
    let poLines: any[];
    let notes: string;

    if (vendorId) {
      poVendorId = vendorId;
      poLines = lines.map((l) => ({
        catalog_item_id: l.catalog_item_id,
        qty_ordered: l.qty,
        unit_cost: l.unit_cost != null ? l.unit_cost : undefined,
        price_basis: l.unit_cost != null ? 'fixed' : 'unknown',
      }));
      notes = `Requested via inventory quick-buy (buyable item group).${noteSuffix}`;
    } else {
      // No known vendor — free-text lines on the placeholder vendor PO so a buyer
      // assigns the real vendor before approving.
      poVendorId = await resolveGuidedPurchaseVendorId(supabase, tenantId, null);
      if (!eachUom) {
        throw AppError.internal('Could not resolve a default unit of measure for the unassigned-vendor draft lines.');
      }
      poLines = lines.map((l) => ({
        item_description: allowed.get(l.catalog_item_id)?.name ?? 'Requested item',
        uom_term_id: eachUom,
        qty_ordered: l.qty,
        price_basis: 'unknown',
      }));
      notes = `Requested via inventory quick-buy — no preferred vendor on file; assign a vendor before approving.${noteSuffix}`;
    }

    const { data: poResult, error: poErr } = await sc.rpc('rpc_create_purchase_order', {
      p_vendor_id: poVendorId,
      p_delivery_method: 'ship',
      p_delivery_location_id: deliveryLocationId,
      p_cost_context: 'overhead',
      p_notes: notes,
      p_lines: poLines,
      p_initiated_by: 'user',
      p_tenant_id: tenantId,
      p_acting_user_id: userId,
    });
    if (poErr) { log.error('buyable_groups.request_po_failed', { vendor_id: poVendorId, error: poErr.message }); throw AppError.internal(`Draft PO creation failed: ${poErr.message}`); }

    createdPOs.push({
      po_id: poResult?.po_id ?? null,
      po_number: poResult?.po_number ?? null,
      status: poResult?.status ?? null,
      vendor_id: vendorId,
      line_count: poLines.length,
    });
  }

  return {
    data: { purchase_orders: createdPOs },
    status: 200,
    events: [{
      event_name: 'buyable_item_group.requested',
      payload: {
        item_count: body.items.length,
        po_count: createdPOs.length,
        po_ids: createdPOs.map((p) => p.po_id).filter(Boolean),
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/buyable-groups/request' });
