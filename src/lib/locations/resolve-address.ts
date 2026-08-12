/**
 * Effective-address resolution for locations.
 *
 * A child location (e.g. "Portland Shed") typically has no address of its own —
 * it inherits its parent's ("Portland"). When we need a ship-to address we walk
 * up parent_location_id until we find an ancestor with a complete address.
 */

type AnyClient = any;

export interface ResolvedAddress {
  address_line_1: string;
  address_line_2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  /** Which location actually supplied the address (self or an ancestor). */
  source_location_id: string;
  source_name: string;
}

function isComplete(loc: any): boolean {
  return !!(loc?.address_line_1 && loc?.city && loc?.state && loc?.postal_code);
}

/**
 * Walk up the parent chain starting at `startId`, returning the first location
 * (inclusive) with a complete address, or null if none in the chain has one.
 * Bounded by maxDepth and a visited-set to survive bad/cyclic parent links.
 */
export async function resolveAddressFromChain(
  inv: AnyClient,
  tenantId: string,
  startId: string,
  maxDepth = 6,
): Promise<ResolvedAddress | null> {
  let id: string | null = startId;
  const seen = new Set<string>();

  for (let i = 0; i < maxDepth && id; i++) {
    if (seen.has(id)) break; // cycle guard
    seen.add(id);

    const res: { data: any } = await inv
      .from('locations')
      .select('id, name, parent_location_id, address_line_1, address_line_2, city, state, postal_code, country')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .limit(1)
      .maybeSingle();
    const loc = res.data;

    if (!loc) break;
    if (isComplete(loc)) {
      return {
        address_line_1: loc.address_line_1,
        address_line_2: loc.address_line_2 ?? null,
        city: loc.city,
        state: loc.state,
        postal_code: loc.postal_code,
        country: loc.country || 'US',
        source_location_id: loc.id,
        source_name: loc.name,
      };
    }
    id = loc.parent_location_id;
  }
  return null;
}

/**
 * Given an already-loaded location row, return the effective address fields:
 * the location's own when complete, otherwise the nearest addressed ancestor's.
 * The destination NAME stays the requested location's; only the street/city/
 * state/ZIP are inherited. Returns the original row unchanged if it has its own
 * address or no parent to inherit from.
 */
export async function applyInheritedAddress(
  inv: AnyClient,
  tenantId: string,
  location: any,
): Promise<any> {
  if (isComplete(location) || !location?.parent_location_id) return location;
  const inherited = await resolveAddressFromChain(inv, tenantId, location.parent_location_id);
  if (!inherited) return location;
  return {
    ...location,
    address_line_1: inherited.address_line_1,
    address_line_2: inherited.address_line_2,
    city: inherited.city,
    state: inherited.state,
    postal_code: inherited.postal_code,
    country: inherited.country,
  };
}
