/**
 * Reservations API
 * GET /api/inventory/reservations - List reservations
 * POST /api/inventory/reservations - Create new reservation via RPC
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
    const allocationType = searchParams.get('allocation_type');

    let query = supabase
      .from('reservations')
      .select(`
        *,
        catalog_items(id, name, sku),
        locations(id, name)
      `)
      .eq('tenant_id', tenantId);

    if (status) {
      query = query.eq('status', status);
    }

    if (allocationType) {
      query = query.eq('allocation_type', allocationType);
    }

    const { data: reservations, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching reservations:', error);
      return NextResponse.json(
        { error: 'Failed to fetch reservations' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: reservations,
      meta: { tenantId, count: reservations?.length || 0 }
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
    const {
      catalog_item_id,
      location_id,
      qty,
      allocation_type,
      job_ref,
      external_order_ref,
      needed_by,
      expiration_date
    } = body;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Use the RPC for creating reservations
    const { data, error } = await supabase.rpc('rpc_inv_reserve', {
      p_tenant_id: tenantId,
      p_catalog_item_id: catalog_item_id,
      p_location_id: location_id,
      p_qty: qty,
      p_allocation_type: allocation_type || 'soft',
      p_job_ref: job_ref,
      p_external_order_ref: external_order_ref,
      p_needed_by: needed_by,
      p_expiration_date: expiration_date,
      p_last_event_id: `reserve-${Date.now()}-${Math.random().toString(36).substring(7)}`
    });

    if (error) {
      console.error('Error creating reservation:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to create reservation' },
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
