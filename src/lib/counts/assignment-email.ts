/**
 * Assignment notification emails for cycle counts.
 *
 * Called from `afterCommit` in the count-schedule routes, so a mail failure
 * never fails the mutation — everything here is best-effort and just logs.
 * Skips silently when Resend isn't configured, when the assignee assigned
 * themselves, or when the assignee has no email on file.
 */
import { AppError } from '@rocketmanv9/chassis/errors';
import { sendEmail, isEmailConfigured } from '@/lib/email/send';
import { insertNotification } from '@/lib/notifications';

type FetchLike = typeof fetch;

export interface AssignedCountInfo {
  templateName: string;
  locationName?: string | null;
  scheduledDate?: string | null;
  countType?: string | null;
  countNumber?: string | null;
  /**
   * The actual cycle_counts.id, when this assignment is for a materialized
   * count (create/reassign) rather than a schedule entry. When present, a task
   * is created/reassigned for the assignee; when absent, only a notification.
   */
  cycleCountId?: string | null;
}

const COUNT_TYPE_LABELS: Record<string, string> = {
  full: 'Full Inventory',
  partial: 'Partial Count',
  spot_check: 'Spot Check',
};

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SERVICE_BASE_URL || '').replace(/\/$/, '');
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function describeCount(c: AssignedCountInfo): string {
  const parts = [c.templateName];
  if (c.locationName) parts.push(`at ${c.locationName}`);
  if (c.countType) parts.push(`(${COUNT_TYPE_LABELS[c.countType] || c.countType})`);
  if (c.scheduledDate) parts.push(`— ${formatDate(c.scheduledDate)}`);
  if (c.countNumber) parts.push(`— ${c.countNumber}`);
  return parts.join(' ');
}

/**
 * Create (or reassign) the task that represents "go do this cycle count".
 *
 * One task per count, keyed by `cycle_count_<id>` in last_event_id so it's
 * idempotent: the first assignment inserts (-> task.created event), a later
 * reassignment moves it to the new counter (-> task.assigned event). Best-effort
 * — a task failure must never fail the count mutation that triggered it.
 */
async function upsertCountTask(
  supabase: any,
  log: { warn: (msg: string, meta?: any) => void },
  opts: {
    tenantId: string;
    assigneeUserId: string;
    actorUserId?: string | null;
    info: AssignedCountInfo;
  },
): Promise<void> {
  const { tenantId, assigneeUserId, actorUserId, info } = opts;
  const cycleCountId = info.cycleCountId;
  if (!cycleCountId) return; // schedule entries have no count to attach a task to

  const eventKey = `cycle_count_${cycleCountId}`;
  const title = `Cycle count: ${info.templateName}`;
  const description = describeCount(info);
  const link = `/inventory/cycle-counts/${cycleCountId}`;

  try {
    const { data: existing } = await supabase
      .from('tasks')
      .select('id, assigned_to_user_id, status')
      .eq('tenant_id', tenantId)
      .eq('last_event_id', eventKey)
      .maybeSingle();

    if (existing) {
      const reopen = existing.status === 'done' || existing.status === 'cancelled';
      // Nothing to do if the same person already holds an open task.
      if (existing.assigned_to_user_id === assigneeUserId && !reopen) return;
      const patch: Record<string, any> = {
        assigned_to_user_id: assigneeUserId,
        title,
        description,
        link,
      };
      if (reopen) {
        patch.status = 'open';
        patch.completed_at = null;
        patch.completed_by_user_id = null;
      }
      const { error } = await supabase
        .from('tasks')
        .update(patch)
        .eq('id', existing.id)
        .eq('tenant_id', tenantId);
      if (error) log.warn('count_task.reassign_failed', { cycleCountId, error: error.message });
      return;
    }

    // First assignment — upsert so concurrent retries don't double-insert.
    const { error } = await supabase
      .from('tasks')
      .upsert({
        tenant_id: tenantId,
        assigned_to_user_id: assigneeUserId,
        created_by_user_id: actorUserId ?? null,
        task_type: 'cycle_count',
        title,
        description,
        status: 'open',
        priority: 'normal',
        related_entity_type: 'cycle_count',
        related_entity_id: cycleCountId,
        link,
        last_event_id: eventKey,
      }, { onConflict: 'tenant_id,last_event_id', ignoreDuplicates: true });
    if (error) log.warn('count_task.insert_failed', { cycleCountId, error: error.message });
  } catch (err: any) {
    log.warn('count_task.failed', { cycleCountId, error: err?.message });
  }
}

