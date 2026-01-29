/**
 * Stock Balances API
 * GET /api/inventory/stock - List stock balances with position data
 * 
 * SECURITY: Uses JWT + RLS for tenant isolation
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  try {
    // Authenticate user and get tenant context from JWT
    const { supabase, tenantId, userId } = await createUserClient(request);
    
    console.log('[Stock API] Authenticated user:', { tenantId, userId });

    // Fetch stock_balances data with qty_on_order and inventory_position
    // RLS automatically filters by tenant_id from JWT
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
      `);

    if (error) {
      console.error('Error fetching stock:', error);
      return NextResponse.json(
        { error: 'Failed to fetch stock data', details: error },
        { status: 500 }
      );
    }

    // Fetch qty_on_order from view
    // RLS automatically filters by tenant_id
    const { data: onOrderData, error: onOrderError } = await supabase
      .schema('inventory')
      .from('v_on_order_by_item_location')
      .select('catalog_item_id, location_id, qty_on_order');

    if (onOrderError) {
      console.error('Error fetching on-order data:', onOrderError);
    }

    // Create lookup map for on_order quantities
    const onOrderMap = new Map<string, number>();
    (onOrderData || []).forEach((item: any) => {
      const key = `${item.catalog_item_id}_${item.location_id}`;
      onOrderMap.set(key, Number(item.qty_on_order) || 0);
    });

    // Map database field names to UI expected field names and add qty_on_order + inventory_position
    const mappedData = (stockBalances || []).map((item: any) => {
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
  } catch (error: any) {
    console.error('[Stock API] Error:', error);
    
    // Handle authentication errors
    if (error.message?.includes('authenticated') || error.message?.includes('session')) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
