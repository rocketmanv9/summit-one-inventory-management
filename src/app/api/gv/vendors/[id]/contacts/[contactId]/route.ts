import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getTenantVendorClient } from '@/lib/vendors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractIds(req: Request): { vendorId: string; contactId: string } {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/gv/vendors/[id]/contacts/[contactId]
  const vendorIdx = segments.indexOf('vendors');
  const contactIdx = segments.indexOf('contacts');
  const vendorId = vendorIdx >= 0 ? segments[vendorIdx + 1] : undefined;
  const contactId = contactIdx >= 0 ? segments[contactIdx + 1] : undefined;
  if (!vendorId) throw AppError.badRequest('Vendor ID required');
  if (!contactId) throw AppError.badRequest('Contact ID required');
  return { vendorId, contactId };
}

const UpdateContactSchema = z.object({
  is_primary: z.boolean().optional(),
  name: z.string().nullish(),
  email: z.string().email().nullish(),
  phone: z.string().nullish(),
  title: z.string().nullish(),
});

/**
 * PATCH /api/gv/vendors/:id/contacts/:contactId
 *
 * Update an existing vendor contact.
 */
export const PATCH = createSessionWriteRoute(async ({ ctx, req, log }) => {
  const { vendorId, contactId } = extractIds(req);
  const body = UpdateContactSchema.parse(await req.json());

  const client = await getTenantVendorClient(ctx.tenantId);
  const contact = await client.updateContact(vendorId, contactId, body);

  log.info('vendor_contact.updated', { vendorId, contactId });

  return { data: contact, status: 200, events: [] };
}, { serviceName: SERVICE_NAME, scope: 'PATCH /api/gv/vendors/[id]/contacts/[contactId]' });

/**
 * DELETE /api/gv/vendors/:id/contacts/:contactId
 *
 * Delete a vendor contact.
 */
export const DELETE = createSessionWriteRoute(async ({ ctx, req, log }) => {
  const { vendorId, contactId } = extractIds(req);

  const client = await getTenantVendorClient(ctx.tenantId);
  await client.deleteContact(vendorId, contactId);

  log.info('vendor_contact.deleted', { vendorId, contactId });

  return { data: { id: contactId, deleted: true }, status: 200, events: [] };
}, { serviceName: SERVICE_NAME, scope: 'DELETE /api/gv/vendors/[id]/contacts/[contactId]' });
