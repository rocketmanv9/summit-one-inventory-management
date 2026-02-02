/**
 * Item Categories API
 * GET /api/inventory/categories - List categories for tenant
 * POST /api/inventory/categories - Create new category
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUnscopedClient } from '@/lib/db-middleware';
import { cookies } from 'next/headers';

async function getSessionData() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('inventory_session');
  
  if (!sessionCookie) {
    return null;
  }
  
  try {
    const session = JSON.parse(sessionCookie.value);
    if (session.expiresAt && session.expiresAt < Date.now()) {
      return null;
    }
    return session;
  } catch (error) {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const session = await getSessionData();
  
  if (!session || !session.tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  
  try {
    const supabase = createUnscopedClient();
    
    const { data: categories, error } = await supabase
      .schema('inventory')
      .from('item_categories')
      .select('id, name, created_at, updated_at')
      .eq('tenant_id', session.tenantId)
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
  const session = await getSessionData();
  
  if (!session || !session.tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  
  try {
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
    
    const supabase = createUnscopedClient();
    
    // Check for duplicate name
    const { data: existing } = await supabase
      .schema('inventory')
      .from('item_categories')
      .select('id')
      .eq('tenant_id', session.tenantId)
      .eq('name', name.trim())
      .single();
    
    if (existing) {
      return NextResponse.json(
        { error: 'A category with this name already exists' },
        { status: 409 }
      );
    }
    
    const { data: category, error } = await supabase
      .schema('inventory')
      .from('item_categories')
      .insert({
        tenant_id: session.tenantId,
        name: name.trim(),
        created_by: session.userId,
        updated_by: session.userId,
        last_event_id: idempotencyKey,
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

