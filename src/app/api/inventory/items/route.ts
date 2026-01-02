/**
 * Example API route with auth middleware
 * GET /api/inventory/items
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, withModule } from '@/lib/auth-middleware';
import { createClient } from '@supabase/supabase-js';

export const GET = withModule('inventory', async (req, authContext) => {
  // authContext contains: userId, tenantId, role, modules
  
  // Create Supabase client - RLS will automatically filter by tenant
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: req.headers.get('authorization')!
        }
      }
    }
  );

  // Query will be filtered by RLS using JWT tenant_id claim
  const { data, error } = await supabase
    .from('catalog_items')
    .select(`
      *,
      item_categories(name)
    `)
    .eq('active', true)
    .order('name');

  if (error) {
    return NextResponse.json(
      { error: 'Database error', details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    data,
    meta: {
      tenantId: authContext.tenantId,
      count: data.length
    }
  });
});

export const POST = withAuth(async (req, authContext) => {
  const body = await req.json();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: req.headers.get('authorization')!
        }
      }
    }
  );

  // tenant_id is automatically set from JWT in RLS context
  // created_by is automatically set from auth.uid() trigger
  const { data, error } = await supabase
    .from('catalog_items')
    .insert({
      tenant_id: authContext.tenantId, // Explicit for clarity
      sku: body.sku,
      name: body.name,
      tracking_mode: body.tracking_mode,
      uom: body.uom,
      category_id: body.category_id
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Failed to create item', details: error.message },
      { status: 400 }
    );
  }

  return NextResponse.json({ data }, { status: 201 });
});
