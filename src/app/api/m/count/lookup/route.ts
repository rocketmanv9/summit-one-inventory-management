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

  // Search by barcode or SKU in catalog_items. NOTE: catalog_items lives in the
  // `inventory` schema — querying via `supabase` (default `public`) finds nothing,
  // so use `inv`. maybeSingle() avoids erroring when there's no exact match.
  if (barcode || sku) {
    let query = inv
      .from('catalog_items')
      .select('id, name, sku, barcode, tracking_mode, uom_term_id');

    if (barcode) {
      query = query.eq('barcode', barcode);
    } else if (sku) {
      query = query.eq('sku', sku);
    }

    const { data } = await query.limit(1).maybeSingle();
    catalogItem = data;
  }

  // Search by asset tag in assets (also in the `inventory` schema)
  if (assetTag) {
    const { data } = await inv
      .from('assets')
      .select('id, asset_tag, serial_number, status, catalog_item_id, location_id')
      .or(`asset_tag.eq.${assetTag},serial_number.eq.${assetTag}`)
      .limit(1)
      .maybeSingle();
    asset = data;

    // Also fetch the catalog item for this asset
    if (asset?.catalog_item_id) {
      const { data: item } = await inv
        .from('catalog_items')
        .select('id, name, sku, barcode, tracking_mode, uom_term_id')
        .eq('id', asset.catalog_item_id)
        .maybeSingle();
      catalogItem = item;
    }
  }

  if (!catalogItem && !asset) {
    throw AppError.notFound('No matching item found');
  }

  // Find the matching cycle count line. maybeSingle() — the item can legitimately
  // exist in the catalog without being part of this count session, in which case
  // count_line is null and the client decides what to do (initial counts auto-add
  // the item; recounts show "Not in count list"). Don't throw 404 here — that
  // would break the auto-add flow in MobileCountClient.
  let countLine: any = null;
  if (catalogItem) {
    const { data: line, error: lineError } = await inv
      .from('cycle_count_lines')
      .select('id, catalog_item_id, qty_expected, qty_counted, variance')
      .eq('cycle_count_id', session.cycleCountId)
      .eq('catalog_item_id', catalogItem.id)
      .limit(1)
      .maybeSingle();
    if (lineError) throw AppError.internal(lineError.message);
    countLine = line;
  }

  return Response.json({
    data: {
      catalog_item: catalogItem,
      asset,
      count_line: countLine,
      // User-facing hint for consumers that don't auto-add missing lines.
      count_line_message:
        catalogItem && !countLine
          ? "This item isn't part of this count session"
          : null,
    },
  });
}, { serviceName: SERVICE_NAME, auth: 'public' });
