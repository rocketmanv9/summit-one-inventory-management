/**
 * Procurement Order Submit
 * POST — submit a draft order to the external provider
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import { getAdapter, resolveProcurementConfig } from '@/lib/integrations/procurement';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const SubmitSchema = z.object({});

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  SubmitSchema.parse(await req.json());

  const pathParts = new URL(req.url).pathname.split('/');
  // Path: /api/procurement/orders/[orderId]/submit
  const orderId = pathParts[pathParts.length - 2];
  if (!orderId) throw AppError.badRequest('Missing order ID');

  const adminClient = getAdminClient();
  const proc = (adminClient as any).schema('procurement');

  // Get order
  const { data: order } = await proc
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('tenant_id', ctx.tenantId!)
    .limit(1)
    .maybeSingle();

  if (!order) throw AppError.notFound('Order not found');
  if (order.status !== 'draft') throw AppError.badRequest(`Order is already ${order.status} — only draft orders can be submitted`);

  // Get order items
  const { data: items } = await proc
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .eq('tenant_id', ctx.tenantId!)
    .limit(100);

  if (!items || items.length === 0) throw AppError.badRequest('Order has no items');

  // Resolve provider config + adapter
  const config = await resolveProcurementConfig(adminClient, ctx.tenantId!, order.provider_id);
  const adapter = getAdapter(config.providerKey);
  if (!adapter) throw AppError.internal(`No adapter found for provider "${config.providerKey}"`);

  // Submit to external provider
  const result = await adapter.submitOrder(config, {
    internalOrderId: order.id,
    lineItems: items.map((item: any) => ({
      externalProductId: item.external_product_id,
      quantity: item.quantity,
      unitPrice: item.unit_price,
    })),
    shippingAddress: order.shipping_address || {
      name: 'Unknown',
      address1: 'Unknown',
      city: 'Unknown',
      state: 'Unknown',
      postalCode: '00000',
      country: 'US',
    },
  });

  // Update order with external ID and status
  const { error: updateError } = await proc
    .from('orders')
    .update({
      external_order_id: result.externalOrderId,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      submitted_by: ctx.userId!,
      metadata: { ...order.metadata, external_confirmation: result.confirmationNumber, estimated_delivery: result.estimatedDelivery },
      last_event_id: idempotencyKey,
    })
    .eq('id', orderId);

  if (updateError) throw AppError.internal(updateError.message);

  // Write audit log
  await proc.from('audit_log').insert({
    tenant_id: ctx.tenantId!,
    entity_type: 'order',
    entity_id: orderId,
    action: 'submitted',
    old_value: { status: 'draft' },
    new_value: { status: 'submitted', external_order_id: result.externalOrderId },
    actor_user_id: ctx.userId!,
  });

  return {
    data: { order_id: orderId, external_order_id: result.externalOrderId, status: 'submitted', estimated_delivery: result.estimatedDelivery },
    status: 200,
    events: [{ event_name: 'procurement.order.submitted', payload: { order_id: orderId, external_order_id: result.externalOrderId }, last_event_id: idempotencyKey }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/procurement/orders/[orderId]/submit' });
