import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const UpdateLineSchema = z.object({
  actual_qty: z.number().nullable(),
});

function getLineId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('lines');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing line ID');
  return id;
}

export const PATCH = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const lineId = getLineId(req);
  const body = UpdateLineSchema.parse(await req.json());
  const inv = (supabase as any).schema('inventory');

  const updateData: Record<string, any> = {
    last_event_id: idempotencyKey,
  };

  if (body.actual_qty !== undefined) {
    updateData.qty_counted = body.actual_qty;
    updateData.counted_at = new Date().toISOString();
    updateData.counted_by_user_id = ctx.userId;
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

  log.info('cycle_count_line.updated', { lineId, qty_counted: body.actual_qty });

  return {
    data,
    status: 200,
    events: [{
      event_name: 'cycle_count_line.updated',
      payload: { line_id: lineId, qty_counted: body.actual_qty },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/cycle-counts/:id/lines/:lineId' });
