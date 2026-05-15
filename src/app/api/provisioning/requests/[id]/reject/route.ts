import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const RejectSchema = z.object({
  reason: z.string().min(1, 'Rejection reason is required'),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey, ctx }) => {
  const urlParts = req.url.split('/requests/');
  const id = urlParts[1]?.split('/')[0];
  if (!id) throw AppError.badRequest('Request ID required');

  const body = RejectSchema.parse(await req.json());
  const prov = (supabase as any).schema('provisioning');

  const { data: request } = await prov
    .from('provisioning_requests')
    .select('status')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .limit(1)
    .single();

  if (!request) throw AppError.notFound('Request not found');
  if (request.status !== 'awaiting_approval') {
    throw AppError.badRequest(`Cannot reject request in status: ${request.status}`);
  }

  await prov
    .from('provisioning_requests')
    .update({ status: 'cancelled', last_event_id: idempotencyKey })
    .eq('id', id);

  // Cancel all pending lines
  await prov
    .from('provisioning_lines')
    .update({ status: 'cancelled' })
    .eq('request_id', id)
    .eq('status', 'pending');

  // Record history
  await prov
    .from('provisioning_history')
    .insert({
      tenant_id: ctx.tenantId,
      request_id: id,
      action: 'request_rejected',
      old_status: 'awaiting_approval',
      new_status: 'cancelled',
      actor_user_id: ctx.userId,
      details: { reason: body.reason },
    });

  log.info('request.rejected', { requestId: id });

  return {
    data: { rejected: true, request_id: id },
    status: 200,
    events: [{
      event_name: 'provision_request.rejected',
      payload: { request_id: id, reason: body.reason },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/requests/[id]/reject' });
