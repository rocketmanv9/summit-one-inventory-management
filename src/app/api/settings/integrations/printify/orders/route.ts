/**
 * Printify Order Placement API
 * POST — place an order to Printify for mapped catalog items
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import {
  resolvePrintifyConfig,
  createPrintifyOrder,
  type PrintifyLineItem,
  type PrintifyAddress,
} from '@/lib/integrations/printify';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Schema ──────────────────────────────────────────────────────────────

const OrderItemSchema = z.object({
  catalog_item_id: z.string().uuid(),
  qty: z.number().int().min(1),
});

const AddressSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  country: z.string().min(2).default('US'),
  region: z.string().min(1),
  address1: z.string().min(1),
  address2: z.string().optional(),
  city: z.string().min(1),
  zip: z.string().min(1),
});

const PlaceOrderSchema = z.object({
  items: z.array(OrderItemSchema).min(1),
  shipping_address: AddressSchema,
  shipping_method: z.number().int().default(1),
  label: z.string().optional(),
});

// ── POST: Place Printify order ──────────────────────────────────────────

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const body = PlaceOrderSchema.parse(await req.json());
  const adminClient = getAdminClient();

  // 1. Resolve Printify config (token from Vault)
  const config = await resolvePrintifyConfig(adminClient, ctx.tenantId!);
  const prov = (adminClient as any).schema('provisioning');

  // 2. Resolve catalog items → Printify product/variant via mappings
  const catalogItemIds = body.items.map((i) => i.catalog_item_id);

  const { data: mappings, error: mappingError } = await prov
    .from('provider_item_mappings')
    .select('catalog_item_id, external_product_id, external_variant_id')
    .eq('tenant_id', ctx.tenantId!)
    .eq('provider_id', config.providerId)
    .in('catalog_item_id', catalogItemIds)
    .limit(100);

  if (mappingError) throw AppError.internal(mappingError.message);

  const mappingMap = new Map<string, { catalog_item_id: string; external_product_id: string; external_variant_id: string }>(
    (mappings || []).map((m: any) => [m.catalog_item_id, m])
  );

  // Check all items have mappings
  const unmapped = body.items.filter((i) => !mappingMap.has(i.catalog_item_id));
  if (unmapped.length > 0) {
    throw AppError.badRequest(
      `No Printify mapping for catalog items: ${unmapped.map((i) => i.catalog_item_id).join(', ')}. Add mappings in Settings > Integrations.`
    );
  }

  // 3. Build Printify line items
  const lineItems: PrintifyLineItem[] = body.items.map((item) => {
    const mapping = mappingMap.get(item.catalog_item_id)!;
    return {
      product_id: mapping.external_product_id,
      variant_id: Number(mapping.external_variant_id),
      quantity: item.qty,
    };
  });

  // 4. Place order via Printify API
  const printifyOrder = await createPrintifyOrder(config, {
    external_id: idempotencyKey,
    label: body.label || `Summit Reorder ${new Date().toISOString().slice(0, 10)}`,
    line_items: lineItems,
    shipping_method: body.shipping_method,
    address_to: body.shipping_address as PrintifyAddress,
    send_shipping_notification: true,
  });

  log.info('printify.order.placed', {
    printifyOrderId: printifyOrder.id,
    itemCount: lineItems.length,
  });

  // 5. Store order record in our tracking table
  const inv = (adminClient as any).schema('inventory');
  const { data: orderRecord, error: insertError } = await inv
    .from('printify_orders')
    .upsert({
      tenant_id: ctx.tenantId!,
      printify_order_id: printifyOrder.id,
      provider_id: config.providerId,
      status: 'submitted',
      items: body.items.map((item) => ({
        catalog_item_id: item.catalog_item_id,
        qty: item.qty,
        printify_product_id: mappingMap.get(item.catalog_item_id)!.external_product_id,
        printify_variant_id: mappingMap.get(item.catalog_item_id)!.external_variant_id,
      })),
      shipping_address: body.shipping_address,
      total_cost: printifyOrder.total_price ?? null,
    }, { onConflict: 'printify_order_id' })
    .select()
    .single();

  if (insertError) {
    // Order was placed on Printify but we failed to track it locally — log but don't fail
    log.warn('printify.order.track_failed', { printifyOrderId: printifyOrder.id, error: insertError.message });
  }

  return {
    data: {
      order_id: orderRecord?.id ?? null,
      printify_order_id: printifyOrder.id,
      status: 'submitted',
      items_count: lineItems.length,
    },
    status: 201,
    events: [{
      event_name: 'printify_order.created',
      payload: {
        printify_order_id: printifyOrder.id,
        local_order_id: orderRecord?.id,
        items_count: lineItems.length,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/printify/orders' });
