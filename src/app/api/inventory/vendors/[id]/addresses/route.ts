import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

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
  const { data, error } = await sc.from('vendor_addresses').select('*').eq('vendor_id', vendorId(req)).order('address_type');
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
});

export const POST = createSessionWriteRoute(async ({ req, ctx, body, log, idempotencyKey }) => {
  const id = vendorId(req);
  const sc = await tenantSc(ctx.tenantId!);
  const a = body as z.infer<typeof AddressSchema>;
  const { data, error } = await sc.from('vendor_addresses')
    .insert({ tenant_id: ctx.tenantId, vendor_id: id, address_type: a.address_type ?? 'general', label: a.label ?? null, street1: a.street1 ?? null, street2: a.street2 ?? null, city: a.city ?? null, state: a.state ?? null, zip: a.zip ?? null, country: a.country ?? null, last_event_id: idempotencyKey })
    .select().single();
  if (error) { log.error('vendor_addresses.create_failed', { error: error.message }); throw AppError.internal(error.message); }
  return { data, status: 201, events: [{ event_name: 'vendor_address.created', payload: { vendor_id: id, address_id: data.id }, last_event_id: idempotencyKey }] };
}, { bodySchema: AddressSchema, emissionOwner: 'route', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/vendors/[id]/addresses' });
