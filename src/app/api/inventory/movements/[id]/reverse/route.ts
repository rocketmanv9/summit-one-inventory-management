import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const ReverseSchema = z.object({
  reason_code: z.string().min(1, 'Reason code is required'),
});

function getMovementId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('movements');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing movement ID');
  return id;
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const movementId = getMovementId(req);
  const body = ReverseSchema.parse(await req.json());
  const inv = (supabase as any).schema('inventory');

  const { data, error } = await inv.rpc('rpc_reverse_stock_movement', {
    p_tenant_id: ctx.tenantId,
    p_movement_id: movementId,
    p_reason: body.reason_code,
    p_user_id: ctx.userId,
    p_last_event_id: idempotencyKey,
  });

  if (error) {
    log.error('movement.reverse_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('movement.reversed', { movementId });

  return {
    data: data || { movement_id: movementId },
    status: 200,
    events: [{
      event_name: 'movement.reversed',
      payload: { movement_id: movementId, reason: body.reason_code },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/inventory/movements/:id/reverse' });
