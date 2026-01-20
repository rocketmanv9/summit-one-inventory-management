/**
 * Stock Balances API
 * GET /api/inventory/stock - List stock balances with position data
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get('location_id');
    const categoryId = searchParams.get('category_id');
    const belowReorder = searchParams.get('below_reorder') === 'true';

    // Use the inventory position view for comprehensive stock data
    let query = supabase
      .from('v_inventory_position')
      .select('*')
      .eq('tenant_id', tenantId);

    if (locationId) {
      query = query.eq('location_id', locationId);
    }

    if (categoryId) {
      query = query.eq('category_id', categoryId);
    }

    if (belowReorder) {
      query = query.lt('available_qty', 'reorder_point');
    }

    const { data: stock, error } = await query.order('item_name');

    if (error) {
      console.error('Error fetching stock:', error);
      // Fallback to stock_balances if view doesn't exist
      const { data: fallbackStock, error: fallbackError } = await supabase
        .from('stock_balances')
        .select(`
          *,
          catalog_items(id, name, sku, unit_of_measure),
          locations(id, name, location_type)
        `)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (fallbackError) {
        return NextResponse.json(
          { error: 'Failed to fetch stock balances' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        data: fallbackStock,
        meta: { tenantId, count: fallbackStock?.length || 0 }
      });
    }

    return NextResponse.json({
      data: stock,
      meta: { tenantId, count: stock?.length || 0 }
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
