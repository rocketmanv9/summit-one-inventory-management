import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { rethrowDeleteError } from '@/lib/api/typed-crud';
import { notifyCountAssignment, assertQualifiedCounter } from '@/lib/counts/assignment-email';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const UpdateEntrySchema = z.object({
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  assigned_to_user_id: z.string().uuid().nullable().optional(),
  status: z.enum(['planned', 'skipped']).optional(),
});

function getEntryId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('count-schedule');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing schedule entry ID');
  return id;
}

export const PATCH = createSessionWriteRoute(async ({ ctx, req, log, supabase, fetch, idempotencyKey }) => {
  const entryId = getEntryId(req);
  const body = UpdateEntrySchema.parse(await req.json());

  const inv = (supabase as any).schema('inventory');

  // Entries that already became real counts shouldn't be rescheduled here
  const { data: existing, error: exErr } = await inv
    .from('cycle_count_schedule')
    .select('id, status, assigned_to_user_id, scheduled_date, template:cycle_count_templates(name, count_type, location:locations(name))')
    .eq('id', entryId)
    .eq('tenant_id', ctx.tenantId)
    .single();
  if (exErr || !existing) throw AppError.notFound('Schedule entry not found');
  if (existing.status === 'generated' || existing.status === 'completed') {
    throw AppError.badRequest(`Cannot modify an entry in '${existing.status}' status`);
  }

  const assigneeChanged =
    body.assigned_to_user_id !== undefined &&
    body.assigned_to_user_id !== existing.assigned_to_user_id;
  if (assigneeChanged && body.assigned_to_user_id) {
    await assertQualifiedCounter(supabase, ctx.tenantId, body.assigned_to_user_id);
  }

  const { data, error } = await inv
    .from('cycle_count_schedule')
    .update({
      ...body,
      last_event_id: idempotencyKey,
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryId)
    .eq('tenant_id', ctx.tenantId)
    .select()
    .single();

  if (error) {
    log.error('count_schedule.update_failed', { entryId, error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('count_schedule.updated', { entryId });

  // Delegation = the previous assignee handing it off; plain reassignment otherwise
  const delegated = assigneeChanged && existing.assigned_to_user_id === ctx.userId;

  return {
    data,
    status: 200,
    events: [{
      event_name: 'cycle_count_schedule.updated',
      payload: { entry_id: entryId, changes: Object.keys(body) },
      last_event_id: idempotencyKey,
    }],
    afterCommit: async () => {
      if (!assigneeChanged || !body.assigned_to_user_id) return;
      await notifyCountAssignment({
        fetchImpl: fetch,
        supabase,
        log,
        tenantId: ctx.tenantId,
        assigneeUserId: body.assigned_to_user_id,
        actorUserId: ctx.userId,
        delegated,
        counts: [{
          templateName: existing.template?.name || 'Cycle count',
          locationName: existing.template?.location?.name,
          countType: existing.template?.count_type,
          scheduledDate: body.scheduled_date || existing.scheduled_date,
        }],
      });
    },
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/count-schedule/:id' });

export const DELETE = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const entryId = getEntryId(req);

  // Removing an entry only unlinks it from the calendar — any cycle count that
  // was already generated from it is left intact and still lives in the
  // cycle-counts list (cancel it there if you want to void it). So we allow
  // deleting entries in any status, not just 'planned'.
  const inv = (supabase as any).schema('inventory');
  const { error } = await inv
    .from('cycle_count_schedule')
    .delete()
    .eq('id', entryId)
    .eq('tenant_id', ctx.tenantId);

  if (error) {
    rethrowDeleteError(error, 'schedule entry');
  }

  log.info('count_schedule.deleted', { entryId });

  return {
    data: { id: entryId },
    status: 200,
    events: [{
      event_name: 'cycle_count_schedule.deleted',
      payload: { entry_id: entryId },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/count-schedule/:id' });
