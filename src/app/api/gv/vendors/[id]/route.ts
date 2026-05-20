import { z } from 'zod';
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getTenantVendorClient } from '@/lib/vendors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/gv/vendors/[id] -> segments = ['', 'api', 'gv', 'vendors', ID]
  const id = segments[segments.length - 1];
  if (!id) throw AppError.badRequest('Vendor ID required');
  return id;
}

/**
 * GET /api/gv/vendors/:id
 *
 * Get a single tenant vendor by ID.
 */
export const GET = createSessionReadRoute(async ({ req, session }) => {
  const id = extractId(req);

  const client = await getTenantVendorClient(session.tenantId);
  const vendor = await client.getById(id);

  if (!vendor) {
    throw AppError.notFound('Vendor not found');
  }

  return Response.json({ data: vendor });
}, { serviceName: SERVICE_NAME });

/**
 * PATCH /api/gv/vendors/:id
 *
 * Update a tenant vendor.
 */
const UpdateVendorSchema = z.object({
  name: z.string().optional(),
  vendor_type_id: z.string().uuid().optional(),
  account_number: z.string().optional(),
  payment_terms: z.string().optional(),
  notes: z.string().optional(),
  is_active: z.boolean().optional(),
});

export const PATCH = createSessionWriteRoute(async ({ ctx, req, log }) => {
  const id = extractId(req);
  const body = UpdateVendorSchema.parse(await req.json());

  const client = await getTenantVendorClient(ctx.tenantId);
  const vendor = await client.update(id, body);

  log.info('vendor.updated', { vendorId: id });

  // GV service emits its own events — no local outbox events needed for this proxy route
  return { data: vendor, status: 200, events: [] };
}, { serviceName: SERVICE_NAME, scope: 'PATCH /api/gv/vendors/[id]' });

/**
 * DELETE /api/gv/vendors/:id
 *
 * Delete a tenant vendor.
 */
export const DELETE = createSessionWriteRoute(async ({ ctx, req, log }) => {
  const id = extractId(req);

  const client = await getTenantVendorClient(ctx.tenantId);
  await client.softDelete(id);

  log.info('vendor.deleted', { vendorId: id });

  // GV service emits its own events — no local outbox events needed for this proxy route
  return { data: { id, deleted: true }, status: 200, events: [] };
}, { serviceName: SERVICE_NAME, scope: 'DELETE /api/gv/vendors/[id]' });
