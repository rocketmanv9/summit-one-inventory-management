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
}): Promise<void> {
  const { fetchImpl, supabase, log, tenantId, assigneeUserId, actorUserId, counts, delegated } = opts;

  if (counts.length === 0 || assigneeUserId === actorUserId) return;

  // In-app notification first — it works even when email isn't configured.
  const verb = delegated ? 'delegated' : 'assigned';
  await insertNotification(supabase, log, {
    tenantId,
    userId: assigneeUserId,
    type: 'count_assigned',
    title: counts.length === 1
      ? `Cycle count ${verb} to you: ${counts[0].templateName}`
      : `${counts.length} cycle counts ${verb} to you`,
    body: counts.map(describeCount).join(' · '),
    link: '/inventory/count-schedule',
  });

  if (!isEmailConfigured()) return;

  try {
    const lookupIds = [...new Set([assigneeUserId, actorUserId].filter(Boolean))] as string[];
    const { data: users } = await supabase
      .from('local_users')
      .select('user_id, name, email')
      .eq('tenant_id', tenantId)
      .in('user_id', lookupIds)
      .limit(10);

    const assignee = (users || []).find((u: any) => u.user_id === assigneeUserId);
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
    throw AppError.badRequest('That person is not an active qualified counter. An admin can qualify them under Settings → Count Qualifications.');
  }
}
