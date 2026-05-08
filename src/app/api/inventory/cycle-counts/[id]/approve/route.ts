import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function getCycleCountId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('cycle-counts');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing cycle count ID');
  return id;
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const cycleCountId = getCycleCountId(req);
  const inv = (supabase as any).schema('inventory');

  const { data, error } = await inv.rpc('rpc_inv_cycle_count_approve', {
    p_tenant_id: ctx.tenantId,
    p_cycle_count_id: cycleCountId,
    p_approved_by_user_id: ctx.userId,
    p_last_event_id: idempotencyKey,
  });

  if (error) {
    log.error('cycle_count.approve_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('cycle_count.approved', { cycleCountId });

  return {
    data: data || { cycle_count_id: cycleCountId },
    status: 200,
    events: [{
      event_name: 'cycle_count.approved',
      payload: { cycle_count_id: cycleCountId },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/inventory/cycle-counts/:id/approve' });
