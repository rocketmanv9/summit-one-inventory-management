/**
 * Turn cycle-count *suggestions* into real, assigned cycle counts.
 *
 * The suggestions RPC (`inventory.get_cycle_count_suggestions`) is advisory —
 * item×location rows ranked by priority. This module makes the top ones happen:
 * it groups the suggestions by location and creates ONE partial cycle count per
 * location covering that location's suggested items, assigns it round-robin
 * across the tenant's qualified counters, schedules it for tomorrow, and emails
 * the assignee. Each count is a normal count — cancellable like any other.
 *
 * Two entry points share this core:
 *   - `autoScheduleCountsForTenant` — one tenant (on-demand "Schedule these"
 *     from the widget, or a single cron iteration).
 *   - `autoScheduleCountsForAllTenants` — the nightly cron, restricted to
 *     tenants that opted in via `tenant_settings.auto_schedule_counts_enabled`.
 *
 * Idempotency: each per-location count uses
 * `last_event_id = auto-count-{YYYYMMDD}-{location_id}`. `rpc_inv_cycle_count_start`
 * dedupes on `(tenant_id, last_event_id)`, so a same-day rerun is a no-op and
 * returns the already-created count. Items already on an open count are skipped
 * before grouping, so we never double-count a location's active items.
 */
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { notifyCountAssignment, type AssignedCountInfo } from '@/lib/counts/assignment-email';

type FetchLike = typeof fetch;
type Logger = {
  info: (msg: string, meta?: any) => void;
  warn: (msg: string, meta?: any) => void;
  error?: (msg: string, meta?: any) => void;
};

/** A single item×location suggestion row from get_cycle_count_suggestions. */
interface SuggestionRow {
  catalog_item_id: string;
  item_name: string;
  location_id: string;
  location_name: string;
  priority_score: number;
}

export interface AutoScheduledCount {
  cycleCountId: string;
  countNumber: string | null;
  locationId: string;
  locationName: string;
  itemCount: number;
  itemIds: string[];
  assigneeUserId: string | null;
  scheduledFor: string;
  /** True when this location's count already existed (idempotent replay). */
  reused: boolean;
}

export interface AutoScheduleTenantResult {
  tenantId: string;
  runId: string;
  suggestionRows: number;
  locationsConsidered: number;
  locationsCapped: number;
  created: AutoScheduledCount[];
  createdCount: number;
  reusedCount: number;
  /** Locations skipped because today's auto count for them was already cancelled/closed. */
  skippedTerminal: number;
  assignedCount: number;
  unassignedCount: number;
  qualifiedCounters: number;
  errors: Array<{ locationId: string; error: string }>;
}

export interface AutoScheduleAllResult {
  runId: string;
  tenantsProcessed: number;
  tenantsSkippedDisabled: number;
  countsCreated: number;
  countsReused: number;
  errors: Array<{ tenantId: string; error: string }>;
  tenants: AutoScheduleTenantResult[];
}

const DEFAULT_MAX_LOCATIONS_PER_RUN = 3;
const DEFAULT_SUGGESTION_LIMIT = 40;

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as any).message);
  return String(err);
}

