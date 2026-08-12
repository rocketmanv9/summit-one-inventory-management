/**
 * Proactive agent-suggestions loop.
 *
 * For every tenant, Isabelle scans the books once a day and surfaces what needs
 * attention into the in-app notification feed (the top-nav bell):
 *   1. Reorder needs  — items at/below their reorder point (v_reorder_suggestions).
 *   2. Usage anomalies — items whose recent monthly consumption spiked vs their
 *      own baseline, or that are projected to run out within ~a month.
 *
 * The tenant's `reorder_mode` setting decides how far it goes on reorders:
 *   notify     → only notify; a human (or Isabelle on request) creates the PO.
 *   auto_draft → also create draft POs (idempotent per day) and say so.
 *   auto_send  → same as auto_draft for now; real vendor transmission is a
 *                follow-up, so we create drafts and flag them to review/send.
 *
 * Per-tenant failures are isolated — one bad tenant never aborts the rest.
 */
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { insertNotification } from '@/lib/notifications';

type FetchLike = typeof fetch;
type Log = { info: (msg: string, meta?: any) => void; warn: (msg: string, meta?: any) => void };

export interface AgentSuggestionsTenantResult {
  tenantId: string;
  reorderMode: string;
  reorderItems: number;
  usageAlerts: number;
  notified: boolean;
  error?: string;
}

export interface AgentSuggestionsSummary {
  runId: string;
  tenantsProcessed: number;
  reorderItems: number;
  usageAlerts: number;
  errors: Array<{ tenantId: string; error: string }>;
  tenants: AgentSuggestionsTenantResult[];
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as any).message);
  return String(err);
}

/** Today's run id, e.g. "20260615" (UTC) — also the reorder RPC's run key. */
function todayRunId(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

const num = (v: any): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

interface UsageAlert {
  name: string;
  kind: 'spike' | 'stockout';
  detail: string;
}

/**
 * Detect usage anomalies from the monthly-usage RPC. Compares the last COMPLETED
 * month against the item's prior 3-month baseline (spike), and flags items with
 * less than ~one month of stock left at the recent run rate (stockout).
 */
function detectUsageAnomalies(rows: any[], currentMonthIso: string): UsageAlert[] {
  type SeriesPoint = { month: string; usage: number; onHand: number };
  const byItem = new Map<string, { name: string; series: SeriesPoint[] }>();
  for (const r of rows) {
    const it = byItem.get(r.catalog_item_id) || { name: r.name as string, series: [] as SeriesPoint[] };
    it.series.push({ month: String(r.month), usage: num(r.usage_qty), onHand: num(r.end_on_hand) });
    byItem.set(r.catalog_item_id, it);
  }

  const alerts: UsageAlert[] = [];
  for (const it of byItem.values()) {
    // Chronological, excluding the current (incomplete) month.
    const completed = it.series
      .filter((s) => s.month < currentMonthIso)
      .sort((a, b) => a.month.localeCompare(b.month));
    if (completed.length < 2) continue;

    const last = completed[completed.length - 1];
    const prior = completed.slice(Math.max(0, completed.length - 4), completed.length - 1);
    const baseline = prior.length ? prior.reduce((s, p) => s + p.usage, 0) / prior.length : 0;

    // Spike: meaningfully above the item's own baseline.
    if (last.usage >= 5 && baseline > 0 && last.usage >= baseline * 2) {
      const pct = Math.round(((last.usage - baseline) / baseline) * 100);
      alerts.push({
        name: it.name,
        kind: 'spike',
        detail: `${it.name}: usage up ${pct}% last month (${Math.round(last.usage)} vs ~${Math.round(baseline)} avg)`,
      });
      continue;
    }

    // Projected stockout: less than ~a month of cover at the recent rate.
    const recent = completed.slice(-3);
    const avgRate = recent.reduce((s, p) => s + p.usage, 0) / recent.length;
    const onHand = last.onHand;
    if (avgRate > 0 && onHand > 0 && onHand < avgRate) {
      alerts.push({
        name: it.name,
        kind: 'stockout',
        detail: `${it.name}: ~${Math.round(onHand)} on hand vs ~${Math.round(avgRate)}/mo used — under a month left`,
      });
    }
  }
  return alerts;
}

async function processTenant(
  admin: any,
  tenantId: string,
  reorderMode: string,
  runId: string,
  currentMonthIso: string,
  log: Log,
): Promise<AgentSuggestionsTenantResult> {
  const result: AgentSuggestionsTenantResult = {
    tenantId,
    reorderMode,
    reorderItems: 0,
    usageAlerts: 0,
    notified: false,
  };

  const inv = admin.schema('inventory');

  // 1. Reorder needs (distinct items at/below reorder point).
  const { data: reorderRows, error: reorderErr } = await inv
    .from('v_reorder_suggestions')
    .select('catalog_item_id, name, suggested_order_qty, qty_on_hand, reorder_point, preferred_vendor_name, estimated_unit_cost')
    .eq('tenant_id', tenantId)
    .gt('suggested_order_qty', 0)
    .limit(500);
  if (reorderErr) throw AppError.internal(`reorder query: ${reorderErr.message}`);

  const reorderByItem = new Map<string, { name: string; qty: number }>();
  for (const r of reorderRows || []) {
    const cur = reorderByItem.get(r.catalog_item_id) || { name: r.name, qty: 0 };
    cur.qty += num(r.suggested_order_qty);
    reorderByItem.set(r.catalog_item_id, cur);
  }
  result.reorderItems = reorderByItem.size;

  // 2. Usage anomalies from the monthly-usage RPC.
  let usageAlerts: UsageAlert[] = [];
  const { data: usageRows, error: usageErr } = await inv.rpc('rpc_report_monthly_usage', {
    p_tenant_id: tenantId,
    p_months: 6,
  });
  if (usageErr) {
    log.warn('agent_suggestions.usage_query_failed', { tenantId, error: usageErr.message });
  } else {
    usageAlerts = detectUsageAnomalies(usageRows || [], currentMonthIso);
  }
  result.usageAlerts = usageAlerts.length;

  // 3. Notify reorder needs (idempotent per tenant per day). PO creation itself
  // lives in the auto-reorder cron (which honours the same reorder_mode); here
  // we surface the need in-app and tailor the wording to the mode.
  if (result.reorderItems > 0) {
    const top = [...reorderByItem.values()]
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 4)
      .map((i) => `${i.name} (${Math.round(i.qty)})`)
      .join(', ');
    const more = result.reorderItems > 4 ? `, +${result.reorderItems - 4} more` : '';
    const modeLine =
      reorderMode === 'notify'
        ? ' Create a PO when you are ready.'
        : ' Draft POs are generated automatically — review & send in Purchasing.';
    await insertNotification(admin, log, {
      tenantId,
      type: 'reorder_suggestion',
      title: `${result.reorderItems} item${result.reorderItems === 1 ? '' : 's'} need reordering`,
      body: `At or below reorder point: ${top}${more}.${modeLine}`,
      link: reorderMode === 'notify' ? '/inventory/stock' : '/inventory/purchasing',
      eventKey: `agent_reorder_${tenantId}_${runId}`,
    });
    result.notified = true;
  }

  if (usageAlerts.length > 0) {
    const spikes = usageAlerts.filter((a) => a.kind === 'spike').length;
    const stockouts = usageAlerts.filter((a) => a.kind === 'stockout').length;
    const parts: string[] = [];
    if (spikes) parts.push(`${spikes} usage spike${spikes === 1 ? '' : 's'}`);
    if (stockouts) parts.push(`${stockouts} projected to run out`);
    await insertNotification(admin, log, {
      tenantId,
      type: 'usage_alert',
      title: `Unusual material usage: ${parts.join(', ')}`,
      body: usageAlerts.slice(0, 4).map((a) => a.detail).join(' · '),
      link: '/inventory/stock',
      eventKey: `agent_usage_${tenantId}_${runId}`,
    });
    result.notified = true;
  }

  return result;
}

