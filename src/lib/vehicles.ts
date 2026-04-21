import { createVehicleCatalogClient, createTenantVehicleClient } from '@rocketmanv9/chassis/vehicles';
import type { VehicleCatalogClient, TenantVehicleClient } from '@rocketmanv9/chassis/vehicles';

/**
 * Lazy singleton catalog client for browsing the platform vehicle catalog.
 * Uses 30s cache — safe to call from any route handler.
 *
 * @example
 * const catalog = getVehicleCatalogClient();
 *
 * // List all catalog vehicles (optionally filter by industry)
 * const vehicles = await catalog.list({ industry: 'construction' });
 *
 * // Get a specific catalog vehicle
 * const vehicle = await catalog.getById(catalogVehicleId);
 *
 * // List available industry tags
 * const tags = await catalog.listIndustryTags();
 */
let _catalogClient: VehicleCatalogClient | null = null;

export function getVehicleCatalogClient(): VehicleCatalogClient {
  if (!_catalogClient) {
    _catalogClient = createVehicleCatalogClient({ cacheTtlMs: 30_000 });
  }
  return _catalogClient;
}

/**
 * Create a tenant-scoped vehicle client for CRUD operations.
 * Sets RLS context so create, update, adopt, and submission methods work.
 *
 * @example
 * const vehicles = await getTenantVehicleClient(tenantId);
 *
 * // Create a custom vehicle
 * const vehicle = await vehicles.create({ name: 'Ford F-350', vehicle_type_id: termId });
 *
 * // Adopt vehicles from the platform catalog
 * const result = await vehicles.adopt([catalogVehicleId1, catalogVehicleId2]);
 *
 * // List tenant's vehicles
 * const list = await vehicles.list({ activeOnly: true });
 *
 * // Submit a custom vehicle to the platform catalog
 * await vehicles.submitToCatalog(vehicleId, { tenantId, userId, email });
 */
export async function getTenantVehicleClient(tenantId: string): Promise<TenantVehicleClient> {
  return createTenantVehicleClient(tenantId, { cacheTtlMs: 30_000 });
}
