import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { rethrowDeleteError } from '@/lib/api/typed-crud';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// A count may only be hard-deleted while it never touched stock: drafts,
// scheduled counts, and cancelled counts. Posted/approved counts created
// ledger adjustments and stay as audit records forever.
const DELETABLE_STATUSES = ['draft', 'scheduled', 'cancelled'];

function extractId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('cycle-counts');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing cycle count ID');
  return id;
}

// DELETE /api/inventory/cycle-counts/[id] — remove a count that never posted.
// Lines and snapshots cascade via FK; RFID submissions and mobile sessions are
// cleaned explicitly (RESTRICT / plain FKs), and any schedule entry pointing at
// the count is reset to planned so the scheduler can regenerate it.
export const DELETE = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const id = extractId(req);
  const inv = (supabase as any).schema('inventory');

  const { data: count, error: findError } = await inv
    .from('cycle_counts')
    .select('id, count_number, status')
    .eq('id', id)
    .maybeSingle();

  if (findError) throw AppError.internal(findError.message);
  if (!count) throw AppError.notFound('Cycle count not found');
  if (!DELETABLE_STATUSES.includes(count.status)) {
    throw AppError.conflict(
      `A ${count.status} count can't be deleted — only draft, scheduled, or cancelled counts can. ` +
      (count.status === 'posted' || count.status === 'approved'
        ? 'It posted stock adjustments and stays as an audit record.'
        : 'Cancel it first.')
    );
  }

  // Referencing rows without ON DELETE CASCADE:
  const { error: rfidError } = await inv
    .from('rfid_cycle_count_submissions').delete().eq('cycle_count_id', id);
  if (rfidError) throw AppError.internal(`Failed to clean RFID submissions: ${rfidError.message}`);

  const { error: sessionError } = await inv
    .from('mobile_count_sessions').delete().eq('cycle_count_id', id);
  if (sessionError) throw AppError.internal(`Failed to clean mobile sessions: ${sessionError.message}`);

  const { error: scheduleError } = await inv
    .from('cycle_count_schedule')
    .update({ cycle_count_id: null, status: 'planned' })
    .eq('cycle_count_id', id)
    .eq('status', 'generated');
  if (scheduleError) throw AppError.internal(`Failed to reset schedule entry: ${scheduleError.message}`);
  const { error: unlinkError } = await inv
    .from('cycle_count_schedule')
    .update({ cycle_count_id: null })
    .eq('cycle_count_id', id);
  if (unlinkError) throw AppError.internal(`Failed to unlink schedule entry: ${unlinkError.message}`);

  const { error: deleteError } = await inv.from('cycle_counts').delete().eq('id', id);
  if (deleteError) rethrowDeleteError(deleteError, 'cycle count');

  log.info('cycle_count.deleted', { cycleCountId: id, status: count.status });

  return {
    data: { id, deleted: true },
    status: 200,
    events: [{
      event_name: 'cycle_count.deleted',
      payload: { cycle_count_id: id, count_number: count.count_number, previous_status: count.status },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/cycle-counts/:id' });
