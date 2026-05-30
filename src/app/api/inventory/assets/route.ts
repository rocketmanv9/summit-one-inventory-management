import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Create an asset, or restore a retired one with the same tag (the prior
// InventoryRPC.createAsset behavior, now server-side). `trigger_asset_events`
// owns outbox emission, so the route returns events: []. tenant_id must be set
// explicitly — auto_inject_tenant_id() refuses to inject under the service-role
// client and raises instead.
export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = await req.json();
  const { id: _id, created_at, tenant_id, last_event_id: _lei, ...fields } = body ?? {};
  if (!fields.asset_tag) throw AppError.badRequest('Missing asset_tag');

  const inv = (supabase as any).schema('inventory');

  const { data: existing, error: existingError } = await inv
    .from('assets')
    .select('id, last_event_id, status')
    .eq('asset_tag', fields.asset_tag)
    .maybeSingle();

  if (existingError) {
    log.error('asset.exists_check_failed', { error: existingError.message });
    throw AppError.internal(existingError.message);
  }

  if (existing && existing.status !== 'retired') {
    throw AppError.conflict('An asset with this tag already exists. Edit the existing asset or choose a different tag.');
  }

  // Retired asset with the same tag → restore it (OCC against its current version).
  if (existing && existing.status === 'retired') {
    let q = inv.from('assets')
      .update({ ...fields, status: fields.status ?? 'available', last_event_id: idempotencyKey })
      .eq('id', existing.id);
    if (existing.last_event_id) q = q.eq('last_event_id', existing.last_event_id);

    const { data: restored, error: restoreError } = await q.select('id, last_event_id').single();
    if (restoreError) {
      log.error('asset.restore_failed', { error: restoreError.message });
      throw AppError.internal(restoreError.message);
    }
    return { data: restored, status: 200, events: [] };
  }

  const { data, error } = await inv.from('assets')
    .insert({ ...fields, tenant_id: ctx.tenantId, last_event_id: idempotencyKey })
    .select('id, last_event_id')
    .single();

  if (error) {
    log.error('asset.create_failed', { error: error.message });
    throw AppError.internal(error.message);
  }
  return { data, status: 201, events: [] };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/assets' });
