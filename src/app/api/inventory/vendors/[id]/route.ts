import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('vendors') + 1];
  if (!id) throw AppError.badRequest('Missing vendor id');
  return id;
}

// Vendor detail with contacts + addresses.
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const id = extractId(req);
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });
  const sc = (supabase as any).schema('supply_chain');
  const { data: vendor, error } = await sc.from('vendors').select('*').eq('id', id).maybeSingle();
  if (error) { log.error('vendor.get_failed', { error: error.message }); throw AppError.internal(error.message); }
  if (!vendor) throw AppError.notFound('Vendor not found');
  const [{ data: contacts }, { data: addresses }] = await Promise.all([
    sc.from('vendor_contacts').select('*').eq('vendor_id', id).order('is_primary', { ascending: false }),
    sc.from('vendor_addresses').select('*').eq('vendor_id', id).order('address_type'),
  ]);
  return Response.json({ data: { ...vendor, contacts: contacts || [], addresses: addresses || [] } });
}, { serviceName: SERVICE_NAME });

// OCC update. Body: strip-cleaned vendor columns + expected_last_event_id.
// trigger_vendor_events owns emission.
export const PATCH = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const id = extractId(req);
  const body = await req.json();
  const { expected_last_event_id, id: _id, created_at, tenant_id, last_event_id, ...updates } = body ?? {};
  if (!expected_last_event_id) throw AppError.badRequest('Missing expected_last_event_id');

  const sc = (supabase as any).schema('supply_chain');
  const { data, error } = await sc.from('vendors')
    .update({ ...updates, last_event_id: idempotencyKey })
    .eq('id', id).eq('last_event_id', expected_last_event_id)
    .select('id, last_event_id').maybeSingle();

  if (error) {
    log.error('vendor.update_failed', { error: error.message });
    throw AppError.internal(error.message);
  }
  if (!data) throw AppError.conflict('Vendor was updated by someone else. Please refresh and try again.');

  return { data, status: 200, events: [] };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/vendors/[id]' });

// Soft-delete: deactivate the vendor (OCC). Body: { expected_last_event_id }.
export const DELETE = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const id = extractId(req);
  const body = await req.json().catch(() => ({}));
  const expected = body?.expected_last_event_id;
  if (!expected) throw AppError.badRequest('Missing expected_last_event_id');

  const sc = (supabase as any).schema('supply_chain');
  const { data, error } = await sc.from('vendors')
    .update({ active: false, last_event_id: idempotencyKey })
    .eq('id', id).eq('last_event_id', expected)
    .select('id, last_event_id').maybeSingle();

  if (error) {
    log.error('vendor.delete_failed', { error: error.message });
    throw AppError.internal(error.message);
  }
  if (!data) throw AppError.conflict('Vendor was updated by someone else. Please refresh and try again.');

  return { data, status: 200, events: [] };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/vendors/[id]' });
