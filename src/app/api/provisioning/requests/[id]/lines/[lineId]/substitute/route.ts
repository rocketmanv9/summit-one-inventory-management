import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const SubstituteSchema = z.object({
  substitute_catalog_item_id: z.string().uuid(),
  reason: z.string().min(1, 'Substitution reason is required'),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey, ctx }) => {
  const urlParts = req.url.split('/requests/');
  const rest = urlParts[1] ?? '';
  const requestId = rest.split('/')[0];
  const lineId = rest.split('/lines/')[1]?.split('/')[0];
  if (!requestId || !lineId) throw AppError.badRequest('Request ID and Line ID required');

  const body = SubstituteSchema.parse(await req.json());
  const prov = (supabase as any).schema('provisioning');

  const { data: line } = await prov
    .from('provisioning_lines')
    .select('*')
    .eq('id', lineId)
    .eq('request_id', requestId)
    .eq('tenant_id', ctx.tenantId)
    .limit(1)
    .single();

  if (!line) throw AppError.notFound('Provisioning line not found');

  const substitutableStatuses = ['pending', 'backordered', 'failed'];
  if (!substitutableStatuses.includes(line.status)) {
    throw AppError.badRequest(`Cannot substitute line in status: ${line.status}`);
  }

  const oldStatus = line.status;

  // Update line with substitute item
  await prov
    .from('provisioning_lines')
    .update({
      original_catalog_item_id: line.catalog_item_id,
      catalog_item_id: body.substitute_catalog_item_id,
      substitution_reason: body.reason,
      status: 'pending',
      last_event_id: idempotencyKey,
    })
    .eq('id', lineId);

  await prov
    .from('provisioning_history')
    .insert({
      tenant_id: ctx.tenantId,
      request_id: requestId,
      line_id: lineId,
      action: 'line_substituted',
      old_status: oldStatus,
      new_status: 'pending',
      actor_user_id: ctx.userId,
      details: {
        original_item: line.catalog_item_id,
        substitute_item: body.substitute_catalog_item_id,
        reason: body.reason,
      },
    });

  log.info('line.substituted', { requestId, lineId, substituteItem: body.substitute_catalog_item_id });

  return {
    data: { substituted: true, line_id: lineId },
    status: 200,
    events: [{
      event_name: 'provision_line.substituted',
      payload: { line_id: lineId, request_id: requestId, substitute_item: body.substitute_catalog_item_id },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/requests/[id]/lines/[lineId]/substitute' });
