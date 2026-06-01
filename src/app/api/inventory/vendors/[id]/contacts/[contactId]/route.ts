import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function ids(req: Request): { vendorId: string; contactId: string } {
  const segs = new URL(req.url).pathname.split('/');
  const vendorId = segs[segs.indexOf('vendors') + 1];
  const contactId = segs[segs.indexOf('contacts') + 1];
  if (!vendorId || !contactId) throw AppError.badRequest('Missing id');
  return { vendorId, contactId };
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
  is_primary: z.boolean().optional(),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
});

export const PATCH = createSessionWriteRoute(async ({ req, ctx, body, log, idempotencyKey }) => {
  const { vendorId, contactId } = ids(req);
  const sc = await tenantSc(ctx.tenantId!);
  const updates = body as z.infer<typeof UpdateSchema>;
  const { data, error } = await sc.from('vendor_contacts')
    .update({ ...updates, last_event_id: idempotencyKey })
    .eq('id', contactId).eq('vendor_id', vendorId)
    .select().maybeSingle();
  if (error) { log.error('vendor_contacts.update_failed', { error: error.message }); throw AppError.internal(error.message); }
  if (!data) throw AppError.notFound('Contact not found');
  return { data, status: 200, events: [{ event_name: 'vendor_contact.updated', payload: { vendor_id: vendorId, contact_id: contactId }, last_event_id: idempotencyKey }] };
}, { bodySchema: UpdateSchema, emissionOwner: 'route', serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/vendors/[id]/contacts/[contactId]' });

export const DELETE = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const { vendorId, contactId } = ids(req);
  const sc = await tenantSc(ctx.tenantId!);
  const { data, error } = await sc.from('vendor_contacts').delete().eq('id', contactId).eq('vendor_id', vendorId).select('id').maybeSingle();
  if (error) { log.error('vendor_contacts.delete_failed', { error: error.message }); throw AppError.internal(error.message); }
  if (!data) throw AppError.notFound('Contact not found');
  return { data: { id: contactId }, status: 200, events: [{ event_name: 'vendor_contact.deleted', payload: { vendor_id: vendorId, contact_id: contactId }, last_event_id: idempotencyKey }] };
}, { bodySchema: 'raw', emissionOwner: 'route', serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/vendors/[id]/contacts/[contactId]' });
