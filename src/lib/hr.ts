/**
 * summit-one-hr read client.
 *
 * HR (project ref gptqvqbrcfilersbnudl) is a SEPARATE Supabase project — the system of
 * record for people (`org_people`) and positions (`org_positions`). We mirror positions
 * into public.positions and match HR people to local_users by email so PO spending limits
 * can attach per-position / per-user.
 *
 * SERVER-ONLY. Uses the HR service-role key (bypasses HR RLS, which hides org_people /
 * org_positions from anon). Never import this into a client component, and only call
 * getHRClient() from lib/route code — never embed createServiceClientUnsafe in a route
 * handler directly (compliance scanner ERROR); routes import the helpers below instead.
 *
 * Tenant note: HR tenant_id and the app tenant_id are NOT guaranteed equal. Callers pass
 * the HR-side tenant id (tenant_settings.hr_tenant_id, defaulting to the app tenant).
 */
import { createServiceClientUnsafe } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

export interface HRPosition {
  id: string;
  tenant_id: string;
  name: string | null;
  title: string | null;
  role_level_id: string | null;
  is_active: boolean;
}

export interface HRRoleLevel {
  id: string;
  name: string | null;
  rank_order: number | null;
}

export interface HRPerson {
  id: string;
  tenant_id: string;
  position_id: string | null;
  work_email: string | null;
  personal_email: string | null;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  employee_code: string | null;
  employment_status: string | null;
  profile_id: string | null;
  location_id: string | null;
  is_active: boolean;
}

/**
 * Map an HR org_people row (from fetchHRPeople OR a webhook payload.new) to a
 * public.hr_people upsert row. Tolerant of the full HR row shape and the HRPerson subset.
 *
 * `locationNameById` resolves location_id → display name (from HR's
 * clone_tenant_locations). When absent (webhook path), location_name is
 * omitted from the row so the upsert leaves any previously-synced name alone.
 */
export function hrPersonToMirrorRow(
  p: any,
  tenantId: string,
  nowIso: string,
  locationNameById?: Map<string, string>,
  supervisorByPersonId?: Map<string, string>,
) {
  const row: Record<string, unknown> = {
    hr_person_id: p.id,
    tenant_id: tenantId,
    hr_position_id: p.position_id ?? null,
    first_name: p.first_name ?? null,
    last_name: p.last_name ?? null,
    preferred_name: p.preferred_name ?? null,
    work_email: p.work_email ?? null,
    personal_email: p.personal_email ?? null,
    employee_code: p.employee_code ?? null,
    employment_status: p.employment_status ?? null,
    is_active: p.is_active ?? true,
    profile_id: p.profile_id ?? null,
    hr_location_id: p.location_id ?? null,
    synced_at: nowIso,
    updated_at: nowIso,
  };
  if (locationNameById) {
    row.location_name = p.location_id ? locationNameById.get(p.location_id) ?? null : null;
  }
  // Supervisor edge (PO approval routing) — only the full sync carries it;
  // the webhook path omits it so partial updates don't clobber a synced value.
  if (supervisorByPersonId) {
    row.supervisor_hr_person_id = supervisorByPersonId.get(p.id) ?? null;
  }
  return row;
}

/** HR person → primary supervisor (org_person_supervisors). */
export async function fetchHRSupervisors(hrTenantId: string): Promise<Map<string, string>> {
  const hr = getHRClient();
  if (!hr) return new Map();
  const { data, error } = await hr
    .from('org_person_supervisors')
    .select('person_id, supervisor_person_id, is_primary')
    .eq('tenant_id', hrTenantId)
    .limit(5000);
  if (error) throw AppError.internal(`HR supervisors read failed: ${error.message}`);
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.is_primary === false && map.has(row.person_id)) continue;
    if (row.supervisor_person_id) map.set(row.person_id, row.supervisor_person_id);
  }
  return map;
}

let _hr: any = null;

