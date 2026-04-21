import { z } from 'zod';
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getTenantToolClient } from '@/lib/tools';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/gv/tools/[id] -> segments = ['', 'api', 'gv', 'tools', ID]
  const id = segments[segments.length - 1];
  if (!id) throw AppError.badRequest('Tool ID required');
  return id;
}

/**
 * GET /api/gv/tools/:id
 *
 * Get a single tenant tool by ID.
 */
export const GET = createSessionReadRoute(async ({ req, session }) => {
  const id = extractId(req);

  const client = await getTenantToolClient(session.tenantId);
  const tool = await client.getById(id);

  if (!tool) {
    throw AppError.notFound('Tool not found');
  }

  return Response.json({ data: tool });
}, { serviceName: SERVICE_NAME });

/**
 * PATCH /api/gv/tools/:id
 *
 * Update a tenant tool.
 */
const UpdateToolSchema = z.object({
  name: z.string().optional(),
  tool_type_id: z.string().uuid().optional(),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
  is_active: z.boolean().optional(),
});

export const PATCH = createSessionWriteRoute(async ({ ctx, req, log }) => {
  const id = extractId(req);
  const body = UpdateToolSchema.parse(await req.json());

  const client = await getTenantToolClient(ctx.tenantId);
  const tool = await client.update(id, body);

  log.info('tool.updated', { toolId: id });

  // GV service emits its own events — no local outbox events needed for this proxy route
  return { data: tool, status: 200, events: [] };
}, { serviceName: SERVICE_NAME, scope: 'PATCH /api/gv/tools/[id]' });

/**
 * DELETE /api/gv/tools/:id
 *
 * Delete a tenant tool.
 */
export const DELETE = createSessionWriteRoute(async ({ ctx, req, log }) => {
  const id = extractId(req);

  const client = await getTenantToolClient(ctx.tenantId);
  await client.softDelete(id);

  log.info('tool.deleted', { toolId: id });

  // GV service emits its own events — no local outbox events needed for this proxy route
  return { data: { id, deleted: true }, status: 200, events: [] };
}, { serviceName: SERVICE_NAME, scope: 'DELETE /api/gv/tools/[id]' });
