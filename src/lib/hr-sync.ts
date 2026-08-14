/**
 * HR → inventory mirror sync, shared by POST /api/hr/sync (admin button) and
 * GET /api/system/cron/hr-sync (scheduled).
 *
 * Beyond mirroring positions + people, this HEALS the mirrors — the failure
 * class found 2026-08-11: an HR reseed/dedupe mints NEW ids for the same
 * humans/positions, leaving old mirror rows behind. Inventory gates buying by
 * position TITLE resolved through this mirror (src/lib/purchase-links.ts), and
 * a duplicate-email roster makes that resolution a coin flip between the real
 * row and a positionless orphan. Every sync deactivates mirror rows whose HR
 * source id is gone.
 *
 * Healing is guarded by non-empty HR reads (the fetches throw on failure), so
 * a broken HR connection can never mass-deactivate anything.
 */
import { AppError } from '@rocketmanv9/chassis/errors';
import {
  fetchHRPositions,
  fetchHRRoleLevels,
  fetchHRPeople,
  fetchHRLocationNames,
  fetchHRSupervisors,
  indexPeopleByEmail,
  hrPersonToMirrorRow,
} from '@/lib/hr';
import { provisionNewHires } from '@/lib/position-kits';

type Logger = { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, meta?: Record<string, unknown>) => void };

export interface HRSyncSummary {
  configured: true;
  positionsSynced: number;
  peopleMirrored: number;
  usersMatched: number;
  stalePositionsDeactivated: number;
  stalePeopleDeactivated: number;
  /** "Pending Sync" stubs resolved to a real identity via hr_people.profile_id. */
  pendingHealed: number;
  /** Stubs still unresolved after the reconcile (surfaced as "Unlinked account" in the UI). */
  pendingRemaining: number;
  /** New hires the kit sync-diff picked up (item 04): never-seen + stuck retries. */
  kitCandidates: number;
  /** Of those, how many got reservations/POs on this run. */
  kitsProvisioned: number;
  /** Of those, how many were earlier failures being re-attempted (self-healing). */
  kitsRetried: number;
}

