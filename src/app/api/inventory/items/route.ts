/**
 * Inventory Items API - Demonstrates tenant isolation
 * GET /api/inventory/items - List items for authenticated tenant
 * POST /api/inventory/items - Create new item
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@supabase/supabase-js';

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
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    
    // Query items - ALWAYS filter by tenant_id
    // This is critical for data isolation
    const { data: items, error } = await supabase
      .from('catalog_items')
      .select(`
        *,
        item_categories(name)
      `)
      .eq('tenant_id', tenantId)
      .eq('active', true)
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
    const { name, sku, description, category_id } = body;
    
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    
    // CRITICAL: Always set tenant_id from session, NEVER from client input
    const { data: item, error } = await supabase
      .from('catalog_items')
      .insert({
        tenant_id: tenantId, // From authenticated session
        name,
        sku,
        description,
        category_id,
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
    
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

