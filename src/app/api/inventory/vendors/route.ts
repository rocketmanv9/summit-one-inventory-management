import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Create a supply_chain vendor, or restore an inactive one with the same name
// (the prior SupplyChainRPC.createVendor behavior, now server-side).
// trigger_vendor_events owns outbox emission; tenant_id must be set explicitly —
// auto_inject_tenant_id() refuses to inject under the service-role client.
export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = await req.json();
  const { id: _id, created_at, tenant_id, last_event_id: _lei, ...fields } = body ?? {};
  if (!fields.name) throw AppError.badRequest('Missing vendor name');

  const sc = (supabase as any).schema('supply_chain');

  const { data: existing, error: existingError } = await sc
    .from('vendors')
    .select('id, last_event_id, active')
    .eq('name', fields.name)
    .maybeSingle();

  if (existingError) {
    log.error('vendor.exists_check_failed', { error: existingError.message });
    throw AppError.internal(existingError.message);
  }

  if (existing?.active) {
    throw AppError.conflict('A vendor with this name already exists. Edit the existing vendor or choose a different name.');
  }

  // Inactive vendor with the same name → reactivate it (OCC).
  if (existing && !existing.active) {
    let q = sc.from('vendors')
      .update({ ...fields, active: true, last_event_id: idempotencyKey })
      .eq('id', existing.id);
    if (existing.last_event_id) q = q.eq('last_event_id', existing.last_event_id);

    const { data: restored, error: restoreError } = await q.select('id, last_event_id').single();
    if (restoreError) {
      log.error('vendor.restore_failed', { error: restoreError.message });
      throw AppError.internal(restoreError.message);
    }
    return { data: restored, status: 200, events: [] };
  }

  const { data, error } = await sc.from('vendors')
    .insert({ ...fields, tenant_id: ctx.tenantId, last_event_id: idempotencyKey })
    .select('id, last_event_id')
    .single();

  if (error) {
    log.error('vendor.create_failed', { error: error.message });
    throw AppError.internal(error.message);
  }
  return { data, status: 201, events: [] };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/vendors' });