export async function runHRSync(
  supabase: any,
  tenantId: string,
  log: Logger,
): Promise<HRSyncSummary> {
  // Resolve the HR-side tenant id (defaults to identity — same uuid as the app tenant).
  const { data: settings } = await supabase
    .schema('supply_chain')
    .from('tenant_settings')
    .select('hr_tenant_id')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const hrTenantId: string = settings?.hr_tenant_id || tenantId;

  let hrPositions, roleLevels, hrPeople, hrLocationNames, hrSupervisors;
  try {
    [hrPositions, roleLevels, hrPeople, hrLocationNames, hrSupervisors] = await Promise.all([
      fetchHRPositions(hrTenantId),
      fetchHRRoleLevels(hrTenantId),
      fetchHRPeople(hrTenantId),
      fetchHRLocationNames(hrTenantId),
      fetchHRSupervisors(hrTenantId),
    ]);
  } catch (err: any) {
    throw AppError.internal(`HR read failed: ${err.message}`);
  }

  const nowIso = new Date().toISOString();
  const positionRows = hrPositions.map((p) => {
    const lvl = p.role_level_id ? roleLevels.get(p.role_level_id) : undefined;
    return {
      tenant_id: tenantId,
      hr_position_id: p.id,
      title: p.title || p.name || 'Untitled Position',
      name: p.name,
      role_level: lvl?.name ?? null,
      role_level_rank: lvl?.rank_order ?? null,
      is_active: p.is_active,
      source: 'hr',
      synced_at: nowIso,
      updated_at: nowIso,
      // NOTE: spending_limit intentionally omitted so existing per-position caps are preserved.
    };
  });

  let localPositions: Array<{ id: string; hr_position_id: string | null }> = [];
  if (positionRows.length > 0) {
    const { data: upserted, error: posErr } = await supabase
      .from('positions')
      .upsert(positionRows, { onConflict: 'tenant_id,hr_position_id' })
      .select('id, hr_position_id');
    if (posErr) throw AppError.internal(`positions upsert failed: ${posErr.message}`);
    localPositions = upserted ?? [];
  } else {
    const { data: existing } = await supabase
      .from('positions')
      .select('id, hr_position_id')
      .eq('tenant_id', tenantId);
    localPositions = existing ?? [];
  }

  const hrToLocalPosition = new Map<string, string>();
  for (const lp of localPositions) {
    if (lp.hr_position_id) hrToLocalPosition.set(lp.hr_position_id, lp.id);
  }

  // ── Heal stale positions (HR reseeds mint new ids for the same titles) ──
  let stalePositionsDeactivated = 0;
  if (hrPositions.length > 0) {
    const liveHrPositionIds = new Set(hrPositions.map((p) => p.id));
    const { data: mirroredPos, error: mpErr } = await supabase
      .from('positions').select('hr_position_id')
      .eq('tenant_id', tenantId).eq('source', 'hr').eq('is_active', true)
      .not('hr_position_id', 'is', null).limit(2000);
    if (mpErr) throw AppError.internal(`positions stale read failed: ${mpErr.message}`);
    const stale = (mirroredPos ?? [])
      .map((r: { hr_position_id: string }) => r.hr_position_id)
      .filter((id: string) => !liveHrPositionIds.has(id));
    if (stale.length > 0) {
      const { error: healErr } = await supabase
        .from('positions').update({ is_active: false, synced_at: nowIso, updated_at: nowIso })
        .in('hr_position_id', stale).eq('tenant_id', tenantId);
      if (healErr) throw AppError.internal(`positions stale deactivate failed: ${healErr.message}`);
      stalePositionsDeactivated = stale.length;
      log.info('hr.sync.stale_positions_deactivated', { count: stale.length });
    }
  }

  // ── Mirror ALL HR people into the local roster ──────────────────────────
  if (hrPeople.length > 0) {
    const peopleRows = hrPeople.map((p) => hrPersonToMirrorRow(p, tenantId, nowIso, hrLocationNames, hrSupervisors));
    const { error: hrpErr } = await supabase
      .from('hr_people')
      .upsert(peopleRows, { onConflict: 'tenant_id,hr_person_id' });
    if (hrpErr) throw AppError.internal(`hr_people upsert failed: ${hrpErr.message}`);
  }

  // ── Heal stale people (kills the duplicate-email roster rows) ───────────
  let stalePeopleDeactivated = 0;
  if (hrPeople.length > 0) {
    const liveHrPersonIds = new Set(hrPeople.map((p) => p.id));
    const { data: mirrored, error: mirErr } = await supabase
      .from('hr_people').select('hr_person_id')
      .eq('tenant_id', tenantId).eq('is_active', true).limit(5000);
    if (mirErr) throw AppError.internal(`hr_people stale read failed: ${mirErr.message}`);
    const stale = (mirrored ?? [])
      .map((r: { hr_person_id: string }) => r.hr_person_id)
      .filter((id: string) => !liveHrPersonIds.has(id));
    if (stale.length > 0) {
      const { error: healErr } = await supabase
        .from('hr_people').update({ is_active: false, updated_at: nowIso })
        .in('hr_person_id', stale).eq('tenant_id', tenantId);
      if (healErr) throw AppError.internal(`hr_people stale deactivate failed: ${healErr.message}`);
      stalePeopleDeactivated = stale.length;
      log.info('hr.sync.stale_people_deactivated', { count: stale.length });
    }
  }

  // ── Self-heal "Pending Sync" stubs ──────────────────────────────────────
  // ensure_local_user_flexible() mints a stub local_users row (name='Pending
  // Sync', email NULL) whenever an FK reference arrives before the user is
  // mirrored from Core. Email-based matching below can never heal those, but
  // hr_people.profile_id IS the Core user id — so resolve stubs against the
  // mirror we just refreshed. Runs in-DB (reconcile_pending_local_users,
  // migration 20260814000001); failure logs a warning without failing the sync.
  let pendingHealed = 0;
  let pendingRemaining = 0;
  {
    const { data: reconciled, error: recErr } = await supabase
      .rpc('reconcile_pending_local_users', { p_tenant_id: tenantId });
    if (recErr) {
      log.warn('hr.sync.pending_reconcile_failed', { error: recErr.message });
    } else {
      pendingHealed = reconciled?.healed ?? 0;
      pendingRemaining = reconciled?.remaining ?? 0;
      if (pendingHealed > 0) {
        log.info('hr.sync.pending_stubs_healed', { healed: pendingHealed, remaining: pendingRemaining });
      }
    }
  }

  // ── People → local_users (match app users by email) ─────────────────────
  const peopleByEmail = indexPeopleByEmail(hrPeople);

  const { data: users, error: usersErr } = await supabase
    .from('local_users')
    .select('user_id, email')
    .eq('tenant_id', tenantId);
  if (usersErr) throw AppError.internal(`local_users read failed: ${usersErr.message}`);

  let usersMatched = 0;
  for (const u of users ?? []) {
    const email = u.email?.trim().toLowerCase();
    if (!email) continue;
    const person = peopleByEmail.get(email);
    if (!person) continue;
    const localPositionId = person.position_id ? hrToLocalPosition.get(person.position_id) ?? null : null;
    const { error: updErr } = await supabase
      .from('local_users')
      .update({ hr_person_id: person.id, position_id: localPositionId, synced_at: nowIso })
      .eq('user_id', u.user_id)
      .eq('tenant_id', tenantId);
    if (updErr) {
      log.warn('hr.sync.user_update_failed', { user_id: u.user_id, error: updErr.message });
      continue;
    }
    usersMatched++;
  }

  // ── Position kits: catch-up provisioning for new hires ──────────────────
  // The hub webhook (org_people.created) is the realtime path; this is the
  // safety net for deliveries that never arrived — on stage especially, where
  // the subscription may not be registered at all. Everyone who existed when
  // migration 20260814000005 landed carries a 'skipped_backfill' ledger row, so
  // this pass can only ever see genuinely new people (it will NOT kit the
  // standing roster). Failures are logged, never fatal to the sync.
  let kitsProvisioned = 0;
  let kitCandidates = 0;
  let kitsRetried = 0;
  try {
    const kitPass = await provisionNewHires(supabase, { tenantId, log });
    kitsProvisioned = kitPass.provisioned;
    kitCandidates = kitPass.candidates;
    kitsRetried = kitPass.retried;
  } catch (err: any) {
    log.warn('hr.sync.kit_provision_pass_failed', { error: err?.message });
  }

  const summary: HRSyncSummary = {
    configured: true,
    positionsSynced: positionRows.length,
    peopleMirrored: hrPeople.length,
    usersMatched,
    stalePositionsDeactivated,
    stalePeopleDeactivated,
    pendingHealed,
    pendingRemaining,
    kitCandidates,
    kitsProvisioned,
    kitsRetried,
  };
  log.info('hr.synced', { ...summary, hrTenantId });
  return summary;
}
