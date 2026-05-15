import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { cancelRequest } from '@/lib/provisioning/orchestrator';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CancelSchema = z.object({
  reason: z.string().min(1, 'Cancellation reason is required'),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey, ctx }) => {
  const urlParts = req.url.split('/requests/');
  const id = urlParts[1]?.split('/')[0];
  if (!id) throw AppError.badRequest('Request ID required');

  const body = CancelSchema.parse(await req.json());

  try {
    const result = await cancelRequest(supabase, ctx.tenantId, id, ctx.userId, body.reason, idempotencyKey);
    log.info('request.cancelled', { requestId: id });

    return {
      data: { cancelled: true, request_id: id },
      status: 200,
      events: result.events,
    };
  } catch (err: any) {
    throw AppError.badRequest(err.message);
  }
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/requests/[id]/cancel' });
