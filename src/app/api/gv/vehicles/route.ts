import { z } from 'zod';
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { getTenantVehicleClient } from '@/lib/vehicles';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/gv/vehicles
 *
 * List all vehicles for the current tenant.
 * Tenant-scoped via session auth + GV RLS.
 */
export const GET = createSessionReadRoute(async ({ session }) => {
  const client = await getTenantVehicleClient(session.tenantId);
  const vehicles = await client.list({ activeOnly: true });

  return Response.json({ data: vehicles });
}, { serviceName: SERVICE_NAME });

/** Validate request body for vehicle creation */
const CreateVehicleSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  vehicle_type_id: z.string().uuid(),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * POST /api/gv/vehicles
 *
 * Create a custom vehicle for the current tenant.
 * Events array is empty — the GV service handles its own event emission.
 */
export const POST = createSessionWriteRoute(async ({ ctx, req }) => {
  const body = CreateVehicleSchema.parse(await req.json());

  const client = await getTenantVehicleClient(ctx.tenantId);
  const vehicle = await client.create(body);

  return {
    data: vehicle,
    status: 201,
    // GV service emits its own events — no local outbox events needed
    events: [],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/gv/vehicles' });
