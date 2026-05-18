import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { resolveBlocker } from '@/lib/provisioning/blocker-resolver';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const ResolveSchema = z.object({
  notes: z.string().optional(),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey, ctx }) => {
  const id = req.url.split('/requests/')[1]?.split('/')[0];
  if (!id) throw AppError.badRequest('Request ID required');

  ResolveSchema.parse(await req.json());

  const result = await resolveBlocker(supabase, ctx.tenantId, id, idempotencyKey);

  log.info('request.resolve_attempted', {
    requestId: id,
    resolved: result.resolved,
    newStatus: result.newStatus,
    remainingBlockers: result.remainingBlockers.length,
  });

  return {
    data: {
      request_id: id,
      resolved: result.resolved,
      new_status: result.newStatus,
      remaining_blockers: result.remainingBlockers,
    },
    status: 200,
    events: result.events,
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/requests/[id]/resolve' });
