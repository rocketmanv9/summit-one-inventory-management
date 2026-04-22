import { createToolCatalogClient, createTenantToolClient } from '@rocketmanv9/chassis/tools';
import type { ToolCatalogClient, TenantToolClient } from '@rocketmanv9/chassis/tools';

/**
 * Lazy singleton catalog client for browsing the platform tool catalog.
 * Uses 30s cache — safe to call from any route handler.
 *
 * @example
 * const catalog = getToolCatalogClient();
 *
 * // List all catalog tools (optionally filter by industry)
 * const tools = await catalog.list({ industry: 'construction' });
 *
 * // Get a specific catalog tool
 * const tool = await catalog.getById(catalogToolId);
 *
 * // List available industry tags
 * const tags = await catalog.listIndustryTags();
 */
let _catalogClient: ToolCatalogClient | null = null;

export function getToolCatalogClient(): ToolCatalogClient {
  if (!_catalogClient) {
    _catalogClient = createToolCatalogClient({ cacheTtlMs: 30_000 });
  }
  return _catalogClient;
}

/**
 * Create a tenant-scoped tool client for CRUD operations.
 * Sets RLS context so create, update, adopt, and submission methods work.
 *
 * @example
 * const tools = await getTenantToolClient(tenantId);
 *
 * // Create a custom tool
 * const tool = await tools.create({ name: 'Crafco SS 125', tool_type_id: termId });
 *
 * // Adopt tools from the platform catalog
 * const result = await tools.adopt([catalogToolId1, catalogToolId2]);
 *
 * // List tenant's tools
 * const list = await tools.list({ activeOnly: true });
 *
 * // Submit a custom tool to the platform catalog
 * await tools.submitToCatalog(toolId, { tenantId, userId, email });
 */
export async function getTenantToolClient(tenantId: string): Promise<TenantToolClient> {
  return createTenantToolClient(tenantId, { cacheTtlMs: 30_000 });
}
