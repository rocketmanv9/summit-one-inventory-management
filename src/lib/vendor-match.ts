/**
 * Vendor duplicate matching — shared by the /match endpoint and the vendor POST
 * guard so no add path (AI web search, AI suggest, email, manual, or any future
 * caller) can silently create a duplicate vendor.
 *
 * The scoring lives in SQL (supply_chain.rpc_vendor_match_candidates) so it runs
 * once, tenant-scoped, over name (trigram + token containment), address
 * (vendor_addresses + the denormalized vendor row), website/email domains, and
 * phone. This module is the thin TS wrapper + the shared thresholds.
 */

/** A candidate the caller wants to check before creating. */
export interface VendorMatchInput {
  name: string;
  street1?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  website?: string | null;
  email?: string | null;
  domain?: string | null;
  phone?: string | null;
  /** Skip this vendor id (e.g. when re-checking the vendor being edited). */
  excludeVendorId?: string | null;
}

export interface VendorMatch {
  vendor_id: string;
  vendor_name: string;
  /** 0–100. */
  confidence: number;
  reasons: string[];
}

/**
 * Confidence at/above which the UI blocks confirm and the server 409s without an
 * explicit `force`. Below this but at/above HINT we show a passive "similar
 * vendors" note.
 */
export const STRONG_MATCH_THRESHOLD = 72;
export const HINT_MATCH_THRESHOLD = 45;

/** True when this match should hard-gate creation (block/409 unless forced). */
export function isStrongMatch(m: { confidence: number }): boolean {
  return m.confidence >= STRONG_MATCH_THRESHOLD;
}

/**
 * Run the tenant's vendor matcher. `sc` is a supply_chain-schema Supabase client
 * (i.e. `(supabase as any).schema('supply_chain')`). Returns matches ordered by
 * confidence desc (already capped at 8 by the RPC). Never throws — a matcher
 * failure must not block the caller; it logs and returns [].
 */
export async function findVendorMatches(
  sc: any,
  tenantId: string,
  input: VendorMatchInput,
  log?: { error: (msg: string, meta?: Record<string, unknown>) => void },
): Promise<VendorMatch[]> {
  const name = (input.name || '').trim();
  if (name.length < 2) return [];
  const { data, error } = await sc.rpc('rpc_vendor_match_candidates', {
    p_tenant_id: tenantId,
    p_name: name,
    p_street1: input.street1 ?? null,
    p_city: input.city ?? null,
    p_state: input.state ?? null,
    p_zip: input.zip ?? null,
    p_website: input.website ?? null,
    p_email: input.email ?? null,
    p_domain: input.domain ?? null,
    p_phone: input.phone ?? null,
    p_exclude_id: input.excludeVendorId ?? null,
  });
  if (error) {
    log?.error('vendor.match_failed', { error: error.message });
    return [];
  }
  return (data || []) as VendorMatch[];
}
