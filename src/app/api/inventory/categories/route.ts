/**
 * Item Categories API
 * GET /api/inventory/categories - List categories for tenant
 * POST /api/inventory/categories - Create new category
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await createUserClient(request);
    
    const { data: categories, error } = await supabase
      .from('item_categories')
      .select('id, name, created_at, updated_at')
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
  try {
    const { supabase, tenantId, userId } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY: Require Idempotency-Key header for category creation
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for category creation' },
        { status: 400 }
      );
    }
    
    const body = await request.json();
    const { name } = body;
    
    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Category name is required' },
        { status: 400 }
      );
    }
    
    // Check for duplicate name
    const { data: existing } = await supabase
      .from('item_categories')
      .select('id')
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

