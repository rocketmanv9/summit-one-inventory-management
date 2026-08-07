/**
 * Assignment notifications for stock transfers — the transfer analogue of
 * src/lib/counts/assignment-email.ts.
 *
 * A transfer can be assigned to one or more people. Each assignee gets:
 *   - a durable task in public.tasks (task_type 'transfer', one row per assignee
 *     keyed `transfer_<transferId>_<userId>` in last_event_id) so the work lands
 *     on their My Day card and pushes to mobile via the tasks_emit_event trigger,
 *   - an in-app notification,
 *   - a best-effort email (skipped on self-assignment / when Resend isn't set up).
 *
 * Called from `afterCommit` in the assign route, so a mail/notification failure
 * never fails the mutation. Unlike counts there is NO qualification gate — anyone
 * on the tenant roster can be handed a transfer.
 */
import { sendEmail, isEmailConfigured } from '@/lib/email/send';
import { insertNotification } from '@/lib/notifications';

type FetchLike = typeof fetch;

export interface AssignedTransferInfo {
  transferId: string;
  transferNumber?: string | null;
  fromLocationName?: string | null;
  toLocationName?: string | null;
  /** One-line summary of what's moving, e.g. "3 × Fuel Can". */
  itemsSummary?: string | null;
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SERVICE_BASE_URL || '').replace(/\/$/, '');
}

function describeTransfer(t: AssignedTransferInfo): string {
  const parts: string[] = [];
  if (t.itemsSummary) parts.push(t.itemsSummary);
  const route = [t.fromLocationName, t.toLocationName].filter(Boolean).join(' → ');
  if (route) parts.push(route);
  if (t.transferNumber) parts.push(t.transferNumber);
  return parts.join(' · ') || (t.transferNumber ?? 'Stock transfer');
}

/**
 * Create (or reassign/reopen) the task that represents "go move this stock" for
 * one assignee. Keyed `transfer_<transferId>_<userId>` so it's idempotent per
 * assignee — the first assignment inserts (-> task.created), a replay is a
 * no-op, and if the same transfer/user pair had been completed it reopens.
 * Best-effort: a task failure must never fail the assign mutation.
 */
async function upsertTransferTask(
  supabase: any,
  log: { warn: (msg: string, meta?: any) => void },
  opts: {
    tenantId: string;
    assigneeUserId: string;
    actorUserId?: string | null;
    info: AssignedTransferInfo;
  },
): Promise<void> {
  const { tenantId, assigneeUserId, actorUserId, info } = opts;
  const eventKey = `transfer_${info.transferId}_${assigneeUserId}`;
  const title = `Transfer stock${info.transferNumber ? `: ${info.transferNumber}` : ''}`;
  const description = describeTransfer(info);
  const link = `/inventory/transfers?highlight=${info.transferId}`;

  try {
    const { data: existing } = await supabase
      .from('tasks')
      .select('id, status')
      .eq('tenant_id', tenantId)
      .eq('last_event_id', eventKey)
      .maybeSingle();

    if (existing) {
      const reopen = existing.status === 'done' || existing.status === 'cancelled';
      if (!reopen) return; // already open for this assignee — nothing to do
      const { error } = await supabase
        .from('tasks')
        .update({
          status: 'open',
          title,
          description,
          link,
          completed_at: null,
          completed_by_user_id: null,
        })
        .eq('id', existing.id)
        .eq('tenant_id', tenantId);
      if (error) log.warn('transfer_task.reopen_failed', { transferId: info.transferId, error: error.message });
      return;
    }

    const { error } = await supabase
      .from('tasks')
      .upsert({
        tenant_id: tenantId,
        assigned_to_user_id: assigneeUserId,
        created_by_user_id: actorUserId ?? null,
        task_type: 'transfer',
        title,
        description,
        status: 'open',
        priority: 'normal',
        related_entity_type: 'transfer',
        related_entity_id: info.transferId,
        link,
        last_event_id: eventKey,
      }, { onConflict: 'tenant_id,last_event_id', ignoreDuplicates: true });
    if (error) log.warn('transfer_task.insert_failed', { transferId: info.transferId, error: error.message });
  } catch (err: any) {
    log.warn('transfer_task.failed', { transferId: info.transferId, error: err?.message });
  }
}

