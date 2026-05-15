import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { approveRequest } from '@/lib/provisioning/orchestrator';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const ApproveSchema = z.object({
  notes: z.string().optional(),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey, ctx }) => {
  const urlParts = req.url.split('/requests/');
  const id = urlParts[1]?.split('/')[0];
  if (!id) throw AppError.badRequest('Request ID required');

  ApproveSchema.parse(await req.json());

  try {
    const result = await approveRequest(supabase, ctx.tenantId, id, ctx.userId, idempotencyKey);
    log.info('request.approved', { requestId: id });

    return {
      data: { approved: true, request_id: id },
      status: 200,
      events: result.events,
    };
  } catch (err: any) {
    throw AppError.badRequest(err.message);
  }
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/requests/[id]/approve' });
