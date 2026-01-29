/**
 * Cycle Counts API
 * GET /api/inventory/cycle-counts - List cycle counts
 * POST /api/inventory/cycle-counts - Start new cycle count via RPC
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

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

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let query = supabase
      .schema('inventory')
      .from('cycle_counts')
      .select(`
        id,
        count_number,
        tenant_id,
        location_id,
        count_type,
        is_blind,
        status,
        scheduled_for,
        started_at,
        snapshot_at,
        completed_at,
        approved_at,
        approved_by_user_id,
        posted_at,
        created_at,
        location:locations(
          id, 
          name, 
          location_types(name)
        )
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data: cycleCounts, error } = await query;

    if (error) {
      console.error('Error fetching cycle counts:', error);
      return NextResponse.json(
        { error: 'Failed to fetch cycle counts', details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: cycleCounts || [],
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
    const { location_id, count_type, is_blind, scheduled_for, catalog_item_ids } = body;

    if (!location_id) {
      return NextResponse.json(
        { error: 'location_id is required' },
        { status: 400 }
      );
    }

    const supabase = createClient();

    // Generate count_number (format: CC-YYYYMMDD-XXXXX)
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const randomStr = Math.random().toString(36).substring(2, 7).toUpperCase();
    const count_number = `CC-${dateStr}-${randomStr}`;

    // Generate event ID
    const event_id = `cc-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Create cycle count directly with INSERT since RPC doesn't handle count_number
    const { data: cycleCount, error: insertError } = await supabase
      .schema('inventory')
      .from('cycle_counts')
      .insert({
        tenant_id: tenantId,
        count_number: count_number,
        location_id: location_id,
        count_type: count_type || 'full',
        is_blind: is_blind || false,
        scheduled_for: scheduled_for ? new Date(scheduled_for).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        status: 'draft',
        counted_by_user_id: userId,
        last_event_id: event_id,
        created_by: userId,
        updated_by: userId
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('Error creating cycle count:', insertError);
      return NextResponse.json(
        { error: insertError.message || 'Failed to create cycle count' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data: { 
        id: cycleCount.id,
        count_number: count_number,
        message: 'Cycle count created successfully'
      } 
    }, { status: 201 });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
