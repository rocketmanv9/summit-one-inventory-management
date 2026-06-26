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
 *
 * DENY BY DEFAULT: a position with no capability row (unconfigured) → **no
 * access** (empty set). Full access (`null`) only when: the user is a developer,
 * an admin, or has no position at all (these never get locked out). A configured
 * position returns exactly its granted keys.
 */
export async function resolveUserCapabilities(
  supabase: any,
  tenantId: string,
  userId: string,
  isDeveloper = false,
): Promise<Set<string> | null> {
  if (isDeveloper) return null;                              // developer → full (safety valve)

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

  if (!row) return new Set<string>();                        // unconfigured position → NO access
  return new Set<string>(row.capability_keys ?? []);
}

/**
 * Throw 403 unless the user has `capabilityKey` (or full access). Use at the top
 * of a write route handler, before mutating. (Write routes can't see the
 * developer flag — admins are still resolved to full here, which is the safety
 * valve that matters server-side.)
 */
export async function assertCapability(
  supabase: any,
  params: { tenantId: string; userId: string; isDeveloper?: boolean },
  capabilityKey: string,
): Promise<void> {
  const caps = await resolveUserCapabilities(supabase, params.tenantId, params.userId, params.isDeveloper ?? false);
  if (caps === null) return;                                 // full access
  if (caps.has(capabilityKey)) return;
  throw AppError.forbidden(`Your position does not have permission to ${capabilityKey.replace(/[._]/g, ' ')}.`);
}
