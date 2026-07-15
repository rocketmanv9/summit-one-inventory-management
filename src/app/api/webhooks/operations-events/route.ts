import { createWebhookRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { mapOpsEquipmentEvent } from '@/lib/integrations/ops-equipment-mirror';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * Webhook receiver for summit-one-operations equipment events (via the hub).
 *
 * Ops job equipment holds mirror into inventory.reservations (serialized,
 * keyed last_event_id = 'ops-hold:<assignment_id>') through
 * rpc_inv_apply_ops_equipment_hold:
 *   equipment.requested (status reserved|confirmed, fleet_asset_id set) →
 *     upsert an active reservation (window = the hold's planned window,
 *     job_ref = {source:'operations', job_id, job_name})
 *   equipment.requested (status requested / by-class) + equipment.released →
 *     release the mirror row (no-op when none exists)
 *
 * The RPC maps fleet_asset_id → inventory.assets via the crosswalk and skips
 * gracefully when the asset isn't mirrored ('skipped_no_crosswalk') or the
 * warehouse already holds it ('conflict') — never a webhook failure/retry.
 *
 * Echo safety: mirror rows publish reservation.* events with
 * job_ref.source='operations'; Operations drops those on its side.
 *
 * ACTIVATION: needs a hub subscription pointing event_types
 * ['equipment.requested','equipment.released'] at this URL, with its `secret`
 * equal to OPERATIONS_WEBHOOK_SECRET on this service.
 */
export const POST = createWebhookRoute(async ({ eventType, payload, supabase, log, tenantId }) => {
  // Tolerate the raw outbox envelope ({op,new,old}) or a flat payload.
  const p = (payload?.new ?? payload ?? {}) as Record<string, unknown>;

  const decision = mapOpsEquipmentEvent(eventType, p);
  if (decision.action === 'skip') {
    log.warn('operations_webhook.skipped', { eventType, reason: decision.reason });
    return;
  }

  const { data, error } = await supabase.schema('inventory').rpc('rpc_inv_apply_ops_equipment_hold', {
    p_tenant_id: tenantId,
    ...decision.args,
  });
  if (error) throw AppError.internal(`rpc_inv_apply_ops_equipment_hold failed: ${error.message}`);

  const outcome = (data as { outcome?: string } | null)?.outcome ?? 'unknown';
  log.info('operations_webhook.applied', {
    eventType,
    assignment_id: decision.args.p_assignment_id,
    op: decision.args.p_op,
    outcome,
  });
}, {
  serviceName: SERVICE_NAME,
  consumerKey: `${SERVICE_NAME}.operations_webhook_v1`,
  // Holds the same value as the subscription's `secret` column in the hub.
  secretEnvVar: 'OPERATIONS_WEBHOOK_SECRET',
  // The hub's events-poller signs as `x-event-signature: <bare-hex>`.
  signatureHeader: 'x-event-signature',
  signatureEncoding: 'hex',
  createClient: async (tid) => createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: tid,
  }),
});
