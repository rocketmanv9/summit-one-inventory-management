import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { geocodeStructured } from '@/lib/geocode';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function ids(req: Request): { vendorId: string; addressId: string } {
  const segs = new URL(req.url).pathname.split('/');
  const vendorId = segs[segs.indexOf('vendors') + 1];
  const addressId = segs[segs.indexOf('addresses') + 1];
  if (!vendorId || !addressId) throw AppError.badRequest('Missing id');
  return { vendorId, addressId };
}

async function tenantSc(tenantId: string) {
  const sb = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  return (sb as any).schema('supply_chain');
}

const UpdateSchema = z.object({
  address_type: z.enum(['billing', 'shipping', 'general']).optional(),
  label: z.string().nullable().optional(),
  street1: z.string().nullable().optional(),
  street2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
});

export const PATCH = createSessionWriteRoute(async ({ req, ctx, body, log, idempotencyKey }) => {
  const { vendorId, addressId } = ids(req);
  const sc = await tenantSc(ctx.tenantId!);
  const updates = { ...(body as z.infer<typeof UpdateSchema>) };

  // Safety net: an edited address with no resolved coordinates gets re-geocoded
  // server-side (same fallback cascade as create) so it stays on the map.
  if ((updates.latitude == null || updates.longitude == null) &&
      (updates.street1 || updates.city || updates.zip)) {
    const geo = await geocodeStructured(updates);
    if (geo) { updates.latitude = geo.latitude; updates.longitude = geo.longitude; }
  }

  const { data, error } = await sc.from('vendor_addresses')
    .update({ ...updates, last_event_id: idempotencyKey })
    .eq('id', addressId).eq('vendor_id', vendorId)
    .select().maybeSingle();
  if (error) { log.error('vendor_addresses.update_failed', { error: error.message }); throw AppError.internal(error.message); }
  if (!data) throw AppError.notFound('Address not found');
  return { data, status: 200, events: [{ event_name: 'vendor_address.updated', payload: { vendor_id: vendorId, address_id: addressId }, last_event_id: idempotencyKey }] };
}, { bodySchema: UpdateSchema, emissionOwner: 'route', serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/vendors/[id]/addresses/[addressId]' });

export const DELETE = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const { vendorId, addressId } = ids(req);
  const sc = await tenantSc(ctx.tenantId!);
  const { data, error } = await sc.from('vendor_addresses').delete().eq('id', addressId).eq('vendor_id', vendorId).select('id').maybeSingle();
  if (error) { log.error('vendor_addresses.delete_failed', { error: error.message }); throw AppError.internal(error.message); }
  if (!data) throw AppError.notFound('Address not found');
  return { data: { id: addressId }, status: 200, events: [{ event_name: 'vendor_address.deleted', payload: { vendor_id: vendorId, address_id: addressId }, last_event_id: idempotencyKey }] };
}, { bodySchema: 'raw', emissionOwner: 'route', serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/vendors/[id]/addresses/[addressId]' });
