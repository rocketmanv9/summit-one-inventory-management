/**
 * Inventory Items API - Demonstrates tenant isolation
 * GET /api/inventory/items - List items for authenticated tenant
 * POST /api/inventory/items - Create new item
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders, createClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  // Get tenant ID from request headers (set by middleware)
  const tenantId = getTenantIdFromHeaders(request.headers);
  
  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  
  try {
    const supabase = createClient();
    
    // Query items - ALWAYS filter by tenant_id
    // This is critical for data isolation
    const { data: items, error } = await supabase
      .from('catalog_items')
      .select(`
        *,
        item_categories:item_categories(name)
      `)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('name');
    
    if (error) {
      console.error('Error fetching items:', error);
      return NextResponse.json(
        { error: 'Failed to fetch items' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ 
      data: items,
      meta: {
        tenantId,
        count: items?.length || 0
      }
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  
  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  
  try {
    const body = await request.json();
    const { name, sku, description, category_id, unit_of_measure, tracking_mode, reorder_point, min_stock_level, max_stock_level } = body;
    
    const supabase = createClient();
    
    // CRITICAL: Always set tenant_id from session, NEVER from client input
    const { data: item, error } = await supabase      .schema('inventory')      .from('catalog_items')
      .insert({
        tenant_id: tenantId, // From authenticated session
        name,
        sku,
        description,
        category_id,
        unit_of_measure: unit_of_measure || 'EA',
        tracking_mode: tracking_mode || 'stock',
        reorder_point,
        min_stock_level,
        max_stock_level,
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating item:', error);
      return NextResponse.json(
        { error: 'Failed to create item' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ data: item }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

