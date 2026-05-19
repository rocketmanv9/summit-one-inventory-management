/**
 * Procurement Order Receive
 * POST — mark items as received
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const ReceiveSchema = z.object({
  items: z.array(z.object({
    order_item_id: z.string().uuid(),
    qty_received: z.number().int().min(0),
  })).min(1),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const body = ReceiveSchema.parse(await req.json());

  const pathParts = new URL(req.url).pathname.split('/');
  const orderId = pathParts[pathParts.length - 2];
  if (!orderId) throw AppError.badRequest('Missing order ID');

  const adminClient = getAdminClient();
  const proc = (adminClient as any).schema('procurement');

  // Verify order exists and is in a receivable state
  const { data: order } = await proc
    .from('orders')
    .select('id, status')
    .eq('id', orderId)
    .eq('tenant_id', ctx.tenantId!)
    .limit(1)
    .maybeSingle();

  if (!order) throw AppError.notFound('Order not found');

  const receivableStatuses = ['submitted', 'confirmed', 'processing', 'partially_shipped', 'shipped', 'partially_received'];
  if (!receivableStatuses.includes(order.status)) {
    throw AppError.badRequest(`Cannot receive items for an order with status "${order.status}"`);
  }

  // Update each item's qty_received
  for (const item of body.items) {
    const { error } = await proc
      .from('order_items')
      .update({
        qty_received: item.qty_received,
        last_event_id: `${idempotencyKey}-${item.order_item_id}`,
      })
      .eq('id', item.order_item_id)
      .eq('order_id', orderId)
      .eq('tenant_id', ctx.tenantId!);

    if (error) throw AppError.internal(error.message);
  }

  // Check if all items fully received
  const { data: allItems } = await proc
    .from('order_items')
    .select('quantity, qty_received')
    .eq('order_id', orderId)
    .eq('tenant_id', ctx.tenantId!)
    .limit(100);

  const allReceived = (allItems || []).every((i: any) => i.qty_received >= i.quantity);
  const anyReceived = (allItems || []).some((i: any) => i.qty_received > 0);

  const newStatus = allReceived ? 'received' : anyReceived ? 'partially_received' : order.status;

  if (newStatus !== order.status) {
    await proc
      .from('orders')
      .update({ status: newStatus, last_event_id: idempotencyKey })
      .eq('id', orderId);
  }

  // Audit log
  await proc.from('audit_log').insert({
    tenant_id: ctx.tenantId!,
    entity_type: 'order',
    entity_id: orderId,
    action: 'items_received',
    old_value: { status: order.status },
    new_value: { status: newStatus, received_items: body.items },
    actor_user_id: ctx.userId!,
  });

  return {
    data: { order_id: orderId, status: newStatus, all_received: allReceived },
    status: 200,
    events: [{ event_name: 'procurement.order.received', payload: { order_id: orderId, status: newStatus, all_received: allReceived }, last_event_id: idempotencyKey }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/procurement/orders/[orderId]/receive' });
