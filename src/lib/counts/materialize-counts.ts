/**
 * Nightly materializer: turns due cycle-count schedule entries into real
 * cycle counts.
 *
 * Finds every `planned` schedule entry (across all tenants) whose
 * scheduled_date is today or earlier, creates the count via
 * rpc_inv_cycle_count_start (the same call the manual "Create Cycle Count
 * Now" button makes) and emails each assignee a "ready to start" digest.
 *
 * Idempotent: materialized entries flip to 'generated' so reruns skip them,
 * and the RPC's last_event_id is derived from the entry id so a retry after
 * a partial failure can't create a duplicate count.
 *
 * Per-entry failures are isolated: one bad entry never aborts the rest.
 */
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { sendEmail, isEmailConfigured } from '@/lib/email/send';
import { insertNotification } from '@/lib/notifications';

type FetchLike = typeof fetch;
type Logger = { info: (msg: string, meta?: any) => void; warn: (msg: string, meta?: any) => void };

interface DueEntry {
  id: string;
  tenant_id: string;
  scheduled_date: string;
  assigned_to_user_id: string | null;
  template: {
    id: string;
    name: string;
    location_id: string;
    count_type: string;
    is_blind: boolean;
    catalog_item_ids: string[] | null;
    location?: { name: string } | null;
  } | null;
}

interface MaterializedCount {
  entryId: string;
  tenantId: string;
  cycleCountId: string;
  countNumber: string | null;
  templateName: string;
  locationName: string | null;
  scheduledDate: string;
  assigneeUserId: string | null;
}

export interface MaterializeSummary {
  runDate: string;
  entriesDue: number;
  countsCreated: number;
  emailsSent: number;
  emailsSkipped: number;
  errors: Array<{ entryId: string; error: string }>;
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as any).message);
  return String(err);
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SERVICE_BASE_URL || '').replace(/\/$/, '');
}

function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

async function sendReadyEmail(
  fetchImpl: FetchLike,
  admin: any,
  log: Logger,
  tenantId: string,
  assigneeUserId: string,
  counts: MaterializedCount[],
): Promise<boolean> {
  const { data: user } = await admin
    .from('local_users')
    .select('name, email')
    .eq('tenant_id', tenantId)
    .eq('user_id', assigneeUserId)
    .maybeSingle();
  if (!user?.email) {
    log.warn('materialize_counts.no_email', { assigneeUserId });
    return false;
  }

  const greetingName = user.name ? user.name.split(' ')[0] : 'there';
  const subject = counts.length === 1
    ? `Cycle count ready to start: ${counts[0].templateName}${counts[0].countNumber ? ` (${counts[0].countNumber})` : ''}`
    : `${counts.length} cycle counts ready to start`;

  const base = appBaseUrl();
  const link = base ? `${base}/inventory/cycle-counts` : null;
  const describe = (c: MaterializedCount) =>
    [c.templateName, c.locationName ? `at ${c.locationName}` : null, c.countNumber ? `- ${c.countNumber}` : null, `(scheduled ${formatDate(c.scheduledDate)})`]
      .filter(Boolean).join(' ');

  const html = `
    <p>Hi ${greetingName},</p>
    <p>${counts.length === 1 ? 'A cycle count assigned to you is' : `${counts.length} cycle counts assigned to you are`} ready to start:</p>
    <ul>${counts.map(c => `<li style="margin:4px 0">${describe(c)}</li>`).join('')}</ul>
    ${link ? `<p><a href="${link}">Open cycle counts</a> to begin.</p>` : ''}
    <p style="color:#888;font-size:12px">Summit One Inventory</p>
  `;
  const text = [
    `Hi ${greetingName},`,
    `${counts.length === 1 ? 'A cycle count assigned to you is' : `${counts.length} cycle counts assigned to you are`} ready to start:`,
    ...counts.map(c => `- ${describe(c)}`),
    link ? `Open cycle counts: ${link}` : '',
  ].filter(Boolean).join('\n');

  await sendEmail(fetchImpl, { to: user.email, subject, html, text });
  return true;
}

