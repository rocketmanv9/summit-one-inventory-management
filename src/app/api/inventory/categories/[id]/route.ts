/**
 * Individual Item Category API
 * PUT /api/inventory/categories/[id] - Update category
 * DELETE /api/inventory/categories/[id] - Delete category
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders, createClient } from '@/lib/db-middleware';

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  const userId = getUserIdFromHeaders(request.headers);
  
  if (!tenantId || !userId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  
  try {
    const { id: categoryId } = await context.params;
    const body = await request.json();
    const { name } = body;
    
    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Category name is required' },
        { status: 400 }
      );
    }
    
    const supabase = createClient();
    
    // Check for duplicate name (excluding current category)
    const { data: existing } = await supabase
      .from('item_categories')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', name.trim())
      .neq('id', categoryId)
      .single();
    
    if (existing) {
      return NextResponse.json(
        { error: 'A category with this name already exists' },
        { status: 409 }
      );
    }
    
    const { data: category, error } = await supabase
      .from('item_categories')
      .update({
        name: name.trim(),
        updated_by: userId,
      })
      .eq('id', categoryId)
      .eq('tenant_id', tenantId)
      .select('id, name, created_at, updated_at')
      .single();
    
    if (error) {
      console.error('Error updating category:', error);
      return NextResponse.json(
        { error: 'Failed to update category' },
        { status: 500 }
      );
    }
    
    if (!category) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ data: category });
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
  context: { params: Promise<{ id: string }> }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  
  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  
  try {
    const { id: categoryId } = await context.params;
    const supabase = createClient();
    
    // Check if category is in use
    const { data: itemsUsingCategory, error: checkError } = await supabase
      .from('catalog_items')
      .select('id')
      .eq('category_id', categoryId)
      .limit(1);
    
    if (checkError) {
      console.error('Error checking category usage:', checkError);
      return NextResponse.json(
        { error: 'Failed to check category usage' },
        { status: 500 }
      );
    }
    
    if (itemsUsingCategory && itemsUsingCategory.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete category that is assigned to items. Please reassign or delete those items first.' },
        { status: 409 }
      );
    }
    
    const { error } = await supabase
      .from('item_categories')
      .delete()
      .eq('id', categoryId)
      .eq('tenant_id', tenantId);
    
    if (error) {
      console.error('Error deleting category:', error);
      return NextResponse.json(
        { error: 'Failed to delete category' },
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
