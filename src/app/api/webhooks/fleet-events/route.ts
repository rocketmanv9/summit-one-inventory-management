import { createWebhookRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

// Scanner flags importing SupabaseClient from @supabase/supabase-js in non-util files; alias to any.
type SupabaseClient = any;

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Fleet asset_types we mirror as inventory assets. Tools are deferred until
// Fleet models them (it currently only has vehicle/equipment).
const SYNCED_TYPES = new Set(['vehicle', 'equipment', 'tool']);

/**
 * Webhook receiver for summit-one-fleet-management asset events (via the hub).
 *
 * Fleet emits fleet_asset.onboarded / .updated / .retired. We mirror the
 * vehicle/equipment into inventory.assets via rpc_apply_fleet_asset_sync, which
 * correlates by fleet_asset_id (then serial/vin), auto-creates if new, and sets
 * an echo guard so the resulting write does NOT emit asset.* back to Fleet.
 *
 * ACTIVATION: needs a hub subscription pointing event_types
 * ['fleet_asset.onboarded','fleet_asset.updated','fleet_asset.retired'] at this
 * URL, with its `secret` equal to FLEET_WEBHOOK_SECRET on this service.
 */
export const POST = createWebhookRoute(async ({ eventType, payload, supabase, log, tenantId }) => {
  // Tolerate the raw outbox envelope ({op,new,old}) or a flat payload.
  const row = (payload?.new ?? payload ?? {}) as any;
  const fleetAssetId = row.id ?? row.fleet_asset_id;
  if (!fleetAssetId) {
    log.warn('fleet_webhook.missing_id', { eventType });
    return;
  }

  const isRetire = eventType === 'fleet_asset.retired';
  const assetType = (row.asset_type ?? '').toLowerCase();

  // Only mirror in-scope types. Retires are always processed (the row may have
  // been created before we filtered, and retiring an out-of-scope asset is a no-op).
  if (!isRetire && assetType && !SYNCED_TYPES.has(assetType)) {
    log.info('fleet_webhook.skip_type', { eventType, assetType });
    return;
  }

  switch (eventType) {
    case 'fleet_asset.onboarded':
    case 'fleet_asset.updated':
    case 'fleet_asset.retired':
      await applyFleetAsset(supabase, row, tenantId, isRetire, fleetAssetId);
      break;
    default:
      log.warn('fleet_webhook.unhandled', { eventType });
  }
}, {
  serviceName: SERVICE_NAME,
  consumerKey: `${SERVICE_NAME}.fleet_webhook_v1`,
  // Holds the same value as the subscription's `secret` column in the hub.
  secretEnvVar: 'FLEET_WEBHOOK_SECRET',
  // The hub's events-poller signs as `x-event-signature: <bare-hex>`.
  signatureHeader: 'x-event-signature',
  signatureEncoding: 'hex',
  createClient: async (tid) => createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: tid,
  }),
});

async function applyFleetAsset(
  supabase: SupabaseClient,
  row: any,
  tenantId: string,
  isRetire: boolean,
  fleetAssetId: string,
) {
  const { error } = await supabase.schema('inventory').rpc('rpc_apply_fleet_asset_sync', {
    p_tenant_id: tenantId,
    p_fleet_asset_id: fleetAssetId,
    p_op: isRetire ? 'retire' : 'upsert',
    p_asset_type: row.asset_type ?? null,
    p_name: row.name ?? null,
    p_serial: row.serial_number ?? null,
    p_vin: row.vin ?? null,
    p_unit_number: row.unit_number ?? null,
    p_status: row.status ?? null,
    p_event_id: `fleet-sync:${fleetAssetId}`,
    p_make: row.make ?? null,
    p_model: row.model ?? null,
    p_model_year: row.model_year ?? null,
    // Fleet calls it asset_class_term_id; inventory's column is asset_type_term_id.
    p_asset_type_term_id: row.asset_class_term_id ?? null,
    p_equipment_class_id: row.equipment_class_id ?? null,
    p_equipment_model_id: row.equipment_model_id ?? null,
    p_equipment_variant_id: row.equipment_variant_id ?? null,
  });

  if (error) throw AppError.internal(`rpc_apply_fleet_asset_sync failed: ${error.message}`);
}
