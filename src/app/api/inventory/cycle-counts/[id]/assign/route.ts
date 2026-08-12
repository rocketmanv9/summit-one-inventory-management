import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { notifyCountAssignment, assertQualifiedCounter } from '@/lib/counts/assignment-email';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const AssignSchema = z.object({
  assigned_to_user_id: z.string().uuid(),
});

function getCountId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('cycle-counts');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing cycle count ID');
  return id;
}

// Reassign (delegate) a not-yet-finished cycle count to another qualified counter.
export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, fetch, idempotencyKey }) => {
  const countId = getCountId(req);
  const body = AssignSchema.parse(await req.json());

  const inv = (supabase as any).schema('inventory');
  const { data: count, error: countErr } = await inv
    .from('cycle_counts')
    .select('id, status, count_number, count_type, counted_by_user_id, location:locations(name)')
    .eq('id', countId)
    .eq('tenant_id', ctx.tenantId)
    .single();
  if (countErr || !count) throw AppError.notFound('Cycle count not found');
  if (!['draft', 'scheduled', 'in_progress'].includes(count.status)) {
    throw AppError.badRequest(`Cannot reassign a count in '${count.status}' status`);
  }
  if (count.counted_by_user_id === body.assigned_to_user_id) {
    throw AppError.badRequest('That person is already assigned to this count');
  }

  await assertQualifiedCounter(supabase, ctx.tenantId, body.assigned_to_user_id);

  const { data, error } = await inv
    .from('cycle_counts')
    .update({
      counted_by_user_id: body.assigned_to_user_id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', countId)
    .eq('tenant_id', ctx.tenantId)
    .select('id, count_number, counted_by_user_id')
    .single();

  if (error) {
    log.error('cycle_count.reassign_failed', { countId, error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('cycle_count.reassigned', { countId, to: body.assigned_to_user_id });

  const delegated = count.counted_by_user_id === ctx.userId;

  return {
    data,
    status: 200,
    events: [{
      event_name: 'cycle_count.reassigned',
      payload: {
        cycle_count_id: countId,
        from_user_id: count.counted_by_user_id,
        to_user_id: body.assigned_to_user_id,
      },
      last_event_id: idempotencyKey,
    }],
    afterCommit: async () => {
      await notifyCountAssignment({
        fetchImpl: fetch,
        supabase,
        log,
        tenantId: ctx.tenantId,
        assigneeUserId: body.assigned_to_user_id,
        actorUserId: ctx.userId,
        delegated,
        counts: [{
          templateName: `Count ${count.count_number}`,
          locationName: count.location?.name,
          countType: count.count_type,
          countNumber: count.count_number,
          cycleCountId: countId,
        }],
      });
    },
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/cycle-counts/:id/assign' });
