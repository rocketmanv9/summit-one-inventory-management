/**
 * Cycle Counts API
 * GET /api/inventory/cycle-counts - List cycle counts
 * POST /api/inventory/cycle-counts - Start new cycle count via RPC
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient, getIdempotencyKey } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
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
  try {
    const { supabase, tenantId, userId } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY: Require Idempotency-Key header or last_event_id in body
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for cycle count creation' },
        { status: 400 }
      );
    }


    const body = await request.json();
    const { location_id, count_type, is_blind, scheduled_for, catalog_item_ids } = body;

    if (!location_id) {
      return NextResponse.json(
        { error: 'location_id is required' },
        { status: 400 }
      );
    }

    // Get tenant settings for number format
    const { data: settings } = await supabase
      .schema('supply_chain')
      .from('tenant_settings')
      .select('cycle_count_number_format, cycle_count_number_prefix')
      .eq('tenant_id', tenantId)
      .single();

    const format = settings?.cycle_count_number_format || 'date-sequential';
    const prefix = settings?.cycle_count_number_prefix || 'CC';

    // Generate count_number based on configured format
    // SECURITY: Use deterministic generation to support idempotency
    let count_number = '';
    const now = new Date();

    if (format === 'date-sequential') {
      // Format: CC-20260129-00001
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const datePrefix = `${prefix}-${dateStr}-`;
      
      // Get next sequential number for this date
      const { data: latestCounts } = await supabase
        .schema('inventory')
        .from('cycle_counts')
        .select('count_number')
        .eq('tenant_id', tenantId)
        .like('count_number', `${datePrefix}%`)
        .order('created_at', { ascending: false })
        .limit(1);
      
      let nextNumber = 1;
      if (latestCounts && latestCounts.length > 0) {
        const parts = latestCounts[0].count_number.split('-');
        const lastNumber = parseInt(parts[parts.length - 1] || '0');
        nextNumber = lastNumber + 1;
      }
      
      count_number = `${datePrefix}${nextNumber.toString().padStart(5, '0')}`;
    } else if (format === 'sequential-year') {
      // Format: CC-26-0001
      const year = now.getFullYear().toString().slice(-2);
      const yearPrefix = `${prefix}-${year}-`;
      
      const { data: latestCounts } = await supabase
        .schema('inventory')
        .from('cycle_counts')
        .select('count_number')
        .eq('tenant_id', tenantId)
        .like('count_number', `${yearPrefix}%`)
        .order('created_at', { ascending: false })
        .limit(1);
      
      let nextNumber = 1;
      if (latestCounts && latestCounts.length > 0) {
        const parts = latestCounts[0].count_number.split('-');
        const lastNumber = parseInt(parts[parts.length - 1] || '0');
        nextNumber = lastNumber + 1;
      }
      
      count_number = `${yearPrefix}${nextNumber.toString().padStart(4, '0')}`;
    } else {
      // Format: CC-0001 (sequential)
      const seqPrefix = `${prefix}-`;
      
      const { data: latestCounts } = await supabase
        .schema('inventory')
        .from('cycle_counts')
        .select('count_number')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(1);
      
      let nextNumber = 1;
      if (latestCounts && latestCounts.length > 0) {
        const parts = latestCounts[0].count_number.split('-');
        const lastNumber = parseInt(parts[parts.length - 1] || '0');
        nextNumber = lastNumber + 1;
      }
      
      count_number = `${seqPrefix}${nextNumber.toString().padStart(4, '0')}`;
    }

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
        last_event_id: idempotencyKey,
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

