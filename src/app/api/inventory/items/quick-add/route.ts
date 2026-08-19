import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { getGVClient } from '@/lib/gv';
import { resolveEachUomTermId } from '@/lib/external-orders';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Mobile "quick add a vendor item" (create-a-PO enhancement) ────────────────
//   POST /api/inventory/items/quick-add
//     body {
//       name, description?, unit_of_measure? (label, default 'EA'), uom_term_id?,
//       tracking_mode?, reorder_point?, sku_prefix?,
//       category_id? | new_category_name?,
//       vendor_id (required), vendor_unit_cost?
//     }
//     → 201 { data: { catalog_item_id, item_sku, vendor_item_id, idempotent_hit } }
//
// The phone PO composer lets a user type a free-text line for a vendor that has
// no matching catalog item yet. This route atomically creates the catalog item
// (optionally a new category) AND ties it to the vendor with a price by calling
// inventory.rpc_wizard_create_item — the same atomic wizard the web "Add Item"
// flow and the AI assistant use. It is NOT a parallel item system.
//
// The wizard reads its acting identity from the JWT normally, but a tenant
// service client carries no tenant/user claims, so we pass p_tenant_id +
// p_acting_user_id explicitly (service_role-only params). catalog_items.uom_term_id
// is NOT NULL, so we always resolve a UOM term id — the AI suggestion's resolved
// uom_term_id when present, else the label via GV, else the tenant's "EA" term.

const QuickAddSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required').max(200),
  description: z.string().max(2000).nullable().optional(),
  /** UOM as a display label (e.g. 'Each'); resolved to a GV term server-side. */
  unit_of_measure: z.string().max(60).optional(),
  /** Pre-resolved GV uom term id (from the AI suggestion) — preferred when set. */
  uom_term_id: z.string().uuid().nullable().optional(),
  /** AI vocabulary: 'stock' | 'serialized' | 'both' — mapped to catalog vocab. */
  tracking_mode: z.string().max(30).optional(),
  reorder_point: z.number().nonnegative().max(1000000).nullable().optional(),
  sku_prefix: z.string().max(10).nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  new_category_name: z.string().trim().min(1).max(120).nullable().optional(),
  vendor_id: z.string().uuid({ message: 'A vendor is required to add an item.' }),
  vendor_unit_cost: z.number().nonnegative().max(10000000).nullable().optional(),
});

/** Map the AI/label tracking vocabulary to catalog_items.tracking_mode (stock|asset|loose). */
function toCatalogTrackingMode(raw: string | undefined): 'stock' | 'asset' {
  return raw === 'serialized' ? 'asset' : 'stock';
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, idempotencyKey }) => {
  const body = QuickAddSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;
  const userId = ctx.userId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  const inv = (supabase as any).schema('inventory');

  // ── UOM: catalog_items.uom_term_id is NOT NULL — always resolve a term id ──
  // Prefer the AI suggestion's already-resolved term; else resolve the label;
  // else fall back to the tenant's "EA" term. Never pass null to the RPC.
  let uomTermId: string | null = body.uom_term_id ?? null;
  if (!uomTermId) {
    const label = body.unit_of_measure?.trim();
    if (label) {
      try {
        uomTermId = await getGVClient().resolveTermId(tenantId, 'uom', label, true);
      } catch {
        /* non-fatal — fall through to the EA default */
      }
    }
  }
  if (!uomTermId) {
    uomTermId = await resolveEachUomTermId(tenantId);
  }
  if (!uomTermId) {
    throw AppError.internal('Could not resolve a unit of measure for the new item.');
  }

  // ── Category: existing id wins; else create-payload from the AI's new name ──
  const createCategory =
    !body.category_id && body.new_category_name
      ? {
          name: body.new_category_name,
          sku_prefix: body.sku_prefix || null,
          sku_mode: 'sequential',
        }
      : null;

  const { data, error } = await inv.rpc('rpc_wizard_create_item', {
    p_name: body.name,
    p_description: body.description ?? null,
    p_uom_term_id: uomTermId,
    p_tracking_mode: toCatalogTrackingMode(body.tracking_mode),
    p_reorder_point: body.reorder_point ?? null,
    p_base_sku: null,
    p_sku: null,
    p_category_id: body.category_id ?? null,
    p_create_category: createCategory,
    p_vendor_id: body.vendor_id,
    p_create_vendor: null,
    p_vendor_sku: null,
    p_vendor_unit_cost: body.vendor_unit_cost ?? null,
    p_location_id: null,
    p_create_location: null,
    p_initial_qty: null,
    p_initial_cost: null,
    p_barcode: null,
    p_create_assets: null,
    p_has_variants: false,
    p_variant_dimensions: null,
    p_variant_options: null,
    p_idempotency_key: idempotencyKey,
    // Service client has no JWT claims — pass the acting identity explicitly
    // (service_role-only params honored by the wizard's auth block).
    p_tenant_id: tenantId,
    p_acting_user_id: userId,
  });

  if (error) {
    log.error('item_quick_add.rpc_failed', { vendor_id: body.vendor_id, error: error.message });
    throw AppError.internal(`Could not add the item: ${error.message}`);
  }

  const result = (data as any) || {};
  if (result.success === false) {
    throw AppError.badRequest(result.error || result.message || 'Could not add the item.');
  }

  const catalogItemId: string | null = result.item_id ?? result.catalog_item_id ?? null;
  if (!catalogItemId) {
    throw AppError.internal('The item was not created (no id returned).');
  }
  const vendorItemEntity = Array.isArray(result.created_entities)
    ? result.created_entities.find((e: any) => e?.type === 'vendor_item')
    : null;
  const vendorItemId: string | null = vendorItemEntity?.id ?? null;

  return {
    data: {
      catalog_item_id: catalogItemId,
      item_sku: result.item_sku ?? null,
      vendor_item_id: vendorItemId,
      idempotent_hit: result.idempotent_hit === true,
    },
    status: 201,
    events: [
      {
        event_name: 'catalog_item.quick_added',
        payload: {
          catalog_item_id: catalogItemId,
          item_sku: result.item_sku ?? null,
          vendor_id: body.vendor_id,
          vendor_item_id: vendorItemId,
          category_id: result.category_id ?? body.category_id ?? null,
        },
        last_event_id: idempotencyKey,
      },
    ],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/items/quick-add' });
