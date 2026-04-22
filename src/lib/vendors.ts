import { createVendorCatalogClient, createTenantVendorClient } from '@rocketmanv9/chassis/vendors';
import type { VendorCatalogClient, TenantVendorClient } from '@rocketmanv9/chassis/vendors';

/**
 * Lazy singleton catalog client for browsing the platform vendor catalog.
 * Uses 30s cache — safe to call from any route handler.
 *
 * @example
 * const catalog = getCatalogClient();
 *
 * // List all catalog vendors (optionally filter by industry)
 * const vendors = await catalog.list({ industry: 'construction' });
 *
 * // Get a specific catalog vendor
 * const vendor = await catalog.getById(catalogVendorId);
 *
 * // List available industry tags
 * const tags = await catalog.listIndustryTags();
 */
let _catalogClient: VendorCatalogClient | null = null;

export function getCatalogClient(): VendorCatalogClient {
  if (!_catalogClient) {
    _catalogClient = createVendorCatalogClient({ cacheTtlMs: 30_000 });
  }
  return _catalogClient;
}

/**
 * Create a tenant-scoped vendor client for CRUD operations.
 * Sets RLS context so create, update, adopt, and submission methods work.
 *
 * @example
 * const vendors = await getTenantVendorClient(tenantId);
 *
 * // Create a custom vendor
 * const vendor = await vendors.create({ name: 'Acme Corp', vendor_type_id: termId });
 *
 * // Adopt vendors from the platform catalog
 * const result = await vendors.adopt([catalogVendorId1, catalogVendorId2]);
 *
 * // List tenant's vendors
 * const list = await vendors.list({ activeOnly: true });
 *
 * // Submit a custom vendor to the platform catalog
 * await vendors.submitToCatalog(vendorId, { tenantId, userId, email });
 */
export async function getTenantVendorClient(tenantId: string): Promise<TenantVendorClient> {
  return createTenantVendorClient(tenantId, { cacheTtlMs: 30_000 });
}
