/**
 * Amazon Business Cost Estimate API
 * POST — estimate cost for items + location without placing an order
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import {
  resolveAmazonBusinessConfig,
  createCart,
  addCartItems,
  getCostEstimate,
  type AmazonShippingAddress,
} from '@/lib/integrations/amazon-business';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const EstimateItemSchema = z.object({
  catalog_item_id: z.string().uuid(),
  qty: z.number().int().min(1),
});

const EstimateSchema = z.object({
  items: z.array(EstimateItemSchema).min(1),
  location_id: z.string().uuid(),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const body = EstimateSchema.parse(await req.json());
  const adminClient = getAdminClient();

  // Resolve Amazon config
  const config = await resolveAmazonBusinessConfig(adminClient, ctx.tenantId!);
  const prov = (adminClient as any).schema('provisioning');
  const inv = (adminClient as any).schema('inventory');

  // Resolve ASIN mappings
  const catalogItemIds = body.items.map((i) => i.catalog_item_id);

  const { data: mappings, error: mappingError } = await prov
    .from('provider_item_mappings')
    .select('catalog_item_id, external_product_id')
    .eq('tenant_id', ctx.tenantId!)
    .eq('provider_id', config.providerId)
    .in('catalog_item_id', catalogItemIds)
    .limit(100);

  if (mappingError) throw AppError.internal(mappingError.message);

  const mappingMap = new Map<string, string>(
    (mappings || []).map((m: any) => [m.catalog_item_id, m.external_product_id])
  );

  const unmapped = body.items.filter((i) => !mappingMap.has(i.catalog_item_id));
  if (unmapped.length > 0) {
    throw AppError.badRequest(
      `No Amazon ASIN mapping for items: ${unmapped.map((i) => i.catalog_item_id).join(', ')}`
    );
  }

  // Load location
  const { data: location, error: locError } = await inv
    .from('locations')
    .select('id, name, address_line_1, address_line_2, city, state, postal_code, country')
    .eq('id', body.location_id)
    .eq('tenant_id', ctx.tenantId!)
    .limit(1)
    .single();

  if (locError || !location) throw AppError.notFound('Delivery location not found');

  if (!location.address_line_1 || !location.city || !location.state || !location.postal_code) {
    throw AppError.badRequest(
      `Location "${location.name}" is missing structured address fields. Update in Inventory > Locations.`
    );
  }

  const shippingAddress: AmazonShippingAddress = {
    name: location.name,
    address_line_1: location.address_line_1,
    address_line_2: location.address_line_2 || undefined,
    city: location.city,
    state: location.state,
    postal_code: location.postal_code,
    country: location.country || 'US',
  };

  // Create temp cart + add items + get estimate
  const cartItems = body.items.map((item) => ({
    asin: mappingMap.get(item.catalog_item_id)!,
    quantity: item.qty,
  }));

  const cartId = await createCart(config);
  await addCartItems(config, cartId, cartItems);
  const estimate = await getCostEstimate(config, cartId, shippingAddress);

  log.info('amazon.cost_estimate.fetched', {
    cartId,
    itemCount: cartItems.length,
    total: estimate.total,
  });

  return {
    data: {
      estimate,
      location: { id: location.id, name: location.name },
      items_count: cartItems.length,
    },
    status: 200,
    events: [],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/amazon-business/cost-estimate' });
