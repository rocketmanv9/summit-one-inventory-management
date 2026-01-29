/**
 * Receipts API
 * GET /api/supply-chain/receipts - List receipts
 * POST /api/supply-chain/receipts - Create receipt
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
    const { searchParams } = new URL(request.url);
    const poId = searchParams.get('po_id');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    // Build query
    let query = supabase
      .schema('supply_chain')
      .from('receipts')
      .select(`
        id,
        receipt_number,
        po_id,
        vendor_id,
        location_id,
        received_at,
        received_by_user_id,
        status,
        source_type,
        packing_slip_no,
        vendor_invoice_no,
        notes,
        created_at,
        updated_at
      `);

    // Filters
    if (poId) {
      query = query.eq('po_id', poId);
    }
    if (status) {
      query = query.eq('status', status);
    }

    const { data: receipts, error } = await query
      .order('received_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching receipts:', error);
      return NextResponse.json(
        { error: 'Failed to fetch receipts', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: receipts || [],
      meta: {
        tenantId,
        count: receipts?.length || 0,
        filters: { poId, status },
      },
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, tenantId, userId } = await createUserClient(request);

    // ENFORCE IDEMPOTENCY: Require Idempotency-Key header for receipt creation
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for receipt creation' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      receipt_number,
      location_id,
      lines,
      po_id,
      vendor_id,
      received_at,
      notes,
      packing_slip_no,
      vendor_invoice_no,
      source_type,
      status,
      auto_post,
    } = body;

    // Validation
    if (!receipt_number) {
      return NextResponse.json({ error: 'receipt_number is required' }, { status: 400 });
    }
    if (!location_id) {
      return NextResponse.json({ error: 'location_id is required' }, { status: 400 });
    }
    if (!lines || lines.length === 0) {
      return NextResponse.json({ error: 'At least one line is required' }, { status: 400 });
    }

    // Validate lines
    for (const line of lines) {
      if (!line.catalog_item_id) {
        return NextResponse.json({ error: 'catalog_item_id is required for all lines' }, { status: 400 });
      }
      if (!line.qty_received || line.qty_received <= 0) {
        return NextResponse.json({ error: 'qty_received must be > 0 for all lines' }, { status: 400 });
      }
    }

    // Call enhanced RPC to create receipt
    const { data, error } = await supabase
      .rpc('rpc_create_receipt_v2', {
        p_receipt_number: receipt_number,
        p_location_id: location_id,
        p_lines: lines,
        p_po_id: po_id || null,
        p_vendor_id: vendor_id || null,
        p_received_at: received_at || new Date().toISOString(),
        p_notes: notes || null,
        p_packing_slip_no: packing_slip_no || null,
        p_vendor_invoice_no: vendor_invoice_no || null,
        p_source_type: source_type || 'delivery',
        p_status: status || 'confirmed',
        p_auto_post: auto_post !== false,  // Default true
      });

    if (error) {
      console.error('Error creating receipt:', error);
      
      // Handle specific errors
      if (error.message?.includes('duplicate') || error.message?.includes('unique')) {
        return NextResponse.json(
          { error: 'Receipt number already exists', details: error.message },
          { status: 409 }
        );
      }
      
      return NextResponse.json(
        { error: 'Failed to create receipt', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data,
      meta: { tenantId, userId },
    }, { status: 201 });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

