import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { assertCapability } from '@/lib/access-server';

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
  const { data, error } = await sc.from('vendor_contacts').select('*').eq('vendor_id', vendorId(req)).order('is_primary', { ascending: false });
  if (error) { log.error('vendor_contacts.list_failed', { error: error.message }); throw AppError.internal(error.message); }
  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

const ContactSchema = z.object({
  is_primary: z.boolean().optional().default(false),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, body, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'vendors.manage');
  const id = vendorId(req);
  const sc = await tenantSc(ctx.tenantId!);
  const input = body as z.infer<typeof ContactSchema>;
  const { data, error } = await sc.from('vendor_contacts')
    .insert({ tenant_id: ctx.tenantId, vendor_id: id, is_primary: input.is_primary ?? false, name: input.name ?? null, email: input.email ?? null, phone: input.phone ?? null, title: input.title ?? null, last_event_id: idempotencyKey })
    .select().single();
  if (error) { log.error('vendor_contacts.create_failed', { error: error.message }); throw AppError.internal(error.message); }
  return { data, status: 201, events: [{ event_name: 'vendor_contact.created', payload: { vendor_id: id, contact_id: data.id }, last_event_id: idempotencyKey }] };
}, { bodySchema: ContactSchema, emissionOwner: 'route', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/vendors/[id]/contacts' });
