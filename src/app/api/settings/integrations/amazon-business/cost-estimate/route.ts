/**
 * Amazon Business Cost Estimate API
 * POST — estimate cost for items + location
 *
 * Stubbed: the SP-API cart-based cost estimation has been removed. Cost
 * estimation for cXML orders will be based on mapped unit prices and
 * pack quantities. Real-time pricing requires the cXML integration guide.
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import { resolveCxmlCredentials, roundToPackQuantity } from '@/lib/integrations/amazon-business';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const EstimateItemSchema = z.object({
  catalog_item_id: z.string().uuid(),
  qty: z.number().int().min(1),
});

const EstimateSchema = z.object({
  items: z.array(EstimateItemSchema).min(1),
  location_id: z.string().uuid(),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, idempotencyKey }) => {
  const body = EstimateSchema.parse(await req.json());
  const adminClient = getAdminClient();

  const cxmlConfig = await resolveCxmlCredentials(adminClient, ctx.tenantId!);
  const prov = (adminClient as any).schema('provisioning');
  const inv = (adminClient as any).schema('inventory');

  const catalogItemIds = body.items.map((i) => i.catalog_item_id);

  const { data: mappings, error: mappingError } = await prov
    .from('provider_item_mappings')
    .select('catalog_item_id, external_product_id, unit_cost, metadata')
    .eq('tenant_id', ctx.tenantId!)
    .eq('provider_id', cxmlConfig.providerId)
    .in('catalog_item_id', catalogItemIds)
    .limit(100);

  if (mappingError) throw AppError.internal(mappingError.message);

  const mappingMap = new Map<string, { supplierSku: string; unitCost: number | null; packQuantity: number }>(
    (mappings || []).map((m: any) => [m.catalog_item_id, {
      supplierSku: m.external_product_id,
      unitCost: m.unit_cost,
      packQuantity: m.metadata?.pack_size ?? 1,
    }])
  );

  const unmapped = body.items.filter((i) => !mappingMap.has(i.catalog_item_id));
  if (unmapped.length > 0) {
    throw AppError.badRequest(
      `No supplier SKU mapping for items: ${unmapped.map((i) => i.catalog_item_id).join(', ')}`
    );
  }

  const { data: location, error: locError } = await inv
    .from('locations')
    .select('id, name')
    .eq('id', body.location_id)
    .eq('tenant_id', ctx.tenantId!)
    .limit(1)
    .single();

  if (locError || !location) throw AppError.notFound('Delivery location not found');

  const lineEstimates = body.items.map((item) => {
    const mapping = mappingMap.get(item.catalog_item_id)!;
    const roundedQty = roundToPackQuantity(item.qty, mapping.packQuantity);
    const lineTotal = mapping.unitCost ? mapping.unitCost * roundedQty : null;
    return {
      catalog_item_id: item.catalog_item_id,
      supplier_sku: mapping.supplierSku,
      requested_qty: item.qty,
      order_qty: roundedQty,
      pack_quantity: mapping.packQuantity,
      unit_price: mapping.unitCost,
      line_total: lineTotal,
    };
  });

  const subtotal = lineEstimates.reduce((sum, l) => sum + (l.line_total ?? 0), 0);

  return {
    data: {
      estimate: {
        subtotal,
        shipping: null,
        tax: null,
        total: null,
        currency: 'USD',
        note: 'Estimate based on mapped unit prices. Shipping and tax are not available until cXML order submission is implemented.',
        items: lineEstimates,
      },
      location: { id: location.id, name: location.name },
      items_count: lineEstimates.length,
    },
    status: 200,
    events: [],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/amazon-business/cost-estimate' });
