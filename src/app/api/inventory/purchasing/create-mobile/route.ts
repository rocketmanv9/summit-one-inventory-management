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

// ── Mobile PO create (snap-and-buy item 07) ──────────────────────────────────
//   POST /api/inventory/purchasing/create-mobile
//     body {
//       vendor_id: uuid | null,
//       delivery_method: 'ship' | 'pickup',
//       delivery_location_id?, pickup_location_id?, notes?,
//       lines: [ { catalog_item_id? | item_description?, qty, unit_cost?, uom_term_id? } ]
//     }
//     → 200 { data: { po_id, po_number, status, line_count, auto_approved, approval_reason } }
//
// The thin session-authed wrapper the phone's "Create purchase order" flow
// submits through. The web page calls supply_chain.rpc_create_purchase_order
// directly from the browser client; the mobile app has no browser Supabase
// session, so this route runs the SAME RPC server-side with the same shape of
// validation the web form enforces (vendor + delivery rules + line shape). No
// parallel PO system: routing/auto-approve/spend caps all live in the RPC, so a
// phone PO drafts/awaits approval exactly like a web one.
//
// `vendor_id: null` is the Guided-Purchase placeholder path (same convention as
// the shopping-list draft route): allowed ONLY when every line is free text —
// the PO lands on the per-tenant placeholder vendor for a buyer to source.
// Catalog lines always require a real vendor, matching the web form.

const LineSchema = z
  .object({
    catalog_item_id: z.string().uuid().nullable().optional(),
    /** Free-text line — drafted as written (needs a UOM; defaults to Each). */
    item_description: z.string().trim().min(1).max(300).optional(),
    qty: z.number().positive().max(100000),
    unit_cost: z.number().nonnegative().max(10000000).nullable().optional(),
    uom_term_id: z.string().uuid().nullable().optional(),
  })
  .refine((l) => l.catalog_item_id || l.item_description, {
    message: 'Each line needs a catalog_item_id or an item_description.',
  });

const CreateMobilePoSchema = z.object({
  vendor_id: z.string().uuid().nullable().optional(),
  delivery_method: z.enum(['ship', 'pickup']).default('ship'),
  delivery_location_id: z.string().uuid().nullable().optional(),
  pickup_location_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(LineSchema).min(1).max(100),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, idempotencyKey }) => {
  const body = CreateMobilePoSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;
  const userId = ctx.userId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  const sc = (supabase as any).schema('supply_chain');

  // ── Vendor: real vendor, or the placeholder path for free-text-only POs ────
  let vendorId: string;
  let placeholderVendor = false;
  if (body.vendor_id) {
    const { data: vendor, error: vendorErr } = await sc
      .from('vendors')
      .select('id, active')
      .eq('id', body.vendor_id)
      .limit(1)
      .maybeSingle();
    if (vendorErr) {
      log.error('create_mobile_po.vendor_lookup_failed', { error: vendorErr.message });
      throw AppError.internal(vendorErr.message);
    }
    if (!vendor) throw AppError.notFound('That vendor was not found.');
    if (!vendor.active) throw AppError.badRequest('That vendor is inactive — pick an active vendor.');
    vendorId = vendor.id;
  } else {
    if (body.lines.some((l) => l.catalog_item_id)) {
      throw AppError.badRequest(
        'Catalog items need a vendor. Pick a vendor, or submit free-text lines only and a buyer will source them.',
      );
    }
    vendorId = await resolveGuidedPurchaseVendorId(supabase, tenantId, null);
    placeholderVendor = true;
  }

  // ── Delivery: mirror the RPC's own rules with friendlier fallbacks ─────────
  let deliveryLocationId: string | null = null;
  let pickupLocationId: string | null = null;
  if (body.delivery_method === 'pickup') {
    if (!body.pickup_location_id) {
      throw AppError.badRequest('Pickup orders need a pickup location.');
    }
    pickupLocationId = body.pickup_location_id;
  } else {
    deliveryLocationId =
      body.delivery_location_id ?? (await resolveDefaultShipToLocationId(supabase, tenantId));
    if (!deliveryLocationId) {
      throw AppError.badRequest(
        'No delivery location is configured for this tenant — add a location before creating POs.',
      );
    }
  }

  // Free-text lines must carry a UOM (chk_noncatalog_has_uom) — default to Each.
  const needsUom = body.lines.some((l) => !l.catalog_item_id && !l.uom_term_id);
  const eachUom = needsUom ? await resolveEachUomTermId(tenantId) : null;
  if (needsUom && !eachUom) {
    throw AppError.internal('Could not resolve a default unit of measure for the free-text lines.');
  }

  const poLines = body.lines.map((l) =>
    l.catalog_item_id
      ? {
          catalog_item_id: l.catalog_item_id,
          qty_ordered: l.qty,
          unit_cost: l.unit_cost != null ? l.unit_cost : undefined,
          price_basis: l.unit_cost != null ? 'fixed' : 'unknown',
        }
      : {
          item_description: l.item_description,
          uom_term_id: l.uom_term_id ?? eachUom,
          qty_ordered: l.qty,
          unit_cost: l.unit_cost != null ? l.unit_cost : undefined,
          price_basis: l.unit_cost != null ? 'fixed' : 'unknown',
        },
  );

  const notes = [
    'Created from the mobile app.',
    placeholderVendor ? 'No vendor on file — assign a vendor before approving.' : null,
    body.notes?.trim() || null,
  ]
    .filter(Boolean)
    .join('\n');

  const { data: poResult, error: poErr } = await sc.rpc('rpc_create_purchase_order', {
    p_vendor_id: vendorId,
    p_delivery_method: body.delivery_method,
    p_delivery_location_id: deliveryLocationId,
    p_pickup_location_id: pickupLocationId,
    p_cost_context: 'overhead',
    p_notes: notes,
    p_lines: poLines,
    p_initiated_by: 'user',
    p_tenant_id: tenantId,
    p_acting_user_id: userId,
  });
  if (poErr) {
    log.error('create_mobile_po.rpc_failed', { vendor_id: vendorId, error: poErr.message });
    throw AppError.internal(`Purchase order creation failed: ${poErr.message}`);
  }

  return {
    data: {
      po_id: poResult?.po_id ?? null,
      po_number: poResult?.po_number ?? null,
      status: poResult?.status ?? null,
      line_count: poResult?.line_count ?? poLines.length,
      auto_approved: poResult?.auto_approved ?? false,
      approval_reason: poResult?.approval_reason ?? null,
    },
    status: 200,
    events: [
      {
        event_name: 'purchase_order.mobile_created',
        payload: {
          po_id: poResult?.po_id ?? null,
          po_number: poResult?.po_number ?? null,
          status: poResult?.status ?? null,
          vendor_id: vendorId,
          line_count: poLines.length,
        },
        last_event_id: idempotencyKey,
      },
    ],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/purchasing/create-mobile' });
