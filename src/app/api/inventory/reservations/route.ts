/**
 * Reservations API
 * GET /api/inventory/reservations - List reservations
 * POST /api/inventory/reservations - Create new reservation via RPC
 * 
 * SECURITY: Uses JWT + RLS for tenant isolation
 * IDEMPOTENCY: Requires Idempotency-Key header for POST
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  try {
    // Authenticate user via JWT
    const { supabase, tenantId } = await createUserClient(request);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const allocationType = searchParams.get('allocation_type');

    // RLS automatically filters by tenant_id
    let query = supabase
      .schema('inventory')
      .from('reservations')
      .select(`
        *,
        catalog_items(id, name, sku, tracking_mode),
        locations(id, name),
        assets(id, asset_tag, serial_number, vin)
      `);

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
  } catch (error: any) {
    console.error('[Reservations GET] Error:', error);
    
    if (error.message?.includes('authenticated') || error.message?.includes('session')) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate user via JWT
    const { supabase, tenantId, userId } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY: Require idempotency key for all writes
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for reservation creation' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      // Common fields
      allocation_type,
      job_ref,
      external_order_ref,
      needed_by,
      expiration_date,
      reserved_from,
      reserved_until,
      notes,
      // Fungible-specific
      catalog_item_id,
      location_id,
      qty,
      // Serialized-specific
      asset_id,
    } = body;

    let reservationId: string;

    // Determine reservation type based on input
    if (asset_id) {
      // Create serialized asset reservation
      console.log('[Reservations] Creating serialized reservation:', { asset_id, idempotencyKey });
      
      const { data, error } = await supabase.rpc('rpc_inv_reserve_asset', {
        p_tenant_id: tenantId,
        p_asset_id: asset_id,
        p_allocation_type: allocation_type || 'other',
        p_job_ref: job_ref,
        p_external_order_ref: external_order_ref,
        p_needed_by: needed_by,
        p_expiration_date: expiration_date,
        p_reserved_from: reserved_from,
        p_reserved_until: reserved_until,
        p_notes: notes,
        p_last_event_id: idempotencyKey  // Use client-provided idempotency key
      });

      if (error) {
        console.error('Error creating serialized reservation:', error);
        return NextResponse.json(
          { error: error.message || 'Failed to create serialized reservation' },
          { status: 400 }
        );
      }

      reservationId = data;
    } else if (catalog_item_id && location_id && qty) {
      // Create fungible stock reservation
      console.log('[Reservations] Creating fungible reservation:', { catalog_item_id, location_id, qty, idempotencyKey });
      
      const { data, error } = await supabase.rpc('rpc_inv_reserve_fungible', {
        p_tenant_id: tenantId,
        p_catalog_item_id: catalog_item_id,
        p_location_id: location_id,
        p_qty: qty,
        p_allocation_type: allocation_type || 'other',
        p_job_ref: job_ref,
        p_external_order_ref: external_order_ref,
        p_needed_by: needed_by,
        p_expiration_date: expiration_date,
        p_reserved_from: reserved_from,
        p_reserved_until: reserved_until,
        p_notes: notes,
        p_last_event_id: idempotencyKey  // Use client-provided idempotency key
      });

      if (error) {
        console.error('Error creating fungible reservation:', error);
        return NextResponse.json(
          { error: error.message || 'Failed to create fungible reservation' },
          { status: 400 }
        );
      }

      reservationId = data;
    } else {
      return NextResponse.json(
        { error: 'Must provide either (asset_id) for serialized reservation or (catalog_item_id, location_id, qty) for fungible reservation' },
        { status: 400 }
      );
    }

    return NextResponse.json({ data: { id: reservationId } }, { status: 201 });
  } catch (error: any) {
    console.error('[Reservations POST] Error:', error);
    
    if (error.message?.includes('authenticated') || error.message?.includes('session')) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
