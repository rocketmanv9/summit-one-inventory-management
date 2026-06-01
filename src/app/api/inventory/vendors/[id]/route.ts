import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { pickVendorColumns } from '@/lib/vendor-columns';

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
  // GV-style aliases so the Vendors UI renders unchanged.
  return Response.json({ data: {
    ...vendor,
    is_active: !!vendor.active,
    is_custom: true,
    vendor_type_id: vendor.vendor_type_term_id ?? null,
    description: vendor.notes ?? null,
    contacts: contacts || [],
    addresses: addresses || [],
  } });
}, { serviceName: SERVICE_NAME });

// Update a vendor. Accepts GV-style field aliases (vendor_type_id, is_active)
// from the Vendors UI and supply_chain names from the RPC layer. OCC is optional:
// when expected_last_event_id is provided (RPC layer) it's enforced (409 on
// stale); the UI omits it for a plain by-id update. trigger_vendor_events emits.
export const PATCH = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const id = extractId(req);
  const body = await req.json();
  const { expected_last_event_id, id: _id, created_at, tenant_id, last_event_id,
          contacts, addresses, vendor_type_id, is_active, ...rest } = body ?? {};
  const raw: Record<string, any> = { ...rest };
  if (vendor_type_id !== undefined) raw.vendor_type_term_id = vendor_type_id;
  if (is_active !== undefined) raw.active = is_active;
  if ((rest as any).description !== undefined && raw.notes === undefined) raw.notes = (rest as any).description;
  const updates: Record<string, unknown> = { ...pickVendorColumns(raw), last_event_id: idempotencyKey };

  const sc = (supabase as any).schema('supply_chain');
  let q = sc.from('vendors').update(updates).eq('id', id);
  if (expected_last_event_id) q = q.eq('last_event_id', expected_last_event_id);
  const { data, error } = await q.select('id, last_event_id').maybeSingle();

  if (error) { log.error('vendor.update_failed', { error: error.message }); throw AppError.internal(error.message); }
  if (!data) {
    if (expected_last_event_id) throw AppError.conflict('Vendor was updated by someone else. Please refresh and try again.');
    throw AppError.notFound('Vendor not found');
  }
  return { data, status: 200, events: [] };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/vendors/[id]' });

// Soft-delete: deactivate the vendor. OCC optional (enforced only if
// expected_last_event_id is provided). trigger_vendor_events emits.
export const DELETE = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const id = extractId(req);
  const body = await req.json().catch(() => ({}));
  const expected = body?.expected_last_event_id;

  const sc = (supabase as any).schema('supply_chain');
  let q = sc.from('vendors').update({ active: false, last_event_id: idempotencyKey }).eq('id', id);
  if (expected) q = q.eq('last_event_id', expected);
  const { data, error } = await q.select('id, last_event_id').maybeSingle();

  if (error) { log.error('vendor.delete_failed', { error: error.message }); throw AppError.internal(error.message); }
  if (!data) {
    if (expected) throw AppError.conflict('Vendor was updated by someone else. Please refresh and try again.');
    throw AppError.notFound('Vendor not found');
  }
  return { data, status: 200, events: [] };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/vendors/[id]' });