export async function materializeDueCounts(args: {
  fetchImpl: FetchLike;
  log: Logger;
  maxEntries?: number;
}): Promise<MaterializeSummary> {
  const { fetchImpl, log } = args;
  const maxEntries = args.maxEntries ?? 100;
  const admin = getAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const summary: MaterializeSummary = {
    runDate: today,
    entriesDue: 0,
    countsCreated: 0,
    emailsSent: 0,
    emailsSkipped: 0,
    errors: [],
  };

  const inv = (admin as any).schema('inventory');
  const { data: due, error: dueErr } = await inv
    .from('cycle_count_schedule')
    .select('id, tenant_id, scheduled_date, assigned_to_user_id, template:cycle_count_templates(id, name, location_id, count_type, is_blind, catalog_item_ids, location:locations(name))')
    .eq('status', 'planned')
    .lte('scheduled_date', today)
    .order('scheduled_date')
    .limit(maxEntries);

  if (dueErr) {
    throw AppError.internal(dueErr.message);
  }

  const entries = (due || []) as DueEntry[];
  summary.entriesDue = entries.length;
  if (entries.length === maxEntries) {
    log.warn('materialize_counts.batch_capped', { maxEntries });
  }

  const created: MaterializedCount[] = [];

  for (const entry of entries) {
    try {
      if (!entry.template) {
        throw AppError.internal('Schedule entry has no template');
      }

      // Deterministic per entry so a rerun after partial failure dedupes
      const lastEventId = `cron_count_${entry.id}`;

      // A 'partial' template scoped to "everything at the location" maps to a
      // full count — the RPC requires an item scope for partial.
      const effectiveType =
        entry.template.count_type === 'partial' && !entry.template.catalog_item_ids?.length
          ? 'full'
          : entry.template.count_type;

      const { data: countId, error: rpcErr } = await inv.rpc('rpc_inv_cycle_count_start', {
        p_tenant_id: entry.tenant_id,
        p_location_id: entry.template.location_id,
        p_count_type: effectiveType,
        p_catalog_item_ids: entry.template.catalog_item_ids || null,
        p_counted_by_user_id: entry.assigned_to_user_id,
        p_last_event_id: lastEventId,
      });
      if (rpcErr) throw AppError.internal(rpcErr.message);

      if (entry.template.is_blind) {
        await inv.from('cycle_counts').update({ is_blind: true }).eq('id', countId);
      }

      const { error: updErr } = await inv
        .from('cycle_count_schedule')
        .update({
          status: 'generated',
          cycle_count_id: countId,
          last_event_id: lastEventId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', entry.id)
        .eq('status', 'planned');
      if (updErr) throw AppError.internal(updErr.message);

      const { data: count } = await inv
        .from('cycle_counts')
        .select('count_number')
        .eq('id', countId)
        .maybeSingle();

      created.push({
        entryId: entry.id,
        tenantId: entry.tenant_id,
        cycleCountId: countId,
        countNumber: count?.count_number ?? null,
        templateName: entry.template.name,
        locationName: entry.template.location?.name ?? null,
        scheduledDate: entry.scheduled_date,
        assigneeUserId: entry.assigned_to_user_id,
      });
      summary.countsCreated++;
    } catch (err) {
      const error = errMessage(err);
      log.warn('materialize_counts.entry_failed', { entryId: entry.id, error });
      summary.errors.push({ entryId: entry.id, error });
    }
  }

  // One "ready to start" digest per tenant+assignee
  const byAssignee = new Map<string, MaterializedCount[]>();
  for (const c of created) {
    if (!c.assigneeUserId) {
      summary.emailsSkipped++;
      continue;
    }
    const key = `${c.tenantId}:${c.assigneeUserId}`;
    if (!byAssignee.has(key)) byAssignee.set(key, []);
    byAssignee.get(key)!.push(c);
  }

  for (const [key, counts] of byAssignee) {
    // In-app notification regardless of email configuration.
    for (const c of counts) {
      await insertNotification(admin, log, {
        tenantId: c.tenantId,
        userId: c.assigneeUserId,
        type: 'count_ready',
        title: `Count ready to start: ${c.templateName}`,
        body: `${c.locationName ? `At ${c.locationName}. ` : ''}${c.countNumber ? `Count ${c.countNumber}.` : ''}`,
        link: '/inventory/cycle-counts',
        eventKey: `count_ready_${c.entryId}`,
      });
    }
    if (!isEmailConfigured()) {
      summary.emailsSkipped++;
      continue;
    }
    try {
      const sent = await sendReadyEmail(fetchImpl, admin, log, counts[0].tenantId, counts[0].assigneeUserId!, counts);
      if (sent) summary.emailsSent++;
      else summary.emailsSkipped++;
    } catch (err) {
      log.warn('materialize_counts.email_failed', { key, error: errMessage(err) });
      summary.emailsSkipped++;
    }
  }

  return summary;
}
