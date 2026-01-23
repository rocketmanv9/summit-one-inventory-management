/**
 * Item Categories API
 * GET /api/inventory/categories - List categories for tenant
 * POST /api/inventory/categories - Create new category
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders, createClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  
  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  
  try {
    const supabase = createClient();
    
    const { data: categories, error } = await supabase
      .from('item_categories')
      .select('id, name, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('name');
    
    if (error) {
      console.error('Error fetching categories:', error);
      return NextResponse.json(
        { error: 'Failed to fetch categories' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ data: categories });
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
  const userId = getUserIdFromHeaders(request.headers);
  
  if (!tenantId || !userId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  
  try {
    const body = await request.json();
    const { name } = body;
    
    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Category name is required' },
        { status: 400 }
      );
    }
    
    const supabase = createClient();
    
    // Check for duplicate name
    const { data: existing } = await supabase
      .from('item_categories')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', name.trim())
      .single();
    
    if (existing) {
      return NextResponse.json(
        { error: 'A category with this name already exists' },
        { status: 409 }
      );
    }
    
    const { data: category, error } = await supabase
      .from('item_categories')
      .insert({
        tenant_id: tenantId,
        name: name.trim(),
        created_by: userId,
        updated_by: userId,
      })
      .select('id, name, created_at, updated_at')
      .single();
    
    if (error) {
      console.error('Error creating category:', error);
      return NextResponse.json(
        { error: 'Failed to create category' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ data: category }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
