/**
 * Amazon Business Order Status Sync API
 * POST — sync order status from Amazon, update tracking record
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import { resolveAmazonBusinessConfig, getOrderStatus } from '@/lib/integrations/amazon-business';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const SyncSchema = z.object({});

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  SyncSchema.parse(await req.json());
  const adminClient = getAdminClient();
  const inv = (adminClient as any).schema('inventory');

  // Extract order ID from URL
  const url = new URL(req.url);
  const orderId = url.pathname.split('/').slice(-2, -1)[0];

  if (!orderId) throw AppError.badRequest('Missing order ID');

  // Load local order record
  const { data: order, error: orderError } = await inv
    .from('amazon_business_orders')
    .select('id, amazon_order_id, status')
    .eq('id', orderId)
    .eq('tenant_id', ctx.tenantId!)
    .limit(1)
    .single();

  if (orderError || !order) throw AppError.notFound('Amazon Business order not found');

  // Resolve Amazon config and fetch current status
  const config = await resolveAmazonBusinessConfig(adminClient, ctx.tenantId!);
  const statusResult = await getOrderStatus(config, order.amazon_order_id);

  log.info('amazon.order.status_synced', {
    orderId: order.id,
    amazonOrderId: order.amazon_order_id,
    previousStatus: order.status,
    newStatus: statusResult.status,
  });

  // Update local record
  const updateData: Record<string, unknown> = {
    status: statusResult.status,
  };

  if (statusResult.trackingInfo) {
    updateData.tracking_info = statusResult.trackingInfo;
  }

  const { error: updateError } = await inv
    .from('amazon_business_orders')
    .update(updateData)
    .eq('id', order.id);

  if (updateError) throw AppError.internal(updateError.message);

  return {
    data: {
      order_id: order.id,
      amazon_order_id: order.amazon_order_id,
      previous_status: order.status,
      current_status: statusResult.status,
      tracking_info: statusResult.trackingInfo || null,
    },
    status: 200,
    events: [{
      event_name: 'purchase_order.synced',
      payload: {
        order_id: order.id,
        amazon_order_id: order.amazon_order_id,
        status: statusResult.status,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/amazon-business/orders/status' });
