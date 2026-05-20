import { createClient } from '@supabase/supabase-js';
import { createVendorCatalogClient, createTenantVendorClient } from '@rocketmanv9/chassis/vendors';
import type { VendorCatalogClient, TenantVendorClient } from '@rocketmanv9/chassis/vendors';

/**
 * Lazy singleton catalog client for browsing the platform vendor catalog.
 * Uses 30s cache — safe to call from any route handler.
 */
let _catalogClient: VendorCatalogClient | null = null;

export function getCatalogClient(): VendorCatalogClient {
  if (!_catalogClient) {
    _catalogClient = createVendorCatalogClient({ cacheTtlMs: 30_000 });
  }
  return _catalogClient;
}

/**
 * Build a plain GV Supabase client (no RLS context) for use as the
 * adminClient in adopt/submission flows that need to read catalog tables.
 */
function getGVAdminClient() {
  const url = process.env.GV_SUPABASE_URL;
  const key = process.env.GV_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('GV_SUPABASE_URL / GV_SUPABASE_ANON_KEY not set');
  return createClient(url, key);
}

/**
 * Create a tenant-scoped vendor client for CRUD operations.
 * Sets RLS context so create, update, adopt, and submission methods work.
 * Passes an adminClient for adopt flows that need catalog-level reads.
 */
export async function getTenantVendorClient(tenantId: string): Promise<TenantVendorClient> {
  return createTenantVendorClient(tenantId, {
    cacheTtlMs: 30_000,
    adminClient: getGVAdminClient(),
  });
}