export async function runAgentSuggestionsForAllTenants(args: {
  fetchImpl?: FetchLike;
  maxTenants?: number;
  log: Log;
}): Promise<AgentSuggestionsSummary> {
  const admin = getAdminClient();
  const runId = todayRunId();
  const currentMonthIso = `${new Date().toISOString().slice(0, 7)}-01`; // first of current month
  const log = args.log;

  const { data: settingsRows, error: settingsError } = await admin
    .schema('supply_chain')
    .from('tenant_settings')
    .select('tenant_id, reorder_mode')
    .order('created_at', { ascending: true })
    .limit(1000);
  if (settingsError) {
    throw AppError.internal(`Failed to enumerate tenants: ${settingsError.message}`);
  }

  const tenants = (settingsRows || []).slice(0, args.maxTenants ?? 25);

  const summary: AgentSuggestionsSummary = {
    runId,
    tenantsProcessed: 0,
    reorderItems: 0,
    usageAlerts: 0,
    errors: [],
    tenants: [],
  };

  for (const row of tenants) {
    const tenantId = row.tenant_id as string;
    const reorderMode = (row.reorder_mode as string) || 'auto_draft';
    try {
      const r = await processTenant(admin, tenantId, reorderMode, runId, currentMonthIso, log);
      summary.tenantsProcessed += 1;
      summary.reorderItems += r.reorderItems;
      summary.usageAlerts += r.usageAlerts;
      summary.tenants.push(r);
    } catch (err) {
      const error = errMessage(err);
      summary.errors.push({ tenantId, error });
      summary.tenants.push({
        tenantId,
        reorderMode,
        reorderItems: 0,
        usageAlerts: 0,
        notified: false,
        error,
      });
      log.warn('agent_suggestions.tenant_failed', { tenantId, error });
    }
  }

  return summary;
}
