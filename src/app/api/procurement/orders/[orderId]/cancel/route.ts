/**
 * Procurement Order Cancel
 * POST — cancel an order
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import { getAdapter, resolveProcurementConfig } from '@/lib/integrations/procurement';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CancelSchema = z.object({
  reason: z.string().optional(),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const body = CancelSchema.parse(await req.json());

  const pathParts = new URL(req.url).pathname.split('/');
  const orderId = pathParts[pathParts.length - 2];
  if (!orderId) throw AppError.badRequest('Missing order ID');

  const adminClient = getAdminClient();
  const proc = (adminClient as any).schema('procurement');

  const { data: order } = await proc
    .from('orders')
    .select('id, status, provider_id, external_order_id')
    .eq('id', orderId)
    .eq('tenant_id', ctx.tenantId!)
    .limit(1)
    .maybeSingle();

  if (!order) throw AppError.notFound('Order not found');

  const nonCancellable = ['received', 'cancelled'];
  if (nonCancellable.includes(order.status)) {
    throw AppError.badRequest(`Cannot cancel an order with status "${order.status}"`);
  }

  // If submitted to external provider, cancel there too
  if (order.external_order_id) {
    const config = await resolveProcurementConfig(adminClient, ctx.tenantId!, order.provider_id);
    const adapter = getAdapter(config.providerKey);
    if (adapter) {
      const result = await adapter.cancelOrder(config, order.external_order_id);
      if (!result.success) {
        throw AppError.internal(`External cancellation failed: ${result.message}`);
      }
    }
  }

  const oldStatus = order.status;

  const { error } = await proc
    .from('orders')
    .update({ status: 'cancelled', last_event_id: idempotencyKey })
    .eq('id', orderId);

  if (error) throw AppError.internal(error.message);

  // Audit log
  await proc.from('audit_log').insert({
    tenant_id: ctx.tenantId!,
    entity_type: 'order',
    entity_id: orderId,
    action: 'cancelled',
    old_value: { status: oldStatus },
    new_value: { status: 'cancelled', reason: body.reason },
    actor_user_id: ctx.userId!,
  });

  return {
    data: { order_id: orderId, status: 'cancelled' },
    status: 200,
    events: [{ event_name: 'procurement.order.cancelled', payload: { order_id: orderId, reason: body.reason }, last_event_id: idempotencyKey }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/procurement/orders/[orderId]/cancel' });
