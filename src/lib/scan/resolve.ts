import { AppError } from '@rocketmanv9/chassis/errors';

/**
 * Shared scan-code resolution used by the session-authenticated
 * `GET /api/scan/lookup` route (desktop + the true mobile app).
 *
 * Historically catalog-item barcode/SKU resolution only lived on the
 * mobile-session token path (`GET /api/m/count/lookup`, auth via the short
 * mobile JWT). The true mobile app authenticates as the real user through the
 * chassis session cookie, so it needs the SAME resolution behind real auth.
 * This function centralises both, so the two callers can't drift.
 *
 * Resolution order (first exact match wins):
 *   1. assets.asset_tag
 *   2. assets.serial_number
 *   3. catalog_items.barcode
 *   4. catalog_items.sku
 *
 * `inv` must already be a tenant-scoped client on the `inventory` schema
 * (i.e. `createTenantServiceClient(...).schema('inventory')`), so every query
 * here is implicitly tenant-isolated by RLS — there is no cross-tenant path.
 */

// fleet_asset_id/asset_kind ride along so the mobile scan flow can ask
// Operations "who does this unit belong to" (equipment whereabouts).
const ASSET_SELECT =
  'id, asset_tag, serial_number, status, catalog_item_id, location_id, fleet_asset_id, asset_kind, catalog_items(id, name, sku), locations(id, name)';

const CATALOG_SELECT = 'id, name, sku, barcode, tracking_mode, uom_term_id';

export type ScanMatch =
  | { type: 'asset'; entity: Record<string, unknown>; href: string }
  | { type: 'catalog_item'; entity: Record<string, unknown>; href: string };

export async function resolveScanCode(
  inv: { from: (table: string) => any },
  code: string,
): Promise<ScanMatch | null> {
  const trimmed = code.trim();
  if (!trimmed) {
    throw AppError.badRequest('Missing required query parameter: code');
  }

  // 1. Serialized asset by tag
  const { data: assetByTag } = await inv
    .from('assets')
    .select(ASSET_SELECT)
    .eq('asset_tag', trimmed)
    .limit(1)
    .maybeSingle();
  if (assetByTag) {
    return { type: 'asset', entity: assetByTag, href: '/inventory/assets' };
  }

  // 2. Serialized asset by serial number
  const { data: assetBySerial } = await inv
    .from('assets')
    .select(ASSET_SELECT)
    .eq('serial_number', trimmed)
    .limit(1)
    .maybeSingle();
  if (assetBySerial) {
    return { type: 'asset', entity: assetBySerial, href: '/inventory/assets' };
  }

  // 3. Fungible catalog item by barcode (the gap the mobile app needed closed)
  const { data: itemByBarcode } = await inv
    .from('catalog_items')
    .select(CATALOG_SELECT)
    .eq('barcode', trimmed)
    .limit(1)
    .maybeSingle();
  if (itemByBarcode) {
    return { type: 'catalog_item', entity: itemByBarcode, href: '/inventory/items' };
  }

  // 4. Fungible catalog item by SKU
  const { data: itemBySku } = await inv
    .from('catalog_items')
    .select(CATALOG_SELECT)
    .eq('sku', trimmed)
    .limit(1)
    .maybeSingle();
  if (itemBySku) {
    return { type: 'catalog_item', entity: itemBySku, href: '/inventory/items' };
  }

  return null;
}
