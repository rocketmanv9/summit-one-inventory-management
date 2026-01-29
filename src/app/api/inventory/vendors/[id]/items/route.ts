/**
 * Vendor Items API
 * GET /api/inventory/vendors/[id]/items - Get items this vendor supplies
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
    const { id: vendorId } = await Promise.resolve(params);

    // Get vendor items
    const { data: vendorItems, error: viError } = await supabase
      .schema('supply_chain')
      .from('vendor_items')
      .select('id, vendor_sku, unit_cost, catalog_item_id')
      .eq('vendor_id', vendorId)
      .order('vendor_sku');

    if (viError) {
      console.error('Error fetching vendor items:', viError);
      return NextResponse.json(
        { error: 'Failed to fetch vendor items', details: viError },
        { status: 500 }
      );
    }

    if (!vendorItems || vendorItems.length === 0) {
      return NextResponse.json({ data: [] });
    }

    // Get catalog items
    const catalogItemIds = vendorItems.map((vi: any) => vi.catalog_item_id);
    const { data: catalogItems } = await supabase
      .schema('inventory')
      .from('catalog_items')
      .select('id, sku, name, unit_of_measure')
      .in('id', catalogItemIds);

    // Combine data
    const catalogMap = new Map(catalogItems?.map((ci: any) => [ci.id, ci]) || []);
    const enrichedVendorItems = vendorItems.map((vi: any) => ({
      ...vi,
      catalog_items: catalogMap.get(vi.catalog_item_id) || null
    }));

    return NextResponse.json({ data: enrichedVendorItems });
  } catch (error: any) {
    console.error('Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