export async function notifyCountAssignment(opts: {
  fetchImpl: FetchLike;
  supabase: any;
  log: { info: (msg: string, meta?: any) => void; warn: (msg: string, meta?: any) => void };
  tenantId: string;
  assigneeUserId: string;
  /** Who performed the assignment; no email is sent when they assigned themselves. */
  actorUserId?: string | null;
  counts: AssignedCountInfo[];
  /** True when an existing assignee handed the count to someone else. */
  delegated?: boolean;
  /**
   * Notify the assignee even when they assigned the count to themselves.
   * Tasks are always created regardless of this flag; this only governs the
   * in-app notification. Email always skips self-assignment.
   */
  alwaysNotify?: boolean;
}): Promise<void> {
  const { fetchImpl, supabase, log, tenantId, assigneeUserId, actorUserId, counts, delegated, alwaysNotify } = opts;

  if (counts.length === 0) return;

  const selfAssigned = assigneeUserId === actorUserId;
  const verb = delegated ? 'delegated' : 'assigned';

  // A task is the durable work item — create/reassign one per materialized
  // count so it lands in the assignee's to-do list (and pushes to mobile via
  // the tasks_emit_event trigger). Always done, even on self-assignment.
  for (const c of counts) {
    await upsertCountTask(supabase, log, {
      tenantId,
      assigneeUserId,
      actorUserId,
      info: c,
    });
  }

  // In-app notification — works even when email isn't configured. Skipped on
  // self-assignment unless the caller opts in (e.g. creating your own count).
  if (!selfAssigned || alwaysNotify) {
    await insertNotification(supabase, log, {
      tenantId,
      userId: assigneeUserId,
      type: 'count_assigned',
      title: counts.length === 1
        ? `Cycle count ${verb} to you: ${counts[0].templateName}`
        : `${counts.length} cycle counts ${verb} to you`,
      body: counts.map(describeCount).join(' · '),
      link: counts.length === 1 && counts[0].cycleCountId
        ? `/inventory/cycle-counts/${counts[0].cycleCountId}`
        : '/inventory/count-schedule',
      // One notification per assignment of a given count, so retries/replays
      // don't stack duplicates in the feed.
      eventKey: counts.length === 1 && counts[0].cycleCountId
        ? `count_assigned_${counts[0].cycleCountId}_${assigneeUserId}`
        : undefined,
    });
  }

  // Never email someone about a count they assigned to themselves.
  if (selfAssigned || !isEmailConfigured()) return;

  try {
    const lookupIds = [...new Set([assigneeUserId, actorUserId].filter(Boolean))] as string[];
    const { data: users } = await supabase
      .from('local_users')
      .select('user_id, name, email')
      .eq('tenant_id', tenantId)
      .in('user_id', lookupIds)
      .limit(10);

    let assignee = (users || []).find((u: any) => u.user_id === assigneeUserId);
    if (!assignee?.email) {
      // HR-synced people can be qualified/assigned without an app account —
      // their id is hr_people.hr_person_id (or a profile_id with no local
      // user), so fall back to the HR roster for a mailable address.
      const { data: hrRows } = await supabase
        .from('hr_people')
        .select('hr_person_id, profile_id, first_name, last_name, preferred_name, work_email, personal_email')
        .eq('tenant_id', tenantId)
        .or(`hr_person_id.eq.${assigneeUserId},profile_id.eq.${assigneeUserId}`)
        .limit(1);
      const hr = hrRows?.[0];
      if (hr) {
        assignee = {
          user_id: assigneeUserId,
          name: hr.preferred_name || [hr.first_name, hr.last_name].filter(Boolean).join(' '),
          email: hr.work_email || hr.personal_email || null,
        };
      }
    }
    if (!assignee?.email) {
      log.warn('count_assignment_email.no_email', { assigneeUserId });
      return;
    }
    const actor = (users || []).find((u: any) => u.user_id === actorUserId);
    const actorName = actor?.name || actor?.email || 'A teammate';

    const subject = counts.length === 1
      ? `Cycle count ${verb} to you: ${counts[0].templateName}${counts[0].scheduledDate ? ` on ${formatDate(counts[0].scheduledDate)}` : ''}`
      : `${counts.length} cycle counts ${verb} to you`;

    const base = appBaseUrl();
    const scheduleLink = base ? `${base}/inventory/count-schedule` : null;
    const greetingName = assignee.name ? assignee.name.split(' ')[0] : 'there';

    const listHtml = counts
      .map(c => `<li style="margin:4px 0">${describeCount(c)}</li>`)
      .join('');
    const html = `
      <p>Hi ${greetingName},</p>
      <p>${actorName} ${verb} ${counts.length === 1 ? 'a cycle count' : `${counts.length} cycle counts`} to you:</p>
      <ul>${listHtml}</ul>
      ${scheduleLink ? `<p><a href="${scheduleLink}">Open the count schedule</a> to see the details and get started.</p>` : ''}
      <p style="color:#888;font-size:12px">Summit One Inventory</p>
    `;
    const text = [
      `Hi ${greetingName},`,
      `${actorName} ${verb} ${counts.length === 1 ? 'a cycle count' : `${counts.length} cycle counts`} to you:`,
      ...counts.map(c => `- ${describeCount(c)}`),
      scheduleLink ? `Open the count schedule: ${scheduleLink}` : '',
    ].filter(Boolean).join('\n');

    await sendEmail(fetchImpl, { to: assignee.email, subject, html, text });
    log.info('count_assignment_email.sent', { assigneeUserId, count: counts.length, delegated: !!delegated });
  } catch (err: any) {
    log.warn('count_assignment_email.failed', { assigneeUserId, error: err?.message });
  }
}

/** Throws AppError.badRequest if the user isn't an active qualified counter. */
export async function assertQualifiedCounter(
  supabase: any,
  tenantId: string,
  userId: string,
): Promise<void> {
  const { data } = await supabase
    .schema('inventory')
    .from('cycle_count_qualified_users')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle();
  if (!data) {
    throw AppError.badRequest('That person is not an active qualified counter. An admin can qualify them under Settings → Position Access.');
  }
}
