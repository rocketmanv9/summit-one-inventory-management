import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const BulkPriceSchema = z.object({
  catalog_item_id: z.string().uuid(),
  unit_cost: z.number().nonnegative(),
  // Omit to reprice every row for the material (all vendors, company defaults
  // and branch overrides alike); pass row ids to reprice a subset. Row-level
  // targeting so branch-specific prices can be updated independently.
  vendor_item_ids: z.array(z.string().uuid()).min(1).optional(),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase }) => {
  const body = BulkPriceSchema.parse(await req.json());

  const sc = (supabase as any).schema('supply_chain');

  let query = sc
    .from('vendor_items')
    .update({
      unit_cost: body.unit_cost,
      last_known_price: body.unit_cost,
      price_checked_at: new Date().toISOString(),
    })
    .eq('tenant_id', ctx.tenantId)
    .eq('catalog_item_id', body.catalog_item_id);

  if (body.vendor_item_ids) {
    query = query.in('id', body.vendor_item_ids);
  }

  const { data, error } = await query.select('id, vendor_id, vendor_address_id, unit_cost');

  if (error) {
    log.error('vendor_items.bulk_price_failed', { error: error.message });
    throw AppError.internal(error.message);
  }
  if (!data || data.length === 0) {
    throw AppError.notFound('No vendor items found for that material');
  }

  log.info('vendor_items.bulk_price_updated', {
    catalog_item_id: body.catalog_item_id,
    unit_cost: body.unit_cost,
    updated: data.length,
  });

  return {
    data: { updated: data.length, vendor_items: data },
    status: 200,
    events: [],
  };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/vendor-items/bulk-price' });
