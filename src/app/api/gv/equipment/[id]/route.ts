import { z } from 'zod';
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getTenantEquipmentClient } from '@/lib/equipment';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/gv/equipment/[id] -> segments = ['', 'api', 'gv', 'equipment', ID]
  const id = segments[segments.length - 1];
  if (!id) throw AppError.badRequest('Equipment ID required');
  return id;
}

/**
 * GET /api/gv/equipment/:id
 *
 * Get a single tenant equipment entry by ID.
 */
export const GET = createSessionReadRoute(async ({ req, session }) => {
  const id = extractId(req);

  const client = await getTenantEquipmentClient(session.tenantId);
  const item = await client.getById(id);

  if (!item) {
    throw AppError.notFound('Equipment not found');
  }

  return Response.json({ data: item });
}, { serviceName: SERVICE_NAME });

/**
 * PATCH /api/gv/equipment/:id
 *
 * Update a tenant equipment entry.
 */
const UpdateEquipmentSchema = z.object({
  name: z.string().optional(),
  equipment_type_id: z.string().uuid().optional(),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
  is_active: z.boolean().optional(),
});

export const PATCH = createSessionWriteRoute(async ({ ctx, req, log }) => {
  const id = extractId(req);
  const body = UpdateEquipmentSchema.parse(await req.json());

  const client = await getTenantEquipmentClient(ctx.tenantId);
  const item = await client.update(id, body);

  log.info('equipment.updated', { equipmentId: id });

  // GV service emits its own events — no local outbox events needed for this proxy route
  return { data: item, status: 200, events: [] };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'PATCH /api/gv/equipment/[id]' });

/**
 * DELETE /api/gv/equipment/:id
 *
 * Delete a tenant equipment entry.
 */
export const DELETE = createSessionWriteRoute(async ({ ctx, req, log }) => {
  const id = extractId(req);

  const client = await getTenantEquipmentClient(ctx.tenantId);
  await client.softDelete(id);

  log.info('equipment.deleted', { equipmentId: id });

  // GV service emits its own events — no local outbox events needed for this proxy route
  return { data: { id, deleted: true }, status: 200, events: [] };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'DELETE /api/gv/equipment/[id]' });
