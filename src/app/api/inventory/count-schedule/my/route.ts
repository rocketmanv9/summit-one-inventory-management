import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export interface MyCountItem {
  kind: 'scheduled' | 'count';
  schedule_entry_id: string | null;
  cycle_count_id: string | null;
  template_name: string;
  location_name: string | null;
  count_type: string | null;
  is_blind: boolean;
  scheduled_date: string | null;
  count_number: string | null;
  count_status: string | null;
  entry_status: string | null;
  overdue: boolean;
}

/** Statuses where the count still needs the assignee's attention. */
const ACTIVE_COUNT_STATUSES = ['draft', 'scheduled', 'in_progress', 'under_review'];

// GET /api/inventory/count-schedule/my — everything cycle-count-related
// assigned to the signed-in user: upcoming/overdue schedule entries plus
// already-created counts they haven't finished.
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 60);
  const horizonStr = horizon.toISOString().slice(0, 10);

  const [entriesRes, countsRes] = await Promise.all([
    inv.from('cycle_count_schedule')
      .select('id, scheduled_date, status, cycle_count_id, template:cycle_count_templates(name, count_type, is_blind, location:locations(name)), cycle_count:cycle_counts(id, count_number, status)')
      .eq('tenant_id', session.tenantId)
      .eq('assigned_to_user_id', session.userId)
      .in('status', ['planned', 'generated'])
      .lte('scheduled_date', horizonStr)
      .order('scheduled_date')
      .limit(100),
    inv.from('cycle_counts')
      .select('id, count_number, status, count_type, is_blind, scheduled_for, location:locations(name)')
      .eq('tenant_id', session.tenantId)
      .eq('counted_by_user_id', session.userId)
      .in('status', ACTIVE_COUNT_STATUSES)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  if (entriesRes.error) {
    log.error('count_schedule.my.entries_failed', { error: entriesRes.error.message });
    throw AppError.internal(entriesRes.error.message);
  }
  if (countsRes.error) {
    log.error('count_schedule.my.counts_failed', { error: countsRes.error.message });
    throw AppError.internal(countsRes.error.message);
  }

  const items: MyCountItem[] = [];
  const seenCountIds = new Set<string>();

  for (const e of entriesRes.data || []) {
    // A generated entry whose count is already done needs no attention
    if (e.status === 'generated' && e.cycle_count && !ACTIVE_COUNT_STATUSES.includes(e.cycle_count.status)) {
      continue;
    }
    if (e.cycle_count_id) seenCountIds.add(e.cycle_count_id);
    items.push({
      kind: 'scheduled',
      schedule_entry_id: e.id,
      cycle_count_id: e.cycle_count_id,
      template_name: e.template?.name || 'Cycle count',
      location_name: e.template?.location?.name ?? null,
      count_type: e.template?.count_type ?? null,
      is_blind: e.template?.is_blind ?? false,
      scheduled_date: e.scheduled_date,
      count_number: e.cycle_count?.count_number ?? null,
      count_status: e.cycle_count?.status ?? null,
      entry_status: e.status,
      overdue: e.status === 'planned' && e.scheduled_date < today,
    });
  }

  // Counts assigned directly (not via the schedule)
  for (const c of countsRes.data || []) {
    if (seenCountIds.has(c.id)) continue;
    items.push({
      kind: 'count',
      schedule_entry_id: null,
      cycle_count_id: c.id,
      template_name: `Count ${c.count_number}`,
      location_name: c.location?.name ?? null,
      count_type: c.count_type,
      is_blind: c.is_blind ?? false,
      scheduled_date: c.scheduled_for,
      count_number: c.count_number,
      count_status: c.status,
      entry_status: null,
      overdue: !!c.scheduled_for && c.scheduled_for < today,
    });
  }

  items.sort((a, b) => (a.scheduled_date || '9999').localeCompare(b.scheduled_date || '9999'));

  return Response.json({ data: items });
}, { serviceName: SERVICE_NAME });
