/**
 * Tenant Safety — Assertions for multi-tenant AI isolation.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = any;

export class TenantLeakageError extends Error {
  constructor(message: string) { super(message); this.name = 'TenantLeakageError'; }
}

/**
 * Assert a record belongs to the expected tenant.
 */
export function assertTenantMatch(record: { tenant_id?: string } | null, expectedTenantId: string, context: string): void {
  if (!record) return;
  if (record.tenant_id && record.tenant_id !== expectedTenantId) {
    throw new TenantLeakageError(`Tenant mismatch in ${context}: expected ${expectedTenantId}, got ${record.tenant_id}`);
  }
}

/**
 * Assert tool result data belongs to the expected tenant.
 */
export function assertNoTenantLeakage(data: any[], expectedTenantId: string, context: string): void {
  if (!Array.isArray(data)) return;
  for (const row of data) {
    if (row.tenant_id && row.tenant_id !== expectedTenantId) {
      throw new TenantLeakageError(`Tenant leakage detected in ${context}: found tenant ${row.tenant_id}`);
    }
  }
}

/**
 * Run the vector isolation verification RPC.
 */
export async function verifyVectorIsolation(supabase: SupabaseClientLike, tenantId: string): Promise<{ clean: boolean; details: any[] }> {
  const { data } = await supabase.schema('inventory').rpc('rpc_verify_vector_isolation', { match_tenant_id: tenantId });
  const results = data || [];
  const clean = results.every((r: any) => r.is_clean);
  return { clean, details: results };
}
