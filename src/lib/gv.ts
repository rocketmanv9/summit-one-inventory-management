import { createGVClient, createTenantGVClient } from '@rocketmanv9/chassis/global-values';
import type { GlobalValuesClient } from '@rocketmanv9/chassis/global-values';

/**
 * Lazy singleton GV client for read operations.
 * Uses 30s cache — safe to call from any route handler.
 *
 * @example
 * const gv = getGVClient();
 *
 * // Get tenant-aware display label
 * const label = await gv.displayLabel(tenantId, termId);
 *
 * // Build a term_id → label map (great for dropdowns)
 * const labelMap = await gv.buildLabelMap(tenantId, 'materials');
 *
 * // Validate raw strings are real, active term IDs
 * const branded = await gv.assertTermIds(['uuid-1', 'uuid-2']);
 */
let _gvClient: GlobalValuesClient | null = null;

export function getGVClient(): GlobalValuesClient {
  if (!_gvClient) {
    _gvClient = createGVClient({ cacheTtlMs: 30_000 });
  }
  return _gvClient;
}

/**
 * Create a tenant-scoped GV client for write operations.
 * Sets RLS context so resolveTermId, upsertOverride, and upsertAlias work.
 *
 * @example
 * const gv = await getTenantGVClient(tenantId);
 *
 * // Resolve free-text input to a TermId (alias → code → label → auto-create)
 * const termId = await gv.resolveTermId(tenantId, 'materials', 'Durafill');
 *
 * // Upsert a tenant-specific display override
 * await gv.upsertOverride({ tenantId, termId, label: 'Premium Fill' });
 *
 * // Add a tenant-specific alias
 * await gv.upsertAlias(tenantId, termId, 'durafill-legacy');
 */
export async function getTenantGVClient(tenantId: string): Promise<GlobalValuesClient> {
  return createTenantGVClient(tenantId, { cacheTtlMs: 30_000 });
}
