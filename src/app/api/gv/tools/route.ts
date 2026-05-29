import { z } from 'zod';
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { getTenantToolClient } from '@/lib/tools';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/gv/tools
 *
 * List the tenant's tools (active only).
 */
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const client = await getTenantToolClient(session.tenantId);
  const tools = await client.list({ activeOnly: true });

  return Response.json({ data: tools });
}, { serviceName: SERVICE_NAME });

/**
 * POST /api/gv/tools
 *
 * Create a custom tool for the tenant.
 */
const CreateToolSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  tool_type_id: z.string().uuid(),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = CreateToolSchema.parse(await req.json());

  const client = await getTenantToolClient(ctx.tenantId);
  const tool = await client.create(body);

  log.info('tool.created', { toolId: tool.id });

  // GV service emits its own events — no local outbox events needed for this proxy route
  return { data: tool, status: 201, events: [] };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/gv/tools' });
