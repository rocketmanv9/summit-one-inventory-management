/**
 * Cycle Counts API
 * GET /api/inventory/cycle-counts - List cycle counts
 * POST /api/inventory/cycle-counts - Start new cycle count via RPC
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders } from '@/lib/db-middleware';
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
    const status = searchParams.get('status');
    const locationId = searchParams.get('location_id');

    let query = supabase
      .from('cycle_counts')
      .select(`
        *,
        locations(id, name, location_type),
        cycle_count_lines(
          id,
          catalog_item_id,
          expected_qty,
          counted_qty,
          variance_qty,
          variance_approved,
          catalog_items(id, name, sku)
        )
      `)
      .eq('tenant_id', tenantId);

    if (status) {
      query = query.eq('status', status);
    }

    if (locationId) {
      query = query.eq('location_id', locationId);
    }

    const { data: cycleCounts, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching cycle counts:', error);
      return NextResponse.json(
        { error: 'Failed to fetch cycle counts' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: cycleCounts,
      meta: { tenantId, count: cycleCounts?.length || 0 }
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
  const userId = getUserIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { location_id, count_type, catalog_item_ids, item_category_id } = body;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Use the RPC for starting cycle counts
    const { data, error } = await supabase.rpc('rpc_inv_cycle_count_start', {
      p_tenant_id: tenantId,
      p_location_id: location_id,
      p_count_type: count_type || 'full',
      p_catalog_item_ids: catalog_item_ids || null,
      p_item_category_id: item_category_id || null,
      p_counted_by_user_id: userId,
      p_last_event_id: `cc-start-${Date.now()}-${Math.random().toString(36).substring(7)}`
    });

    if (error) {
      console.error('Error starting cycle count:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to start cycle count' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: { id: data } }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
