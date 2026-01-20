/**
 * Transfers API
 * GET /api/inventory/transfers - List transfers
 * POST /api/inventory/transfers - Create new transfer via RPC
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

    let query = supabase
      .from('transfers')
      .select(`
        *,
        from_location:locations!transfers_from_location_id_fkey(id, name, location_type),
        to_location:locations!transfers_to_location_id_fkey(id, name, location_type),
        transfer_lines(
          id,
          catalog_item_id,
          qty,
          catalog_items(id, name, sku)
        )
      `)
      .eq('tenant_id', tenantId);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: transfers, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching transfers:', error);
      return NextResponse.json(
        { error: 'Failed to fetch transfers' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: transfers,
      meta: { tenantId, count: transfers?.length || 0 }
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
    const { from_location_id, to_location_id, lines, notes } = body;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Use the RPC for creating transfers
    const { data, error } = await supabase.rpc('rpc_inv_transfer_create', {
      p_tenant_id: tenantId,
      p_from_location_id: from_location_id,
      p_to_location_id: to_location_id,
      p_lines: lines, // Array of { catalog_item_id, qty }
      p_initiated_by_user_id: userId,
      p_notes: notes,
      p_last_event_id: `transfer-${Date.now()}-${Math.random().toString(36).substring(7)}`
    });

    if (error) {
      console.error('Error creating transfer:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to create transfer' },
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
