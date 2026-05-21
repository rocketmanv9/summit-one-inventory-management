import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getTenantVendorClient } from '@/lib/vendors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractIds(req: Request): { vendorId: string; addressId: string } {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/gv/vendors/[id]/addresses/[addressId]
  const vendorIdx = segments.indexOf('vendors');
  const addrIdx = segments.indexOf('addresses');
  const vendorId = vendorIdx >= 0 ? segments[vendorIdx + 1] : undefined;
  const addressId = addrIdx >= 0 ? segments[addrIdx + 1] : undefined;
  if (!vendorId) throw AppError.badRequest('Vendor ID required');
  if (!addressId) throw AppError.badRequest('Address ID required');
  return { vendorId, addressId };
}

const UpdateAddressSchema = z.object({
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
 * PATCH /api/gv/vendors/:id/addresses/:addressId
 *
 * Update an existing vendor address.
 */
export const PATCH = createSessionWriteRoute(async ({ ctx, req, log }) => {
  const { vendorId, addressId } = extractIds(req);
  const body = UpdateAddressSchema.parse(await req.json());

  const client = await getTenantVendorClient(ctx.tenantId);
  const address = await client.updateAddress(vendorId, addressId, body);

  log.info('vendor_address.updated', { vendorId, addressId });

  return { data: address, status: 200, events: [] };
}, { serviceName: SERVICE_NAME, scope: 'PATCH /api/gv/vendors/[id]/addresses/[addressId]' });

/**
 * DELETE /api/gv/vendors/:id/addresses/:addressId
 *
 * Delete a vendor address.
 */
export const DELETE = createSessionWriteRoute(async ({ ctx, req, log }) => {
  const { vendorId, addressId } = extractIds(req);

  const client = await getTenantVendorClient(ctx.tenantId);
  await client.deleteAddress(vendorId, addressId);

  log.info('vendor_address.deleted', { vendorId, addressId });

  return { data: { id: addressId, deleted: true }, status: 200, events: [] };
}, { serviceName: SERVICE_NAME, scope: 'DELETE /api/gv/vendors/[id]/addresses/[addressId]' });
