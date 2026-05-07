import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { requireMobileSession } from '@/lib/mobile-auth';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createReadRoute(async ({ req, log }) => {
  const session = await requireMobileSession(req);
  const url = new URL(req.url);
  const barcode = url.searchParams.get('barcode');
  const sku = url.searchParams.get('sku');
  const assetTag = url.searchParams.get('asset_tag');

  if (!barcode && !sku && !assetTag) {
    throw AppError.badRequest('Provide barcode, sku, or asset_tag query parameter');
  }

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });

  const inv = (supabase as any).schema('inventory');
  let catalogItem: any = null;
  let asset: any = null;

  // Search by barcode or SKU in catalog_items
  if (barcode || sku) {
    let query = supabase
      .from('catalog_items')
      .select('id, name, sku, barcode, tracking_mode, unit_of_measure');

    if (barcode) {
      query = query.eq('barcode', barcode);
    } else if (sku) {
      query = query.eq('sku', sku);
    }

    const { data } = await query.limit(1).single();
    catalogItem = data;
  }

  // Search by asset tag in assets
  if (assetTag) {
    const { data } = await supabase
      .from('assets')
      .select('id, asset_tag, serial_number, status, catalog_item_id, location_id')
      .or(`asset_tag.eq.${assetTag},serial_number.eq.${assetTag}`)
      .limit(1)
      .single();
    asset = data;

    // Also fetch the catalog item for this asset
    if (asset?.catalog_item_id) {
      const { data: item } = await supabase
        .from('catalog_items')
        .select('id, name, sku, barcode, tracking_mode, unit_of_measure')
        .eq('id', asset.catalog_item_id)
        .single();
      catalogItem = item;
    }
  }

  if (!catalogItem && !asset) {
    throw AppError.notFound('No matching item found');
  }

  // Find the matching cycle count line
  let countLine: any = null;
  if (catalogItem) {
    const { data: line } = await inv
      .from('cycle_count_lines')
      .select('id, catalog_item_id, qty_expected, qty_counted, variance')
      .eq('cycle_count_id', session.cycleCountId)
      .eq('catalog_item_id', catalogItem.id)
      .limit(1)
      .single();
    countLine = line;
  }

  return Response.json({
    data: {
      catalog_item: catalogItem,
      asset,
      count_line: countLine,
    },
  });
}, { serviceName: SERVICE_NAME, auth: 'public' });
