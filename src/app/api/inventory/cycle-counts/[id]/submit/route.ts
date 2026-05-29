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

  const { data, error } = await inv
    .from('cycle_counts')
    .update({
      status: 'under_review',
      completed_at: new Date().toISOString(),
      last_event_id: idempotencyKey,
    })
    .eq('id', cycleCountId)
    .eq('status', 'in_progress')
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw AppError.notFound('Cycle count not found or not in progress');
    }
    throw AppError.internal(error.message);
  }

  log.info('cycle_count.submitted', { cycleCountId });

  return {
    data,
    status: 200,
    events: [{
      event_name: 'cycle_count.submitted',
      payload: { cycle_count_id: cycleCountId },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/cycle-counts/:id/submit' });
