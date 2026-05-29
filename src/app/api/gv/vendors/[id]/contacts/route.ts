import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getTenantVendorClient } from '@/lib/vendors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractVendorId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/gv/vendors/[id]/contacts -> segments = ['', 'api', 'gv', 'vendors', ID, 'contacts']
  const idx = segments.indexOf('vendors');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Vendor ID required');
  return id;
}

const CreateContactSchema = z.object({
  is_primary: z.boolean().optional(),
  name: z.string().nullish(),
  email: z.string().email().nullish(),
  phone: z.string().nullish(),
  title: z.string().nullish(),
});

/**
 * POST /api/gv/vendors/:id/contacts
 *
 * Create a new contact for a tenant vendor.
 */
export const POST = createSessionWriteRoute(async ({ ctx, req, log }) => {
  const vendorId = extractVendorId(req);
  const body = CreateContactSchema.parse(await req.json());

  const client = await getTenantVendorClient(ctx.tenantId);
  const contact = await client.createContact(vendorId, body);

  log.info('vendor_contact.created', { vendorId, contactId: contact.id });

  return { data: contact, status: 201, events: [] };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/gv/vendors/[id]/contacts' });
