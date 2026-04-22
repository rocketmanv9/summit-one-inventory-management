import { z } from 'zod';
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { getTenantEquipmentClient } from '@/lib/equipment';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/gv/equipment
 *
 * List all equipment for the current tenant.
 * Tenant-scoped via session auth + GV RLS.
 */
export const GET = createSessionReadRoute(async ({ session }) => {
  const client = await getTenantEquipmentClient(session.tenantId);
  const equipment = await client.list({ activeOnly: true });

  return Response.json({ data: equipment });
}, { serviceName: SERVICE_NAME });

/** Validate request body for equipment creation */
const CreateEquipmentSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  equipment_type_id: z.string().uuid(),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * POST /api/gv/equipment
 *
 * Create a custom equipment entry for the current tenant.
 * Events array is empty — the GV service handles its own event emission.
 */
export const POST = createSessionWriteRoute(async ({ ctx, req, log }) => {
  const body = CreateEquipmentSchema.parse(await req.json());

  const client = await getTenantEquipmentClient(ctx.tenantId);
  const item = await client.create(body);

  log.info('equipment.created', { equipmentId: item.id });

  // GV service emits its own events — no local outbox events needed for this proxy route
  return { data: item, status: 201, events: [] };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/gv/equipment' });
