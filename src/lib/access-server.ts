// Server-side capability resolution + enforcement.
//
// Resolves the REAL logged-in user's effective capabilities (admins and
// unconfigured positions get full access) and asserts a required capability on
// write routes. This is the enforcement counterpart to the client-side
// preview in src/lib/view-as.tsx. See src/lib/access.ts for the catalog.
//
// SERVER-ONLY — pass in the route's tenant-scoped supabase client.

import { AppError } from '@rocketmanv9/chassis/errors';

/**
 * The capability set the user effectively has, or `null` for FULL ACCESS.
 * Full access (null) when: the user is an admin, has no position, or the
 * position has no capability row (unconfigured = full access — matches the DB
 * semantics in 20260623000001_position_capabilities.sql).
 */
export async function resolveUserCapabilities(
  supabase: any,
  tenantId: string,
  userId: string,
): Promise<Set<string> | null> {
  const { data: user } = await supabase
    .from('local_users')
    .select('role, position_id')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!user || user.role === 'admin') return null;          // admin / unknown → full
  if (!user.position_id) return null;                        // no position → full

  const { data: row } = await supabase
    .from('position_capabilities')
    .select('capability_keys')
    .eq('tenant_id', tenantId)
    .eq('position_id', user.position_id)
    .maybeSingle();

  if (!row) return null;                                     // unconfigured → full
  return new Set<string>(row.capability_keys ?? []);
}

/**
 * Throw 403 unless the user has `capabilityKey` (or full access). Use at the top
 * of a write route handler, before mutating.
 */
export async function assertCapability(
  supabase: any,
  params: { tenantId: string; userId: string },
  capabilityKey: string,
): Promise<void> {
  const caps = await resolveUserCapabilities(supabase, params.tenantId, params.userId);
  if (caps === null) return;                                 // full access
  if (caps.has(capabilityKey)) return;
  throw AppError.forbidden(`Your position does not have permission to ${capabilityKey.replace(/[._]/g, ' ')}.`);
}
