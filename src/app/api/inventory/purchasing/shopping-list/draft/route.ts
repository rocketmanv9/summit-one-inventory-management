import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import {
  resolveDefaultShipToLocationId,
  resolveEachUomTermId,
  resolveGuidedPurchaseVendorId,
} from '@/lib/external-orders';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Shopping list → draft POs grouped by vendor (item 15) ────────────────────
//   POST /api/inventory/purchasing/shopping-list/draft
//     body {
//       lines: [ { catalog_item_id, qty, vendor_id? , unit_cost? } ],
//       delivery_location_id?, note?
//     }
//     → 200 { data: { purchase_orders: [ { po_id, po_number, status, vendor_id | null, line_count } ] } }
//
// The "act on it" button behind the shopping-list surface. Each line already
// carries the vendor the buyer chose (from the vendor options the /suggest route
// returned); lines with no chosen vendor (nothing on file) go as free-text lines
// on a single placeholder-vendor draft so the buyer assigns a real vendor before
// approving — never silently dropped. Lines are grouped by vendor → one DRAFT PO
// per vendor through the normal rpc_create_purchase_order path, so the standard
// approval gate always applies (item 14 makes those drafts visible). This is the
// generalized, buyer-facing twin of the buyable-groups /request route (which is
// the position-gated mobile quick-buy); the split logic here is the same one.

const DraftSchema = z.object({
  lines: z
    .array(
      z.object({
        catalog_item_id: z.string().uuid(),
        qty: z.number().positive().max(100000),
        vendor_id: z.string().uuid().nullable().optional(),
        unit_cost: z.number().nonnegative().nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
  delivery_location_id: z.string().uuid().optional(),
  note: z.string().max(2000).optional(),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, idempotencyKey }) => {
  const body = DraftSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;
  const userId = ctx.userId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  const sc = (supabase as any).schema('supply_chain');
  const inv = (supabase as any).schema('inventory');

  // Resolve item names once so free-text (no-vendor) lines carry a description.
  const catalogIds = [...new Set(body.lines.map((l) => l.catalog_item_id))];
  const { data: catRows } = await inv
    .from('catalog_items')
    .select('id, name')
    .in('id', catalogIds)
    .limit(5000);
  const nameById = new Map<string, string | null>((catRows ?? []).map((c: any) => [c.id, c.name ?? null]));

  // Delivery location: caller-provided, else the tenant's default ship-to yard.
  const deliveryLocationId = body.delivery_location_id ?? (await resolveDefaultShipToLocationId(supabase, tenantId));
  if (!deliveryLocationId) {
    throw AppError.badRequest('No delivery location is configured for this tenant — add a location before drafting POs.');
  }

  // Bucket lines by chosen vendor. `null` = no vendor → free-text placeholder PO.
  const byVendor = new Map<string | null, Array<{ catalog_item_id: string; qty: number; unit_cost: number | null }>>();
  for (const l of body.lines) {
    const vendorId = l.vendor_id ?? null;
    if (!byVendor.has(vendorId)) byVendor.set(vendorId, []);
    byVendor.get(vendorId)!.push({ catalog_item_id: l.catalog_item_id, qty: l.qty, unit_cost: l.unit_cost ?? null });
  }

  const eachUom = byVendor.has(null) ? await resolveEachUomTermId(tenantId) : null;
  const noteSuffix = body.note?.trim() ? `\nBuyer note: ${body.note.trim()}` : '';
  const createdPOs: Array<{ po_id: string | null; po_number: string | null; status: string | null; vendor_id: string | null; line_count: number }> = [];

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
      notes = `Drafted from an inventory shopping list.${noteSuffix}`;
    } else {
      poVendorId = await resolveGuidedPurchaseVendorId(supabase, tenantId, null);
      if (!eachUom) {
        throw AppError.internal('Could not resolve a default unit of measure for the unassigned-vendor draft lines.');
      }
      poLines = lines.map((l) => ({
        item_description: nameById.get(l.catalog_item_id) ?? 'Requested item',
        uom_term_id: eachUom,
        qty_ordered: l.qty,
        price_basis: 'unknown',
      }));
      notes = `Drafted from an inventory shopping list — no vendor on file; assign a vendor before approving.${noteSuffix}`;
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
    if (poErr) {
      log.error('shopping_list.draft_po_failed', { vendor_id: poVendorId, error: poErr.message });
      throw AppError.internal(`Draft PO creation failed: ${poErr.message}`);
    }

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
      event_name: 'shopping_list.drafted',
      payload: {
        line_count: body.lines.length,
        po_count: createdPOs.length,
        po_ids: createdPOs.map((p) => p.po_id).filter(Boolean),
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/purchasing/shopping-list/draft' });
