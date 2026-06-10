// GV is a separate Supabase project; chassis client factories target the app DB only.
// We must use createClient directly with GV_SUPABASE_URL + GV_SUPABASE_ANON_KEY to
// connect to the GV project for catalog reads and vendor RPCs.
// eslint-disable-next-line no-restricted-imports
import { createClient } from '@supabase/supabase-js';
import { createVendorCatalogClient, createTenantVendorClient } from '@rocketmanv9/chassis/vendors';
import { AppError } from '@rocketmanv9/chassis/errors';
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
export function getGVAdminClient() {
  const url = process.env.GV_SUPABASE_URL;
  const key = process.env.GV_SUPABASE_ANON_KEY;
  if (!url || !key) throw AppError.internal('GV_SUPABASE_URL / GV_SUPABASE_ANON_KEY not set');
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

/**
 * Create a custom vendor via the GV `rpc_gv_create_vendor` SECURITY DEFINER RPC.
 *
 * Why not the SDK `create()`? The tenant SDK sets `app.current_tenant_id` with a
 * separate `set_claim` request, but GV's PostgREST pools connections — the next
 * request (the INSERT) can land on a different connection without the GUC, so the
 * tenant-scoped RLS WITH CHECK fails ("new row violates row-level security policy").
 * Only the anon key is available for GV, so we can't use a service-role bypass.
 * The RPC sets context + inserts in ONE request/transaction, which is reliable.
 */
export async function createCustomVendor(
  tenantId: string,
  input: { name: string; vendor_type_id: string; account_number?: string; payment_terms?: string; notes?: string },
) {
  const client = getGVAdminClient();
  const { data, error } = await client.rpc('rpc_gv_create_vendor', {
    p_tenant_id: tenantId,
    p_name: input.name,
    p_vendor_type_id: input.vendor_type_id,
    p_account_number: input.account_number ?? null,
    p_payment_terms: input.payment_terms ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) {
    if (error.code === '23505') throw AppError.conflict('Vendor with this name already exists for your tenant');
    if (error.code === '23503') throw AppError.badRequest('Invalid vendor type');
    throw AppError.internal(error.message || 'Failed to create vendor');
  }
  return data;
}
