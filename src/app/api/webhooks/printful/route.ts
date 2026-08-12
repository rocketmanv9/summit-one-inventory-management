import { createWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'my-service';

/**
 * Printful webhook receiver for order status updates.
 *
 * Printful sends webhooks for: order_updated, package_shipped,
 * order_failed, order_canceled, etc.
 *
 * Uses createWriteRoute (not session) because Printful sends unauthenticated
 * webhooks. The route lives under /api/webhooks/ and uses the admin client
 * since there is no session context.
 */
export const POST = createWriteRoute(
  async ({ req, log, idempotencyKey }) => {
    const body = await req.json();
    const eventType = body.type as string;
    const orderData = body.data?.order;

    if (!orderData?.external_id) {
      throw AppError.badRequest('Missing order external_id in webhook payload');
    }

    const externalId = orderData.external_id as string;

    log.info('printful-webhook.received', { eventType, externalId });

    const admin = getAdminClient();
    const inv = (admin as any).schema('inventory');

    // Look up the apparel order by its ID (external_id = apparel_orders.id)
    const { data: apparelOrder, error: lookupErr } = await inv
      .from('apparel_orders')
      .select('id, tenant_id, status, notes')
      .eq('id', externalId)
      .limit(1)
      .single();

    if (lookupErr || !apparelOrder) {
      log.warn('printful-webhook.order_not_found', { externalId });
      // Return 200 to avoid Printful retries for unknown orders
      return {
        data: { acknowledged: true, matched: false },
        status: 200,
        events: [],
      };
    }

    // Map Printful webhook types to our status
    const updates: Record<string, any> = {
      printful_status: orderData.status,
      updated_at: new Date().toISOString(),
    };

    switch (eventType) {
      case 'package_shipped':
        updates.status = 'shipped';
        break;
      case 'order_failed':
        updates.status = 'failed';
        break;
      case 'order_canceled':
        updates.status = 'canceled';
        break;
      case 'order_updated':
        if (orderData.status === 'fulfilled') {
          updates.status = 'fulfilled';
        } else if (orderData.status === 'inprocess') {
          updates.status = 'in_production';
        }
        break;
      default:
        // Just update printful_status for unrecognized events
        break;
    }

    // Store shipment tracking if available
    if (orderData.shipments?.length > 0) {
      const shipment = orderData.shipments[0];
      updates.notes = [
        apparelOrder.notes || '',
        `Tracking: ${shipment.carrier} ${shipment.tracking_number} — ${shipment.tracking_url}`,
      ].filter(Boolean).join('\n');
    }

    const { error: updateErr } = await inv
      .from('apparel_orders')
      .update(updates)
      .eq('id', apparelOrder.id);

    if (updateErr) {
      log.error('printful-webhook.update_failed', { error: updateErr.message });
      throw AppError.internal(updateErr.message);
    }

    log.info('printful-webhook.processed', {
      apparelOrderId: apparelOrder.id,
      newStatus: updates.status || 'unchanged',
      printfulStatus: orderData.status,
    });

    return {
      data: { acknowledged: true, matched: true, orderId: apparelOrder.id },
      status: 200,
      events: [{
        event_name: 'apparel.status_updated',
        payload: {
          apparel_order_id: apparelOrder.id,
          tenant_id: apparelOrder.tenant_id,
          printful_status: orderData.status,
          new_status: updates.status || apparelOrder.status,
        },
        last_event_id: idempotencyKey,
      }],
    };
  },
  { bodySchema: 'raw',
    serviceName: SERVICE_NAME,
    scope: 'POST /api/webhooks/printful',
    authenticate: async () => {
      // Printful webhooks are unauthenticated — use admin client
      const supabase = getAdminClient();
      return { tenantId: 'system', userId: 'printful-webhook', supabase };
    },
  }
);