/** Today's run id, e.g. "20260806" (UTC — matches the auto-reorder convention). */
function todayRunId(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

/** The marker written to cycle_counts.notes so the origin (and run) is clear. */
function autoNoteFor(runId: string): string {
  return `Auto-scheduled from cycle-count suggestions (run ${runId}).`;
}

/** Tomorrow's date (UTC) as YYYY-MM-DD — when the auto-scheduled count is due. */
function tomorrowDateStr(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Auto-schedule cycle counts for a single tenant from its live suggestions.
 *
 * `adminClient` is a service-role client (RLS-bypassing) — the caller owns its
 * lifecycle so the cron can reuse one client across tenants.
 */
export async function autoScheduleCountsForTenant(args: {
  adminClient: any;
  fetchImpl: FetchLike;
  log: Logger;
  tenantId: string;
  actorUserId?: string | null;
  /** Cap on how many locations get a count this run (default 3). */
  maxLocations?: number;
  /** How many suggestion rows to pull before grouping (default 40). */
  suggestionLimit?: number;
  /**
   * Restrict to these locations (on-demand "Schedule these" passes the exact
   * locations visible in the widget). Omit to consider all suggested locations.
   */
  onlyLocationIds?: string[];
}): Promise<AutoScheduleTenantResult> {
  const {
    adminClient: admin,
    fetchImpl,
    log,
    tenantId,
    actorUserId,
    maxLocations = DEFAULT_MAX_LOCATIONS_PER_RUN,
    suggestionLimit = DEFAULT_SUGGESTION_LIMIT,
    onlyLocationIds,
  } = args;

  const runId = todayRunId();
  const scheduledFor = tomorrowDateStr();
  const inv = (admin as any).schema('inventory');

  const result: AutoScheduleTenantResult = {
    tenantId,
    runId,
    suggestionRows: 0,
    locationsConsidered: 0,
    locationsCapped: 0,
    created: [],
    createdCount: 0,
    reusedCount: 0,
    skippedTerminal: 0,
    assignedCount: 0,
    unassignedCount: 0,
    qualifiedCounters: 0,
    errors: [],
  };

  // 1. Pull the tenant's live suggestions (item×location rows, priority-ranked).
  const { data: rawSuggestions, error: sugErr } = await inv.rpc('get_cycle_count_suggestions', {
    p_tenant_id: tenantId,
    p_limit: suggestionLimit,
  });
  if (sugErr) throw AppError.internal(`suggestions RPC failed: ${sugErr.message}`);

  let suggestions = (rawSuggestions || []) as SuggestionRow[];
  if (onlyLocationIds && onlyLocationIds.length > 0) {
    const allow = new Set(onlyLocationIds);
    suggestions = suggestions.filter((s) => allow.has(s.location_id));
  }
  result.suggestionRows = suggestions.length;
  if (suggestions.length === 0) return result;

  // 2. Drop items already on an OPEN count (draft/scheduled/in_progress/under_review)
  //    so we never spawn a duplicate count for something already being counted.
  const { data: openCounts, error: openErr } = await inv
    .from('cycle_counts')
    .select('id, location_id, cycle_count_lines(catalog_item_id)')
    .eq('tenant_id', tenantId)
    .in('status', ['draft', 'scheduled', 'in_progress', 'under_review'])
    .limit(500);
  if (openErr) throw AppError.internal(`open-count lookup failed: ${openErr.message}`);

  // Set of "locationId::itemId" pairs already under an open count.
  const openPairs = new Set<string>();
  for (const c of (openCounts || []) as any[]) {
    const lines = Array.isArray(c.cycle_count_lines) ? c.cycle_count_lines : [];
    for (const ln of lines) {
      if (ln?.catalog_item_id) openPairs.add(`${c.location_id}::${ln.catalog_item_id}`);
    }
  }

  // 3. Group remaining suggestions by location, keeping the location's best
  //    priority for ordering. Insertion order preserves the RPC's ranking.
  const byLocation = new Map<string, {
    locationId: string;
    locationName: string;
    itemIds: string[];
    topPriority: number;
  }>();
  for (const s of suggestions) {
    if (!s.catalog_item_id || !s.location_id) continue;
    if (openPairs.has(`${s.location_id}::${s.catalog_item_id}`)) continue;
    let g = byLocation.get(s.location_id);
    if (!g) {
      g = { locationId: s.location_id, locationName: s.location_name, itemIds: [], topPriority: 0 };
      byLocation.set(s.location_id, g);
    }
    if (!g.itemIds.includes(s.catalog_item_id)) g.itemIds.push(s.catalog_item_id);
    if (s.priority_score > g.topPriority) g.topPriority = s.priority_score;
  }

  // Highest-priority locations first, then apply the per-run cap.
  const groups = [...byLocation.values()].sort((a, b) => b.topPriority - a.topPriority);
  result.locationsConsidered = groups.length;
  const capped = groups.slice(0, maxLocations);
  result.locationsCapped = groups.length - capped.length;
  if (capped.length === 0) return result;

  // 4. Qualified counters for round-robin assignment (same source the create
  //    route's `assertQualifiedCounter` gate uses).
  const { data: qualified, error: qErr } = await inv
    .from('cycle_count_qualified_users')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .limit(200);
  if (qErr) throw AppError.internal(`qualified-counter lookup failed: ${qErr.message}`);
  const counterIds = [...new Set(((qualified || []) as any[]).map((q) => q.user_id).filter(Boolean))];
  result.qualifiedCounters = counterIds.length;

  // 5. Create one partial count per location; assign round-robin; schedule for
  //    tomorrow; mark it as auto-scheduled in notes.
  const createdForNotify: AutoScheduledCount[] = [];
  for (let i = 0; i < capped.length; i++) {
    const g = capped[i];
    const assignee = counterIds.length > 0 ? counterIds[i % counterIds.length] : null;
    const lastEventId = `auto-count-${runId}-${g.locationId}`;
    try {
      const { data: countId, error: rpcErr } = await inv.rpc('rpc_inv_cycle_count_start', {
        p_tenant_id: tenantId,
        p_location_id: g.locationId,
        p_count_type: 'partial',
        p_catalog_item_ids: g.itemIds,
        p_counted_by_user_id: assignee,
        p_last_event_id: lastEventId,
      });
      if (rpcErr) throw AppError.internal(rpcErr.message);
      if (!countId) throw AppError.internal('RPC returned no count id');

      // Fresh insert or idempotent replay? The RPC dedupes on
      // (tenant_id, last_event_id): a fresh insert lands as status 'in_progress'
      // with no notes; a replay returns the pre-existing row (any status).
      const { data: existingCount } = await inv
        .from('cycle_counts')
        .select('count_number, scheduled_for, status, notes, counted_by_user_id')
        .eq('id', countId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      const carriesAutoNote = Boolean(
        existingCount?.notes && existingCount.notes.includes('Auto-scheduled from cycle-count suggestions'),
      );
      const existingStatus = existingCount?.status as string | undefined;

      // A replay that resolves to an already-cancelled (or otherwise terminal)
      // count: this location was auto-scheduled earlier today and then
      // cancelled. The last_event_id is spent for today, so we can't re-create
      // it until tomorrow's run mints a new key — skip it cleanly rather than
      // linking to a dead count.
      if (carriesAutoNote && existingStatus && ['cancelled', 'closed', 'posted'].includes(existingStatus)) {
        result.skippedTerminal++;
        continue;
      }

      const reused = carriesAutoNote;

      // Set the schedule date + auto marker. rpc_inv_cycle_count_start defaults
      // scheduled_for to today and status in_progress; we push it to tomorrow so
      // it reads as a planned assignment, and tag it so the origin is clear.
      // Only patch on first creation — never stomp a count someone already
      // started or edited on replay.
      if (!reused) {
        await inv
          .from('cycle_counts')
          .update({
            scheduled_for: scheduledFor,
            status: 'scheduled',
            notes: autoNoteFor(runId),
            updated_at: new Date().toISOString(),
          })
          .eq('id', countId)
          .eq('tenant_id', tenantId)
          .eq('status', 'in_progress'); // guard: don't touch a count already progressed
      }

      const record: AutoScheduledCount = {
        cycleCountId: countId,
        countNumber: existingCount?.count_number ?? null,
        locationId: g.locationId,
        locationName: g.locationName,
        itemCount: g.itemIds.length,
        itemIds: g.itemIds,
        assigneeUserId: existingCount?.counted_by_user_id ?? assignee,
        scheduledFor,
        reused,
      };
      result.created.push(record);
      createdForNotify.push(record);
      if (reused) result.reusedCount++;
      else result.createdCount++;
      if (record.assigneeUserId) result.assignedCount++;
      else result.unassignedCount++;
    } catch (err) {
      const error = errMessage(err);
      log.warn('auto_schedule_counts.location_failed', { tenantId, locationId: g.locationId, error });
      result.errors.push({ locationId: g.locationId, error });
    }
  }

  // 6. Notify assignees — one call per assignee, mirroring the create route.
  //    Best-effort: emails/tasks/notifications must never fail the scheduling.
  //    Skip on idempotent replays (the assignee was already notified).
  const freshByAssignee = new Map<string, AssignedCountInfo[]>();
  for (const c of createdForNotify) {
    if (c.reused || !c.assigneeUserId) continue;
    if (!freshByAssignee.has(c.assigneeUserId)) freshByAssignee.set(c.assigneeUserId, []);
    freshByAssignee.get(c.assigneeUserId)!.push({
      templateName: c.countNumber ? `Count ${c.countNumber}` : 'Cycle count',
      locationName: c.locationName,
      scheduledDate: c.scheduledFor,
      countType: 'partial',
      countNumber: c.countNumber,
      cycleCountId: c.cycleCountId,
    });
  }
  for (const [assigneeUserId, counts] of freshByAssignee) {
    try {
      await notifyCountAssignment({
        fetchImpl,
        supabase: admin,
        log,
        tenantId,
        assigneeUserId,
        actorUserId: actorUserId ?? null,
        counts,
      });
    } catch (err) {
      log.warn('auto_schedule_counts.notify_failed', { tenantId, assigneeUserId, error: errMessage(err) });
    }
  }

  log.info('auto_schedule_counts.tenant_done', {
    tenantId,
    runId,
    created: result.createdCount,
    reused: result.reusedCount,
    assigned: result.assignedCount,
    unassigned: result.unassignedCount,
  });

  return result;
}

/**
 * Nightly cron entry point: run the auto-scheduler for every tenant that opted
 * in via `tenant_settings.auto_schedule_counts_enabled`. Per-tenant failures
 * are isolated so one bad tenant never aborts the rest.
 */
export async function autoScheduleCountsForAllTenants(args: {
  fetchImpl: FetchLike;
  log: Logger;
  maxTenants?: number;
  maxLocations?: number;
}): Promise<AutoScheduleAllResult> {
  const { fetchImpl, log } = args;
  const admin = getAdminClient();
  const runId = todayRunId();

  const summary: AutoScheduleAllResult = {
    runId,
    tenantsProcessed: 0,
    tenantsSkippedDisabled: 0,
    countsCreated: 0,
    countsReused: 0,
    errors: [],
    tenants: [],
  };

  const { data: settingsRows, error: settingsErr } = await admin
    .schema('supply_chain')
    .from('tenant_settings')
    .select('tenant_id, auto_schedule_counts_enabled')
    .order('created_at', { ascending: true })
    .limit(1000);
  if (settingsErr) throw AppError.internal(`Failed to enumerate tenants: ${settingsErr.message}`);

  const enabledTenantIds: string[] = [];
  for (const row of (settingsRows || []) as any[]) {
    if (row.auto_schedule_counts_enabled) enabledTenantIds.push(row.tenant_id);
    else summary.tenantsSkippedDisabled++;
  }

  const tenantIds = [...new Set(enabledTenantIds)].slice(0, args.maxTenants ?? 15);

  for (const tenantId of tenantIds) {
    try {
      const res = await autoScheduleCountsForTenant({
        adminClient: admin,
        fetchImpl,
        log,
        tenantId,
        actorUserId: null,
        maxLocations: args.maxLocations,
      });
      summary.tenants.push(res);
      summary.countsCreated += res.createdCount;
      summary.countsReused += res.reusedCount;
      summary.tenantsProcessed++;
    } catch (err) {
      const error = errMessage(err);
      log.warn('auto_schedule_counts.tenant_failed', { tenantId, error });
      summary.errors.push({ tenantId, error });
    }
  }

  return summary;
}
