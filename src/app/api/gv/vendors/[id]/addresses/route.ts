import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getTenantVendorClient } from '@/lib/vendors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractVendorId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/gv/vendors/[id]/addresses -> segments = ['', 'api', 'gv', 'vendors', ID, 'addresses']
  const idx = segments.indexOf('vendors');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Vendor ID required');
  return id;
}

const CreateAddressSchema = z.object({
  address_type: z.enum(['billing', 'shipping', 'general']).optional(),
  label: z.string().nullish(),
  street1: z.string().nullish(),
  street2: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  zip: z.string().nullish(),
  country: z.string().nullish(),
});

/**
 * POST /api/gv/vendors/:id/addresses
 *
 * Create a new address for a tenant vendor.
 */
export const POST = createSessionWriteRoute(async ({ ctx, req, log }) => {
  const vendorId = extractVendorId(req);
  const body = CreateAddressSchema.parse(await req.json());

  const client = await getTenantVendorClient(ctx.tenantId);
  const address = await client.createAddress(vendorId, body);

  log.info('vendor_address.created', { vendorId, addressId: address.id });

  return { data: address, status: 201, events: [] };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/gv/vendors/[id]/addresses' });
