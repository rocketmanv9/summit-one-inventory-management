import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { issueLine } from '@/lib/provisioning/orchestrator';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const IssueSchema = z.object({
  notes: z.string().optional(),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey, ctx }) => {
  const urlParts = req.url.split('/requests/');
  const rest = urlParts[1] ?? '';
  const requestId = rest.split('/')[0];
  const lineId = rest.split('/lines/')[1]?.split('/')[0];
  if (!requestId || !lineId) throw AppError.badRequest('Request ID and Line ID required');

  IssueSchema.parse(await req.json());

  try {
    const result = await issueLine(supabase, ctx.tenantId, requestId, lineId, ctx.userId, idempotencyKey);
    log.info('line.issued', { requestId, lineId });

    return {
      data: { issued: true, line_id: lineId },
      status: 200,
      events: result.events,
    };
  } catch (err: any) {
    throw AppError.badRequest(err.message);
  }
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/requests/[id]/lines/[lineId]/issue' });
