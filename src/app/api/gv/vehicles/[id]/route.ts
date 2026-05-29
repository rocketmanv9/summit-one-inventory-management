import { z } from 'zod';
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getTenantVehicleClient } from '@/lib/vehicles';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/gv/vehicles/[id] -> segments = ['', 'api', 'gv', 'vehicles', ID]
  const id = segments[segments.length - 1];
  if (!id) throw AppError.badRequest('Vehicle ID required');
  return id;
}

/**
 * GET /api/gv/vehicles/:id
 *
 * Get a single vehicle by ID for the current tenant.
 */
export const GET = createSessionReadRoute(async ({ req, session }) => {
  const id = extractId(req);

  const client = await getTenantVehicleClient(session.tenantId);
  const vehicle = await client.getById(id);

  if (!vehicle) {
    throw AppError.notFound('Vehicle not found');
  }

  return Response.json({ data: vehicle });
}, { serviceName: SERVICE_NAME });

/** Validate request body for vehicle updates */
const UpdateVehicleSchema = z.object({
  name: z.string().optional(),
  vehicle_type_id: z.string().uuid().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
  is_active: z.boolean().optional(),
});

/**
 * PATCH /api/gv/vehicles/:id
 *
 * Update a vehicle for the current tenant.
 */
export const PATCH = createSessionWriteRoute(async ({ ctx, req }) => {
  const id = extractId(req);
  const body = UpdateVehicleSchema.parse(await req.json());

  const client = await getTenantVehicleClient(ctx.tenantId);
  const vehicle = await client.update(id, body);

  return {
    data: vehicle,
    status: 200,
    // GV service emits its own events — no local outbox events needed
    events: [],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'PATCH /api/gv/vehicles/[id]' });

/**
 * DELETE /api/gv/vehicles/:id
 *
 * Delete a vehicle for the current tenant.
 */
export const DELETE = createSessionWriteRoute(async ({ ctx, req }) => {
  const id = extractId(req);

  const client = await getTenantVehicleClient(ctx.tenantId);
  await client.softDelete(id);

  return {
    data: { id, deleted: true },
    status: 200,
    // GV service emits its own events — no local outbox events needed
    events: [],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'DELETE /api/gv/vehicles/[id]' });
