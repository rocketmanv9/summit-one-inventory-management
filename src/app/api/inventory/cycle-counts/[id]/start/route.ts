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

  // Verify count exists and is in a startable state
  const { data: cc, error: ccErr } = await inv
    .from('cycle_counts')
    .select('id, status')
    .eq('id', cycleCountId)
    .single();

  if (ccErr || !cc) throw AppError.notFound('Cycle count not found');
  if (cc.status !== 'draft' && cc.status !== 'scheduled') {
    throw AppError.badRequest(`Cannot start count in '${cc.status}' status`);
  }

  const now = new Date().toISOString();
  const { data, error } = await inv
    .from('cycle_counts')
    .update({
      status: 'in_progress',
      started_at: now,
      snapshot_at: now,
      counted_by_user_id: ctx.userId,
      last_event_id: idempotencyKey,
    })
    .eq('id', cycleCountId)
    .select()
    .single();

  if (error) throw AppError.internal(error.message);

  log.info('cycle_count.started', { cycleCountId });

  return {
    data,
    status: 200,
    events: [{
      event_name: 'cycle_count.started',
      payload: { cycle_count_id: cycleCountId },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/inventory/cycle-counts/:id/start' });
