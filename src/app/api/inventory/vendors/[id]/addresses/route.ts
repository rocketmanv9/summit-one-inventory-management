import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { geocodeStructured } from '@/lib/geocode';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function vendorId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('vendors') + 1];
  if (!id) throw AppError.badRequest('Missing vendor id');
  return id;
}

async function tenantSc(tenantId: string) {
  const sb = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  return (sb as any).schema('supply_chain');
}

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const sc = await tenantSc(session.tenantId!);
  const id = vendorId(req);
  // ?nearest_to=<inventory.locations id> ranks this vendor's addresses by
  // great-circle distance from that tenant location (nearest first).
  const nearestTo = new URL(req.url).searchParams.get('nearest_to');
  if (nearestTo) {
    const { data, error } = await sc.rpc('rpc_nearest_vendor_addresses', {
      p_tenant_id: session.tenantId!,
      p_vendor_id: id,
      p_location_id: nearestTo,
    });
    if (error) { log.error('vendor_addresses.nearest_failed', { error: error.message }); throw AppError.internal(error.message); }
    return Response.json({ data });
  }
  const { data, error } = await sc.from('vendor_addresses').select('*').eq('vendor_id', id).order('address_type');
  if (error) { log.error('vendor_addresses.list_failed', { error: error.message }); throw AppError.internal(error.message); }
  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

const AddressSchema = z.object({
  address_type: z.enum(['billing', 'shipping', 'general']).optional().default('general'),
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

export const POST = createSessionWriteRoute(async ({ req, ctx, body, log, idempotencyKey }) => {
  const id = vendorId(req);
  const sc = await tenantSc(ctx.tenantId!);
  const a = body as z.infer<typeof AddressSchema>;

  // Safety net: if the client didn't resolve coordinates (e.g. Nominatim missed
  // at street precision), geocode server-side with the same fallback cascade so
  // the address still lands on the map and in nearest-location ranking.
  let { latitude, longitude } = a;
  if ((latitude == null || longitude == null) && (a.city || a.zip || a.street1)) {
    const geo = await geocodeStructured(a);
    if (geo) { latitude = geo.latitude; longitude = geo.longitude; }
  }

  const { data, error } = await sc.from('vendor_addresses')
    .insert({ tenant_id: ctx.tenantId, vendor_id: id, address_type: a.address_type ?? 'general', label: a.label ?? null, street1: a.street1 ?? null, street2: a.street2 ?? null, city: a.city ?? null, state: a.state ?? null, zip: a.zip ?? null, country: a.country ?? null, latitude: latitude ?? null, longitude: longitude ?? null, last_event_id: idempotencyKey })
    .select().single();
  if (error) { log.error('vendor_addresses.create_failed', { error: error.message }); throw AppError.internal(error.message); }
  return { data, status: 201, events: [{ event_name: 'vendor_address.created', payload: { vendor_id: id, address_id: data.id }, last_event_id: idempotencyKey }] };
}, { bodySchema: AddressSchema, emissionOwner: 'route', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/vendors/[id]/addresses' });
