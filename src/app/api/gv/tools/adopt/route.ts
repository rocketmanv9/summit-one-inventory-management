import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { getTenantToolClient } from '@/lib/tools';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * POST /api/gv/tools/adopt
 *
 * Adopt one or more tools from the platform catalog into the tenant's tool list.
 */
const AdoptToolsSchema = z.object({
  catalogToolIds: z.array(z.string().uuid()).min(1).max(50),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = AdoptToolsSchema.parse(await req.json());

  const client = await getTenantToolClient(ctx.tenantId);
  const result = await client.adopt(body.catalogToolIds);

  log.info('tool.adopted', { count: body.catalogToolIds.length });

  // GV service emits its own events — no local outbox events needed for this proxy route
  return { data: result, status: 201, events: [] };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/gv/tools/adopt' });
