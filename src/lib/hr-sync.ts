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

type Logger = { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, meta?: Record<string, unknown>) => void };

export interface HRSyncSummary {
  configured: true;
  positionsSynced: number;
  peopleMirrored: number;
  usersMatched: number;
  stalePositionsDeactivated: number;
  stalePeopleDeactivated: number;
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

  const summary: HRSyncSummary = {
    configured: true,
    positionsSynced: positionRows.length,
    peopleMirrored: hrPeople.length,
    usersMatched,
    stalePositionsDeactivated,
    stalePeopleDeactivated,
  };
  log.info('hr.synced', { ...summary, hrTenantId });
  return summary;
}
