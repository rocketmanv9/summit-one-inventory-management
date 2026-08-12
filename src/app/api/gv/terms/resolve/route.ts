import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { getTenantGVClient } from '@/lib/gv';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const ResolveSchema = z.object({
  domain: z.string().min(1, 'domain is required'),
  value: z.string().min(1, 'value is required'),
  auto_create: z.boolean().optional().default(true),
});

/**
 * POST /api/gv/terms/resolve
 *
 * Resolves freetext to a GV term ID.
 * Uses alias → code → label → auto-create resolution chain.
 * Returns events: [] because GV emits its own outbox events.
 */
export const POST = createSessionWriteRoute(async ({ ctx, req, log }) => {
  const body = ResolveSchema.parse(await req.json());

  const gv = await getTenantGVClient(ctx.tenantId);
  const termId = await gv.resolveTermId(
    ctx.tenantId,
    body.domain,
    body.value,
    body.auto_create,
  );

  log.info('gv_term.resolved', { domain: body.domain, value: body.value, termId });

  return {
    data: { term_id: termId, domain: body.domain, value: body.value },
    status: 200,
    events: [], // GV emits its own outbox events
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/gv/terms/resolve' });
