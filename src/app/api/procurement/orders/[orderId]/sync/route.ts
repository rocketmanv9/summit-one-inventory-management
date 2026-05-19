/**
 * Procurement Order Sync
 * POST — sync order status from external provider
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import { getAdapter, resolveProcurementConfig } from '@/lib/integrations/procurement';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const SyncSchema = z.object({});

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  SyncSchema.parse(await req.json());

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
  if (!order.external_order_id) throw AppError.badRequest('Order has not been submitted to an external provider');

  // Resolve config and get status from provider
  const config = await resolveProcurementConfig(adminClient, ctx.tenantId!, order.provider_id);
  const adapter = getAdapter(config.providerKey);
  if (!adapter) throw AppError.internal(`No adapter found for provider "${config.providerKey}"`);

  const externalStatus = await adapter.getOrderStatus(config, order.external_order_id);

  // Map external status to internal status
  const statusMap: Record<string, string> = {
    'pending': 'submitted',
    'confirmed': 'confirmed',
    'processing': 'processing',
    'shipped': 'shipped',
    'partially_shipped': 'partially_shipped',
    'delivered': 'received',
    'cancelled': 'cancelled',
    'failed': 'failed',
  };

  const newStatus = statusMap[externalStatus.status] || order.status;
  const oldStatus = order.status;

  // Update order if status changed
  if (newStatus !== oldStatus) {
    await proc
      .from('orders')
      .update({
        status: newStatus,
        metadata: { ...order.metadata, last_sync: new Date().toISOString(), external_status: externalStatus },
        last_event_id: idempotencyKey,
      })
      .eq('id', orderId);

    // Update tracking info on items if available
    if (externalStatus.items) {
      for (const extItem of externalStatus.items) {
        if (extItem.trackingNumber) {
          await proc
            .from('order_items')
            .update({
              tracking_number: extItem.trackingNumber,
              tracking_url: extItem.trackingUrl,
            })
            .eq('order_id', orderId)
            .eq('external_product_id', extItem.externalProductId)
            .eq('tenant_id', ctx.tenantId!);
        }
      }
    }

    // Audit log
    await proc.from('audit_log').insert({
      tenant_id: ctx.tenantId!,
      entity_type: 'order',
      entity_id: orderId,
      action: 'status_synced',
      old_value: { status: oldStatus },
      new_value: { status: newStatus, external_status: externalStatus.status },
      actor_user_id: ctx.userId!,
    });
  }

  return {
    data: { order_id: orderId, previous_status: oldStatus, current_status: newStatus, external_status: externalStatus },
    status: 200,
    events: newStatus !== oldStatus
      ? [{ event_name: 'procurement.order.synced', payload: { order_id: orderId, old_status: oldStatus, new_status: newStatus }, last_event_id: idempotencyKey }]
      : [],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/procurement/orders/[orderId]/sync' });
