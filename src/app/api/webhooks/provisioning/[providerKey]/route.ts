import { createWebhookRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * Propagate line-level status changes up to the request level.
 * Uses simple aggregation: if all external lines share a status, promote it.
 */
async function updateRequestStatusFromLines(
  prov: any,
  tenantId: string,
  requestId: string,
  log: any,
): Promise<void> {
  const { data: allLines } = await prov
    .from('provisioning_lines')
    .select('status, fulfillment_method')
    .eq('request_id', requestId)
    .eq('tenant_id', tenantId)
    .limit(200);

  if (!allLines || allLines.length === 0) return;

  const externalLines = allLines.filter((l: any) => l.fulfillment_method === 'external_order');
  if (externalLines.length === 0) return;

  const statuses = externalLines.map((l: any) => l.status);

  // Determine aggregate request status
  let newRequestStatus: string | null = null;

  if (statuses.every((s: string) => s === 'delivered')) {
    newRequestStatus = 'delivered';
  } else if (statuses.some((s: string) => s === 'shipped')) {
    newRequestStatus = 'shipped';
  } else if (statuses.every((s: string) => s === 'in_production' || s === 'shipped' || s === 'delivered')) {
    newRequestStatus = 'in_production';
  } else if (statuses.every((s: string) => ['failed', 'cancelled'].includes(s))) {
    newRequestStatus = 'failed';
  }

  if (!newRequestStatus) return;

  // Only update if status is progressing forward
  const { data: currentReq } = await prov
    .from('provisioning_requests')
    .select('status')
    .eq('id', requestId)
    .limit(1)
    .single();

  if (!currentReq) return;

  const statusOrder = ['submitted', 'in_production', 'shipped', 'delivered', 'failed'];
  const currentIdx = statusOrder.indexOf(currentReq.status);
  const newIdx = statusOrder.indexOf(newRequestStatus);

  if (newIdx > currentIdx || currentReq.status === 'provisioning' || currentReq.status === 'submitted') {
    await prov
      .from('provisioning_requests')
      .update({
        status: newRequestStatus,
        last_event_id: `webhook-req-${requestId}-${newRequestStatus}-${Date.now()}`,
      })
      .eq('id', requestId);

    log.info('provider-webhook.request_status_updated', { requestId, newRequestStatus });
  }
}

/**
 * Generic webhook endpoint for fulfillment provider status updates.
 * Each provider sends updates here; we normalize and apply them.
 */
export const POST = createWebhookRoute(async ({ eventType, payload: rawPayload, supabase, log, tenantId }) => {
  const prov = (supabase as any).schema('provisioning');
  const payload = rawPayload as Record<string, any>;

  // Normalize the provider update
  const externalOrderId = payload.external_order_id || payload.order_id || payload.id;
  const status = payload.status;
  const trackingNumber = payload.tracking_number || payload.shipments?.[0]?.number;
  const trackingUrl = payload.tracking_url || payload.shipments?.[0]?.url;

  if (!externalOrderId) {
    log.warn('provider-webhook.missing_order_id', { eventType, payload });
    return;
  }

  // Find provisioning lines with this external order ID
  const { data: lines } = await prov
    .from('provisioning_lines')
    .select('id, request_id, status')
    .eq('tenant_id', tenantId)
    .eq('external_order_id', externalOrderId)
    .limit(100);

  if (!lines || lines.length === 0) {
    log.warn('provider-webhook.no_matching_lines', { externalOrderId });
    return;
  }

  // Map provider status to our internal status
  const statusMap: Record<string, string> = {
    pending: 'ordered',
    'in-production': 'in_production',
    in_production: 'in_production',
    shipping: 'shipped',
    shipped: 'shipped',
    delivered: 'delivered',
    canceled: 'cancelled',
    cancelled: 'cancelled',
    failed: 'failed',
  };

  const newStatus = statusMap[status?.toLowerCase()] || status?.toLowerCase();
  if (!newStatus) {
    log.warn('provider-webhook.unknown_status', { status });
    return;
  }

  for (const line of lines) {
    const oldStatus = line.status;
    if (oldStatus === newStatus) continue;

    const updateData: Record<string, unknown> = {
      status: newStatus,
      last_event_id: `webhook-${externalOrderId}-${newStatus}-${Date.now()}`,
    };
    if (trackingNumber) updateData.tracking_number = trackingNumber;
    if (trackingUrl) updateData.tracking_url = trackingUrl;

    await prov
      .from('provisioning_lines')
      .update(updateData)
      .eq('id', line.id);

    await prov
      .from('provisioning_history')
      .insert({
        tenant_id: tenantId,
        request_id: line.request_id,
        line_id: line.id,
        action: `provider_status_${newStatus}`,
        old_status: oldStatus,
        new_status: newStatus,
        actor_system: 'provider_webhook',
        details: { external_order_id: externalOrderId, tracking_number: trackingNumber },
      });

    log.info('provider-webhook.line_updated', {
      lineId: line.id,
      oldStatus,
      newStatus,
      externalOrderId,
    });
  }

  // Propagate request-level status from line statuses
  const affectedRequestIds = [...new Set(lines.map((l: any) => l.request_id))] as string[];
  for (const reqId of affectedRequestIds) {
    await updateRequestStatusFromLines(prov, tenantId, reqId, log);
  }
}, {
  serviceName: SERVICE_NAME,
  consumerKey: `${SERVICE_NAME}.provisioning_provider_webhook_v1`,
  createClient: async (tenantId) => createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  }),
});
