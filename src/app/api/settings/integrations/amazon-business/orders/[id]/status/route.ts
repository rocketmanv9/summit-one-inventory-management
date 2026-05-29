/**
 * Amazon Business Order Status API
 * POST — update order status (manual sync — cXML has no standard status query)
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const SyncSchema = z.object({
  status: z.enum(['pending', 'submitted', 'confirmed', 'shipped', 'delivered', 'cancelled', 'failed']).optional(),
  tracking_carrier: z.string().optional(),
  tracking_number: z.string().optional(),
  estimated_delivery: z.string().optional(),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const body = SyncSchema.parse(await req.json());
  const adminClient = getAdminClient();
  const inv = (adminClient as any).schema('inventory');

  const url = new URL(req.url);
  const orderId = url.pathname.split('/').slice(-2, -1)[0];

  if (!orderId) throw AppError.badRequest('Missing order ID');

  const { data: order, error: orderError } = await inv
    .from('amazon_business_orders')
    .select('id, amazon_order_id, status')
    .eq('id', orderId)
    .eq('tenant_id', ctx.tenantId!)
    .limit(1)
    .single();

  if (orderError || !order) throw AppError.notFound('Amazon Business order not found');

  const updateData: Record<string, unknown> = {};

  if (body.status) {
    updateData.status = body.status;
  }

  if (body.tracking_carrier || body.tracking_number || body.estimated_delivery) {
    updateData.tracking_info = {
      carrier: body.tracking_carrier,
      tracking_number: body.tracking_number,
      estimated_delivery: body.estimated_delivery,
    };
  }

  if (Object.keys(updateData).length === 0) {
    return {
      data: {
        order_id: order.id,
        amazon_order_id: order.amazon_order_id,
        previous_status: order.status,
        current_status: order.status,
        tracking_info: null,
      },
      status: 200,
      events: [],
    };
  }

  const { error: updateError } = await inv
    .from('amazon_business_orders')
    .update(updateData)
    .eq('id', order.id);

  if (updateError) throw AppError.internal(updateError.message);

  log.info('amazon.order.status_updated', {
    orderId: order.id,
    amazonOrderId: order.amazon_order_id,
    previousStatus: order.status,
    newStatus: body.status ?? order.status,
  });

  return {
    data: {
      order_id: order.id,
      amazon_order_id: order.amazon_order_id,
      previous_status: order.status,
      current_status: body.status ?? order.status,
      tracking_info: updateData.tracking_info || null,
    },
    status: 200,
    events: [{
      event_name: 'purchase_order.synced',
      payload: {
        order_id: order.id,
        amazon_order_id: order.amazon_order_id,
        status: body.status ?? order.status,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/amazon-business/orders/status' });
