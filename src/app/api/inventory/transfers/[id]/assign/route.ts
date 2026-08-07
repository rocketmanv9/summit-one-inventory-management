import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { notifyTransferAssignment } from '@/lib/transfers/assignment-email';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const AssignSchema = z.object({
  // The full desired assignee set (idempotent replace). Empty clears assignment.
  user_ids: z.array(z.string().uuid()).max(25),
});

function getTransferId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('transfers') + 1];
  if (!id) throw AppError.badRequest('Missing transfer id');
  return id;
}

// Assign a transfer to one or more people. Each assignee gets a task (task_type
// 'transfer') so the move lands on their My Day card; the transfer row also
// carries a denormalized assigned_to_user_ids summary for list badges. Mirrors
// the cycle-count assign route. No qualification gate — anyone can be handed a
// transfer. Idempotent replace: user_ids is the desired full set; assignees
// dropped from it have their open task cancelled.
export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, fetch, idempotencyKey }) => {
  const transferId = getTransferId(req);
  const body = AssignSchema.parse(await req.json());
  const desired = [...new Set(body.user_ids)];

  const inv = (supabase as any).schema('inventory');

  const { data: transfer, error: tErr } = await inv
    .from('transfers')
    .select('id, status, transfer_number, assigned_to_user_ids, from_location:locations!transfers_from_location_id_fkey(name), to_location:locations!transfers_to_location_id_fkey(name)')
    .eq('id', transferId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (tErr) { log.error('transfer.assign_load_failed', { error: tErr.message }); throw AppError.internal(tErr.message); }
  if (!transfer) throw AppError.notFound('Transfer not found');
  if (['completed', 'cancelled'].includes(transfer.status)) {
    throw AppError.badRequest(`Cannot assign a transfer in '${transfer.status}' status`);
  }

  // Build a one-line "what's moving" summary from the lines (best-effort).
  let itemsSummary: string | null = null;
  const { data: lines } = await inv
    .from('transfer_lines')
    .select('qty, catalog_item:catalog_items(name)')
    .eq('transfer_id', transferId)
    .eq('tenant_id', ctx.tenantId)
    .limit(10);
  if (lines && lines.length > 0) {
    const first = lines[0];
    const firstLabel = `${first.qty} × ${first.catalog_item?.name ?? 'item'}`;
    itemsSummary = lines.length === 1 ? firstLabel : `${firstLabel} +${lines.length - 1} more`;
  }

  const previous: string[] = transfer.assigned_to_user_ids ?? [];
  const removed = previous.filter((id) => !desired.includes(id));

  const { data, error } = await inv
    .from('transfers')
    .update({ assigned_to_user_ids: desired, updated_at: new Date().toISOString() })
    .eq('id', transferId)
    .eq('tenant_id', ctx.tenantId)
    .select('id, assigned_to_user_ids')
    .maybeSingle();
  if (error) { log.error('transfer.assign_failed', { error: error.message }); throw AppError.internal(error.message); }
  if (!data) throw AppError.conflict('Transfer was updated by someone else. Please refresh and try again.');

  // Cancel tasks for people no longer assigned (fires task.cancelled via trigger).
  if (removed.length > 0) {
    const removedKeys = removed.map((uid) => `transfer_${transferId}_${uid}`);
    const { error: cancelErr } = await supabase
      .from('tasks')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId)
      .in('last_event_id', removedKeys)
      .not('status', 'in', '(done,cancelled)');
    if (cancelErr) log.warn('transfer.unassign_task_failed', { error: cancelErr.message });
  }

  log.info('transfer.assigned', { transferId, assignees: desired.length });

  return {
    data,
    status: 200,
    events: [{
      event_name: 'transfer.assigned',
      payload: { transfer_id: transferId, user_ids: desired, from_user_ids: previous },
      last_event_id: idempotencyKey,
    }],
    afterCommit: async () => {
      await notifyTransferAssignment({
        fetchImpl: fetch,
        supabase,
        log,
        tenantId: ctx.tenantId,
        assigneeUserIds: desired,
        actorUserId: ctx.userId,
        info: {
          transferId,
          transferNumber: transfer.transfer_number,
          fromLocationName: transfer.from_location?.name ?? null,
          toLocationName: transfer.to_location?.name ?? null,
          itemsSummary,
        },
      });
    },
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/transfers/:id/assign' });
