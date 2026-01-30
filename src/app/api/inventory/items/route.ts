/**
 * Inventory Items API - Demonstrates tenant isolation
 * GET /api/inventory/items - List items for authenticated tenant
 * POST /api/inventory/items - Create new item
 * 
 * SECURITY: Uses JWT + RLS (no service role, no manual tenant filtering)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';
import { handleApiError } from '@/lib/api-error-handler';

export async function GET(request: NextRequest) {
  try {
    // Authenticate via JWT - RLS will enforce tenant isolation
    const { supabase, tenantId } = await createUserClient(request);
    
    // NO manual tenant_id filter needed - RLS handles it automatically
    const { data: items, error } = await supabase
      .schema('inventory')
      .from('catalog_items')
      .select(`
        *,
        item_categories:item_categories(name)
      `)
      .is('deleted_at', null)
      .order('name');
    
    if (error) {
      console.error('Error fetching items:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      return NextResponse.json(
        { error: 'Failed to fetch items', details: error },
        { status: 500 }
      );
    }
    
    console.log(`[Items API] Fetched ${items?.length || 0} items for tenant ${tenantId}`);
    
    return NextResponse.json({ 
      data: items,
      meta: {
        tenantId: tenantId,
        count: items?.length || 0
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate via JWT - RLS will enforce tenant isolation
    const { supabase, tenantId, userId } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY: Require Idempotency-Key header for item creation
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for item creation' },
        { status: 400 }
      );
    }
    
    const body = await request.json();
    const { name, sku, description, category_id, unit_of_measure, tracking_mode, reorder_point, min_stock_level, max_stock_level } = body;
    
    // NO manual tenant_id needed - RLS policy will inject it automatically
    // RLS ensures inserted row gets context.tenantId
    const { data: item, error } = await supabase
      .schema('inventory')
      .from('catalog_items')
      .insert({
        name,
        sku,
        description,
        category_id,
        unit_of_measure: unit_of_measure || 'EA',
        tracking_mode: tracking_mode || 'stock',
        reorder_point,
        min_stock_level,
        max_stock_level,
        created_by: userId,
        updated_by: userId,
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


