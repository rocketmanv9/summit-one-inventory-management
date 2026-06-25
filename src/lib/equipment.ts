import { createEquipmentCatalogClient, createTenantEquipmentClient } from '@rocketmanv9/chassis/equipment';
import type { EquipmentCatalogClient, TenantEquipmentClient } from '@rocketmanv9/chassis/equipment';
import { getGVAdminClient } from '@/lib/vendors';
import { AppError } from '@rocketmanv9/chassis/errors';

/**
 * Lazy singleton catalog client for browsing the platform equipment catalog.
 * Uses 30s cache — safe to call from any route handler.
 *
 * @example
 * const catalog = getEquipmentCatalogClient();
 *
 * // List all catalog equipment (optionally filter by industry)
 * const items = await catalog.list({ industry: 'construction' });
 *
 * // Get a specific catalog equipment entry
 * const item = await catalog.getById(catalogEquipmentId);
 *
 * // List available industry tags
 * const tags = await catalog.listIndustryTags();
 */
let _catalogClient: EquipmentCatalogClient | null = null;

export function getEquipmentCatalogClient(): EquipmentCatalogClient {
  if (!_catalogClient) {
    _catalogClient = createEquipmentCatalogClient({ cacheTtlMs: 30_000 });
  }
  return _catalogClient;
}

/**
 * Create a tenant-scoped equipment client for CRUD operations.
 * Sets RLS context so create, update, adopt, and submission methods work.
 *
 * @example
 * const equipment = await getTenantEquipmentClient(tenantId);
 *
 * // Create custom equipment
 * const item = await equipment.create({ name: 'CAT 420F2', equipment_type_id: termId });
 *
 * // Adopt equipment from the platform catalog
 * const result = await equipment.adopt([catalogEquipmentId1, catalogEquipmentId2]);
 *
 * // List tenant's equipment
 * const list = await equipment.list({ activeOnly: true });
 *
 * // Submit custom equipment to the platform catalog
 * await equipment.submitToCatalog(equipmentId, { tenantId, userId, email });
 */
export async function getTenantEquipmentClient(tenantId: string): Promise<TenantEquipmentClient> {
  return createTenantEquipmentClient(tenantId, { cacheTtlMs: 30_000 });
}

export interface EquipmentClass {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  family_slug: string | null;
}

/**
 * List the shared GV `equipment_classes` catalog (the 18-class taxonomy).
 * This is a standalone global catalog table — not part of the GV term system —
 * so it is read directly off the GV project via the admin client, mirroring the
 * vendor catalog pattern. Used to populate the equipment "Class" dropdown.
 */
export async function listEquipmentClasses(activeOnly = true): Promise<EquipmentClass[]> {
  const client = getGVAdminClient();
  let query = client
    .from('equipment_classes')
    .select('id, slug, name, category, family_slug')
    .order('name');
  if (activeOnly) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) throw AppError.internal(`Failed to load equipment classes: ${error.message}`);
  return (data ?? []) as EquipmentClass[];
}
