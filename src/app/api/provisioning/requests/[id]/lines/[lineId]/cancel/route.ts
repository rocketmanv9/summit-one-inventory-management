import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CancelLineSchema = z.object({
  reason: z.string().min(1, 'Cancellation reason is required'),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey, ctx }) => {
  const urlParts = req.url.split('/requests/');
  const rest = urlParts[1] ?? '';
  const requestId = rest.split('/')[0];
  const lineId = rest.split('/lines/')[1]?.split('/')[0];
  if (!requestId || !lineId) throw AppError.badRequest('Request ID and Line ID required');

  const body = CancelLineSchema.parse(await req.json());
  const prov = (supabase as any).schema('provisioning');

  const { data: line } = await prov
    .from('provisioning_lines')
    .select('status')
    .eq('id', lineId)
    .eq('request_id', requestId)
    .eq('tenant_id', ctx.tenantId)
    .limit(1)
    .single();

  if (!line) throw AppError.notFound('Provisioning line not found');

  const cancellableStatuses = ['pending', 'reserved', 'ordered', 'backordered'];
  if (!cancellableStatuses.includes(line.status)) {
    throw AppError.badRequest(`Cannot cancel line in status: ${line.status}`);
  }

  await prov
    .from('provisioning_lines')
    .update({ status: 'cancelled', last_event_id: idempotencyKey })
    .eq('id', lineId);

  await prov
    .from('provisioning_history')
    .insert({
      tenant_id: ctx.tenantId,
      request_id: requestId,
      line_id: lineId,
      action: 'line_cancelled',
      old_status: line.status,
      new_status: 'cancelled',
      actor_user_id: ctx.userId,
      details: { reason: body.reason },
    });

  log.info('line.cancelled', { requestId, lineId });

  return {
    data: { cancelled: true, line_id: lineId },
    status: 200,
    events: [{
      event_name: 'provision_line.cancelled',
      payload: { line_id: lineId, request_id: requestId, reason: body.reason },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/requests/[id]/lines/[lineId]/cancel' });
