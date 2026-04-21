import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { getTenantVehicleClient } from '@/lib/vehicles';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/** Validate request body for catalog vehicle adoption */
const AdoptVehiclesSchema = z.object({
  catalogVehicleIds: z.array(z.string().uuid()).min(1).max(50),
});

/**
 * POST /api/gv/vehicles/adopt
 *
 * Adopt one or more vehicles from the platform catalog into the tenant's fleet.
 * Events array is empty — the GV service handles its own event emission.
 */
export const POST = createSessionWriteRoute(async ({ ctx, req }) => {
  const body = AdoptVehiclesSchema.parse(await req.json());

  const client = await getTenantVehicleClient(ctx.tenantId);
  const result = await client.adopt(body.catalogVehicleIds);

  return {
    data: result,
    status: 201,
    // GV service emits its own events — no local outbox events needed
    events: [],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/gv/vehicles/adopt' });
