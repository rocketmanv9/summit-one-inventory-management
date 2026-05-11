import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/m/scan?code=<value>
 *
 * Public barcode/QR lookup for mobile devices.
 * Searches assets by asset_tag and serial_number.
 * Returns minimal, non-sensitive info (tag, item name, status).
 */
export const GET = createReadRoute(async ({ req, log }) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code')?.trim();

  if (!code) {
    throw AppError.badRequest('Missing required query parameter: code');
  }

  log.info('mobile_scan.lookup', { code });

  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  // Try exact match on asset_tag
  const { data: assetByTag } = await inv
    .from('assets')
    .select('id, asset_tag, serial_number, status, catalog_item_id, location_id, tenant_id')
    .eq('asset_tag', code)
    .limit(1)
    .maybeSingle();

  const asset = assetByTag || null;

  // Fallback: try serial_number
  if (!asset) {
    const { data: assetBySerial } = await inv
      .from('assets')
      .select('id, asset_tag, serial_number, status, catalog_item_id, location_id, tenant_id')
      .eq('serial_number', code)
      .limit(1)
      .maybeSingle();

    if (assetBySerial) {
      // Fetch related data
      const enriched = await enrichAsset(inv, assetBySerial);
      return Response.json({ data: { type: 'asset', entity: enriched } });
    }
  }

  if (asset) {
    const enriched = await enrichAsset(inv, asset);
    return Response.json({ data: { type: 'asset', entity: enriched } });
  }

  throw AppError.notFound(`No item found for code: ${code}`);
}, { serviceName: SERVICE_NAME, auth: 'public' });

async function enrichAsset(inv: any, asset: any) {
  const [catalogResult, locationResult] = await Promise.all([
    asset.catalog_item_id
      ? inv.from('catalog_items').select('id, name, sku').eq('id', asset.catalog_item_id).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    asset.location_id
      ? inv.from('locations').select('id, name').eq('id', asset.location_id).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    id: asset.id,
    asset_tag: asset.asset_tag,
    serial_number: asset.serial_number,
    status: asset.status,
    catalog_item: catalogResult.data || null,
    location: locationResult.data || null,
  };
}
