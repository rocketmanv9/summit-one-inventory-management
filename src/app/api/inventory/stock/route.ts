/**
 * Stock Balances API
 * GET /api/inventory/stock - List stock balances with position data
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  console.log('[Stock API] Request headers:', {
    'x-tenant-id': request.headers.get('x-tenant-id'),
    'x-user-id': request.headers.get('x-user-id'),
    'x-user-role': request.headers.get('x-user-role')
  });
  
  const tenantId = getTenantIdFromHeaders(request.headers);
  console.log('[Stock API] Tenant ID from headers:', tenantId);

  if (!tenantId) {
    console.error('[Stock API] No tenant ID found - returning 401');
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const supabase = createClient();

    // Fetch stock_balances data with qty_on_order and inventory_position
    const { data: stockBalances, error } = await supabase
      .schema('inventory')
      .from('stock_balances')
      .select(`
        id,
        catalog_item_id,
        location_id,
        qty_on_hand,
        qty_reserved,
        qty_available,
        updated_at,
        catalog_items(id, sku, name, unit_of_measure),
        locations(id, name, location_type_id, location_types(name))
      `)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Error fetching stock:', error);
      return NextResponse.json(
        { error: 'Failed to fetch stock data', details: error },
        { status: 500 }
      );
    }

    // Fetch qty_on_order from view
    const { data: onOrderData, error: onOrderError } = await supabase
      .schema('inventory')
      .from('v_on_order_by_item_location')
      .select('catalog_item_id, location_id, qty_on_order')
      .eq('tenant_id', tenantId);

    if (onOrderError) {
      console.error('Error fetching on-order data:', onOrderError);
    }

    // Create lookup map for on_order quantities
    const onOrderMap = new Map<string, number>();
    (onOrderData || []).forEach(item => {
      const key = `${item.catalog_item_id}_${item.location_id}`;
      onOrderMap.set(key, Number(item.qty_on_order) || 0);
    });

    // Map database field names to UI expected field names and add qty_on_order + inventory_position
    const mappedData = (stockBalances || []).map(item => {
      const key = `${item.catalog_item_id}_${item.location_id}`;
      const qtyOnOrder = onOrderMap.get(key) || 0;
      const onHandQty = Number(item.qty_on_hand);
      const reservedQty = Number(item.qty_reserved);
      const availableQty = Number(item.qty_available);
      
      return {
        id: item.id,
        catalog_item_id: item.catalog_item_id,
        location_id: item.location_id,
        on_hand_qty: onHandQty,
        reserved_qty: reservedQty,
        available_qty: availableQty,
        qty_on_order: qtyOnOrder,
        inventory_position: onHandQty - reservedQty + qtyOnOrder,
        catalog_items: item.catalog_items,
        locations: item.locations,
        updated_at: item.updated_at
      };
    });

    return NextResponse.json({ data: mappedData });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
