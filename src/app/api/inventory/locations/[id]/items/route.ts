import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

/**
 * GET /api/inventory/locations/:id/items
 * Returns catalog items that have stock at the specified location
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { id: locationId } = await params;
    const supabase = createClient();

    // Get fungible/stock items that have stock balances at this location
    const { data: stockBalances, error: stockError } = await supabase
      .schema('inventory')
      .from('stock_balances')
      .select(`
        qty_on_hand,
        qty_reserved,
        catalog_items (
          id,
          name,
          sku,
          unit_of_measure,
          tracking_mode
        )
      `)
      .eq('tenant_id', tenantId)
      .eq('location_id', locationId)
      .gt('qty_on_hand', 0);

    if (stockError) {
      console.error('Error fetching stock balances:', stockError);
      return NextResponse.json(
        { error: 'Failed to fetch items' },
        { status: 500 }
      );
    }

    // Get serialized items (assets) at this location
    const { data: assets, error: assetsError } = await supabase
      .schema('inventory')
      .from('assets')
      .select(`
        id,
        catalog_item_id,
        catalog_items (
          id,
          name,
          sku,
          unit_of_measure,
          tracking_mode
        )
      `)
      .eq('tenant_id', tenantId)
      .eq('location_id', locationId)
      .in('status', ['available', 'assigned']); // Include both available and assigned assets

    if (assetsError) {
      console.error('Error fetching assets:', assetsError);
      // Don't fail the whole request if assets fail
    }

    // Transform stock balances to catalog items format
    const stockItems = (stockBalances || []).map((sb: any) => ({
      id: sb.catalog_items.id,
      name: sb.catalog_items.name,
      sku: sb.catalog_items.sku,
      unit_of_measure: sb.catalog_items.unit_of_measure,
      tracking_mode: sb.catalog_items.tracking_mode,
      qty_on_hand: sb.qty_on_hand,
      qty_available: sb.qty_on_hand - sb.qty_reserved,
    }));

    // Get unique serialized catalog items from assets
    const assetItemMap = new Map();
    (assets || []).forEach((asset: any) => {
      if (asset.catalog_items && !assetItemMap.has(asset.catalog_items.id)) {
        assetItemMap.set(asset.catalog_items.id, {
          id: asset.catalog_items.id,
          name: asset.catalog_items.name,
          sku: asset.catalog_items.sku,
          unit_of_measure: asset.catalog_items.unit_of_measure,
          tracking_mode: asset.catalog_items.tracking_mode,
          qty_on_hand: null, // Serialized items don't have qty_on_hand
          qty_available: null,
        });
      }
    });

    // Combine both types
    const items = [...stockItems, ...Array.from(assetItemMap.values())];

    return NextResponse.json({
      data: items,
      meta: { tenantId, locationId, count: items.length }
    });
  } catch (error: any) {
    console.error('Error fetching items at location:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
