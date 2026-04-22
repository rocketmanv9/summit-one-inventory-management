import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { getTenantEquipmentClient } from '@/lib/equipment';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * POST /api/gv/equipment/adopt
 *
 * Adopt one or more equipment entries from the platform catalog into the tenant's equipment list.
 */
const AdoptEquipmentSchema = z.object({
  catalogEquipmentIds: z.array(z.string().uuid()).min(1).max(50),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log }) => {
  const body = AdoptEquipmentSchema.parse(await req.json());

  const client = await getTenantEquipmentClient(ctx.tenantId);
  const result = await client.adopt(body.catalogEquipmentIds);

  log.info('equipment.adopted', { count: body.catalogEquipmentIds.length });

  // GV service emits its own events — no local outbox events needed for this proxy route
  return { data: result, status: 201, events: [] };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/gv/equipment/adopt' });
