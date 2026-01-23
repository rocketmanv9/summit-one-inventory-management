/**
 * Individual Item API
 * PUT /api/inventory/items/[id] - Update an item
 * DELETE /api/inventory/items/[id] - Soft delete an item
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders, createClient } from '@/lib/db-middleware';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  const userId = getUserIdFromHeaders(request.headers);
  
  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, sku, description, category_id, unit_of_measure, tracking_mode, reorder_point, min_stock_level, max_stock_level, active } = body;
    
    const supabase = createClient();
    
    // Update the item
    const { data: item, error } = await supabase
      .schema('inventory')
      .from('catalog_items')
      .update({
        name,
        sku,
        description,
        category_id,
        unit_of_measure,
        tracking_mode,
        reorder_point,
        min_stock_level,
        max_stock_level,
        active,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating item:', error);
      return NextResponse.json(
        { error: 'Failed to update item' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ data: item });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  const userId = getUserIdFromHeaders(request.headers);
  
  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  
  try {
    const { id } = await params;
    const supabase = createClient();
    
    // Check if item has stock first
    const { data: stockBalances, error: stockError } = await supabase
      .from('stock_balances')
      .select('qty_on_hand')
      .eq('catalog_item_id', id)
      .eq('tenant_id', tenantId);
    
    if (stockError) {
      console.error('Error checking stock:', stockError);
      return NextResponse.json(
        { error: 'Failed to check stock balances' },
        { status: 500 }
      );
    }
    
    const totalStock = stockBalances?.reduce((sum, balance) => sum + Number(balance.qty_on_hand), 0) || 0;
    
    if (totalStock > 0) {
      return NextResponse.json(
        { error: `Cannot delete item with existing stock on hand (${totalStock} units). Please adjust stock to zero first.` },
        { status: 400 }
      );
    }
    
    // Soft delete the item
    const { error: deleteError } = await supabase
      .schema('inventory')
      .from('catalog_items')
      .update({ 
        deleted_at: new Date().toISOString(),
        deleted_by_user_id: userId,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId); // Always check tenant for security
    
    if (deleteError) {
      console.error('Error deleting item:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete item' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
