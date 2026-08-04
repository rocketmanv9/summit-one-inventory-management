import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import {
  isHRConfigured,
  fetchHRPositions,
  fetchHRRoleLevels,
  fetchHRPeople,
  fetchHRLocationNames,
  fetchHRSupervisors,
  indexPeopleByEmail,
  hrPersonToMirrorRow,
} from '@/lib/hr';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * POST /api/hr/sync — pull positions + people from summit-one-hr.
 *
 *  - Mirrors active org_positions into public.positions (preserving per-position
 *    spending_limit already configured here — the sync never overwrites limits).
 *  - Matches active org_people to local_users by email and stamps position_id +
 *    hr_person_id (never touches a user's per-user spending_limit).
 *
 * Admin-only. Idempotent: re-running converges (upsert on (tenant_id, hr_position_id)).
 */
export const POST = createSessionWriteRoute(async ({ ctx, supabase, log, idempotencyKey }): Promise<{
  data: any;
  status: number;
  events: Array<{ event_name: string; payload: any; last_event_id: string }>;
}> => {
  const tenantId = ctx.tenantId!;

  // Admin gate — limits/positions are an admin concern.
  const { data: me } = await supabase
    .from('local_users')
    .select('role')
    .eq('user_id', ctx.userId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (me?.role !== 'admin') throw AppError.forbidden('Admin role required to sync HR data');

  if (!isHRConfigured()) {
    return {
      data: { configured: false, message: 'HR integration not configured (set HR_SUPABASE_URL / HR_SUPABASE_SERVICE_ROLE_KEY)', positionsSynced: 0, usersMatched: 0 },
      status: 200,
      events: [],
    };
  }

  // Resolve the HR-side tenant id (defaults to identity — same uuid as the app tenant).
  const { data: settings } = await supabase
    .schema('supply_chain')
    .from('tenant_settings')
    .select('hr_tenant_id')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const hrTenantId: string = settings?.hr_tenant_id || tenantId;

  // ── Positions ──────────────────────────────────────────────────────────
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

  // ── Mirror ALL HR people into the local roster ──────────────────────────
  if (hrPeople.length > 0) {
    const peopleRows = hrPeople.map((p) => hrPersonToMirrorRow(p, tenantId, nowIso, hrLocationNames, hrSupervisors));
    const { error: hrpErr } = await supabase
      .from('hr_people')
      .upsert(peopleRows, { onConflict: 'tenant_id,hr_person_id' });
    if (hrpErr) throw AppError.internal(`hr_people upsert failed: ${hrpErr.message}`);
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

  log.info('hr.synced', { positionsSynced: positionRows.length, peopleMirrored: hrPeople.length, usersMatched, hrTenantId });

  return {
    data: { configured: true, positionsSynced: positionRows.length, peopleMirrored: hrPeople.length, usersMatched },
    status: 200,
    events: [{
      event_name: 'hr.synced',
      payload: { tenant_id: tenantId, positions_synced: positionRows.length, people_mirrored: hrPeople.length, users_matched: usersMatched },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/hr/sync' });