/**
 * Assign a transfer to a set of users: one task + notification (+ email) each.
 * Idempotent per (transfer, user). Best-effort throughout.
 */
export async function notifyTransferAssignment(opts: {
  fetchImpl: FetchLike;
  supabase: any;
  log: { info: (msg: string, meta?: any) => void; warn: (msg: string, meta?: any) => void };
  tenantId: string;
  assigneeUserIds: string[];
  actorUserId?: string | null;
  info: AssignedTransferInfo;
}): Promise<void> {
  const { fetchImpl, supabase, log, tenantId, assigneeUserIds, actorUserId, info } = opts;
  if (assigneeUserIds.length === 0) return;

  for (const assigneeUserId of assigneeUserIds) {
    await upsertTransferTask(supabase, log, { tenantId, assigneeUserId, actorUserId, info });

    const selfAssigned = assigneeUserId === actorUserId;
    if (!selfAssigned) {
      await insertNotification(supabase, log, {
        tenantId,
        userId: assigneeUserId,
        type: 'transfer_assigned',
        title: `Transfer assigned to you${info.transferNumber ? `: ${info.transferNumber}` : ''}`,
        body: describeTransfer(info),
        link: `/inventory/transfers?highlight=${info.transferId}`,
        eventKey: `transfer_assigned_${info.transferId}_${assigneeUserId}`,
      });
    }
  }

  if (!isEmailConfigured()) return;

  // Email each non-self assignee (best-effort, one lookup for the batch).
  const mailIds = [...new Set(assigneeUserIds.filter((id) => id !== actorUserId))];
  if (mailIds.length === 0) return;

  try {
    const lookupIds = [...new Set([...mailIds, actorUserId].filter(Boolean))] as string[];
    const { data: users } = await supabase
      .from('local_users')
      .select('user_id, name, email')
      .eq('tenant_id', tenantId)
      .in('user_id', lookupIds)
      .limit(50);
    const actor = (users || []).find((u: any) => u.user_id === actorUserId);
    const actorName = actor?.name || actor?.email || 'A teammate';

    const base = appBaseUrl();
    const link = base ? `${base}/inventory/transfers?highlight=${info.transferId}` : null;

    for (const assigneeUserId of mailIds) {
      let assignee = (users || []).find((u: any) => u.user_id === assigneeUserId);
      if (!assignee?.email) {
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
        log.warn('transfer_assignment_email.no_email', { assigneeUserId });
        continue;
      }
      const greetingName = assignee.name ? String(assignee.name).split(' ')[0] : 'there';
      const subject = `Transfer assigned to you${info.transferNumber ? `: ${info.transferNumber}` : ''}`;
      const html = `
        <p>Hi ${greetingName},</p>
        <p>${actorName} assigned a stock transfer to you:</p>
        <ul><li style="margin:4px 0">${describeTransfer(info)}</li></ul>
        ${link ? `<p><a href="${link}">Open the transfer</a> to ship and receive the stock.</p>` : ''}
        <p style="color:#888;font-size:12px">Summit One Inventory</p>
      `;
      const text = [
        `Hi ${greetingName},`,
        `${actorName} assigned a stock transfer to you:`,
        `- ${describeTransfer(info)}`,
        link ? `Open the transfer: ${link}` : '',
      ].filter(Boolean).join('\n');
      await sendEmail(fetchImpl, { to: assignee.email, subject, html, text });
      log.info('transfer_assignment_email.sent', { assigneeUserId });
    }
  } catch (err: any) {
    log.warn('transfer_assignment_email.failed', { error: err?.message });
  }
}
