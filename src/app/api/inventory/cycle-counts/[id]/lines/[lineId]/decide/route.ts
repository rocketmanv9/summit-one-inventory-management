import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const DecisionSchema = z.object({
  decision: z.enum(['accepted', 'rejected', 'investigating', 'pending']),
  reason: z.string().optional(),
});

function getLineId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('lines');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing line ID');
  return id;
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const lineId = getLineId(req);
  const body = DecisionSchema.parse(await req.json());
  const inv = (supabase as any).schema('inventory');

  const updateData: Record<string, any> = {
    decision_status: body.decision,
    decision_reason: body.reason || null,
    decided_by_user_id: ctx.userId,
    decided_at: new Date().toISOString(),
    last_event_id: idempotencyKey,
  };

  // If resetting to pending, clear the decision fields
  if (body.decision === 'pending') {
    updateData.decided_by_user_id = null;
    updateData.decided_at = null;
    updateData.decision_reason = null;
  }

  const { data, error } = await inv
    .from('cycle_count_lines')
    .update(updateData)
    .eq('id', lineId)
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw AppError.notFound('Cycle count line not found');
    }
    throw AppError.internal(error.message);
  }

  log.info('cycle_count_line.decided', { lineId, decision: body.decision });

  return {
    data,
    status: 200,
    events: [{
      event_name: 'cycle_count_line.decided',
      payload: { line_id: lineId, decision: body.decision, reason: body.reason },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/cycle-counts/:id/lines/:lineId/decide' });