/** True when HR_SUPABASE_* env is configured. */
export function isHRConfigured(): boolean {
  return Boolean(process.env.HR_SUPABASE_URL && process.env.HR_SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Lazy singleton read client for summit-one-hr. Returns null when HR isn't configured
 * so callers can degrade gracefully (UI still works, sync reports "not configured").
 */
export function getHRClient(): any | null {
  if (!isHRConfigured()) return null;
  if (!_hr) {
    _hr = createServiceClientUnsafe({
      url: process.env.HR_SUPABASE_URL!,
      serviceRoleKey: process.env.HR_SUPABASE_SERVICE_ROLE_KEY!,
      dangerouslyBypassRLS: true,
    });
  }
  return _hr;
}

/** Active positions for an HR tenant. */
export async function fetchHRPositions(hrTenantId: string): Promise<HRPosition[]> {
  const hr = getHRClient();
  if (!hr) return [];
  const { data, error } = await hr
    .from('org_positions')
    .select('id, tenant_id, name, title, role_level_id, is_active')
    .eq('tenant_id', hrTenantId)
    .eq('is_active', true)
    .limit(2000);
  if (error) throw AppError.internal(`HR org_positions read failed: ${error.message}`);
  return (data ?? []) as HRPosition[];
}

/** Role levels (seniority) for an HR tenant, keyed by id. */
export async function fetchHRRoleLevels(hrTenantId: string): Promise<Map<string, HRRoleLevel>> {
  const hr = getHRClient();
  const map = new Map<string, HRRoleLevel>();
  if (!hr) return map;
  const { data, error } = await hr
    .from('org_role_levels')
    .select('id, name, rank_order')
    .eq('tenant_id', hrTenantId)
    .limit(500);
  if (error) throw AppError.internal(`HR org_role_levels read failed: ${error.message}`);
  for (const r of (data ?? []) as HRRoleLevel[]) map.set(r.id, r);
  return map;
}

/** Active people for an HR tenant. */
export async function fetchHRPeople(hrTenantId: string): Promise<HRPerson[]> {
  const hr = getHRClient();
  if (!hr) return [];
  // Deliberately NO is_active filter: the mirror must hold EVERYONE so
  // deactivations propagate and rosters (e.g. count qualifications) are
  // complete. Consumers filter on is_active themselves.
  const { data, error } = await hr
    .from('org_people')
    .select('id, tenant_id, position_id, work_email, personal_email, first_name, last_name, preferred_name, employee_code, employment_status, profile_id, location_id, is_active')
    .eq('tenant_id', hrTenantId)
    .limit(5000);
  if (error) throw AppError.internal(`HR org_people read failed: ${error.message}`);
  return (data ?? []) as HRPerson[];
}

/** HR location id → display name (HR's clone_tenant_locations). */
export async function fetchHRLocationNames(hrTenantId: string): Promise<Map<string, string>> {
  const hr = getHRClient();
  if (!hr) return new Map();
  const { data, error } = await hr
    .from('clone_tenant_locations')
    .select('id, name')
    .eq('tenant_id', hrTenantId)
    .limit(500);
  if (error) throw AppError.internal(`HR locations read failed: ${error.message}`);
  return new Map((data ?? []).map((l: { id: string; name: string }) => [l.id, l.name]));
}

/**
 * One HR location id → display name, WITHOUT requiring a full HR fetch.
 *
 * Why this exists: the full sync hands `hrPersonToMirrorRow` a
 * `locationNameById` map built from HR's clone_tenant_locations, but the
 * webhook only ever sees a single `org_people` row carrying a bare
 * `location_id`. Before this helper the webhook left `hr_people.location_name`
 * NULL — and the kit engine matches HR locations to inventory locations BY
 * NAME, so every hire whose first-ever delivery was the webhook landed as
 * "HR record has no location" (item 04 rescue, 2026-08-14).
 *
 * Resolution order, cheapest first:
 *   1. a name carried on the payload itself (some hub envelopes denormalize it)
 *   2. the local mirror — any other person already synced at the same
 *      hr_location_id knows its name, and needs no HR credentials
 *   3. HR's clone_tenant_locations (only when HR is configured, e.g. a brand
 *      new yard nobody is mirrored at yet)
 *
 * Returns null when it genuinely can't tell — callers must then leave
 * location_name untouched rather than writing NULL over a good value.
 */
export async function resolveHRLocationName(
  supabase: any,
  tenantId: string,
  hrLocationId: string | null | undefined,
  payloadName?: string | null,
): Promise<string | null> {
  const fromPayload = payloadName?.trim();
  if (fromPayload) return fromPayload;
  if (!hrLocationId) return null;

  const { data: sibling } = await supabase
    .from('hr_people')
    .select('location_name')
    .eq('tenant_id', tenantId)
    .eq('hr_location_id', hrLocationId)
    .not('location_name', 'is', null)
    .limit(1)
    .maybeSingle();
  const mirrored = (sibling?.location_name ?? '').trim();
  if (mirrored) return mirrored;

  if (!isHRConfigured()) return null;
  const { data: settings } = await supabase
    .from('tenant_settings')
    .select('hr_tenant_id')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const names = await fetchHRLocationNames(settings?.hr_tenant_id || tenantId);
  return names.get(hrLocationId) ?? null;
}

/** Build a lowercased-email → HR person index (work_email + personal_email). */
export function indexPeopleByEmail(people: HRPerson[]): Map<string, HRPerson> {
  const idx = new Map<string, HRPerson>();
  for (const p of people) {
    for (const e of [p.work_email, p.personal_email]) {
      const key = e?.trim().toLowerCase();
      if (key && !idx.has(key)) idx.set(key, p);
    }
  }
  return idx;
}

// ── Unlinked ("Pending Sync") account helpers ─────────────────────────────────
// A local_users row is "unlinked" when the FK-safety trigger
// (ensure_local_user_flexible) minted it before the user was mirrored from
// Core and no identity source has resolved it since: email NULL and/or the
// literal 'Pending Sync' placeholder name.

export interface LocalUserReference {
  table: string;
  column: string;
  count: number;
}

/** True when a local_users row is an unresolved trigger stub. */
export function isUnlinkedLocalUser(u: { email?: string | null; name?: string | null }): boolean {
  return !u.email || !u.name || u.name === 'Pending Sync';
}

/**
 * True when a referencing table is telemetry/audit-shaped — outbox events,
 * audit logs, domain event streams. References like these are safe to orphan
 * (all FKs to local_users are ON DELETE SET NULL), so a stub referenced ONLY
 * by such tables may be removed. Business records (POs, receipts, assets,
 * locations, …) block removal.
 */
export function isTestSafeReference(refTable: string): boolean {
  const bare = refTable.split('.').pop() ?? refTable;
  return (
    bare === 'events_outbox' ||
    bare === 'audit_logs' ||
    bare === 'guardrail_exceptions' ||
    bare.endsWith('_events')
  );
}
