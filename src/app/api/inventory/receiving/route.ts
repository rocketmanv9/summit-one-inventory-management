/**
 * Receiving API
 * GET /api/inventory/receiving - List open POs for receiving
 * POST - Use /api/supply-chain/receipts instead
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';


export async function GET(request: NextRequest) {
  try {
    const auth = await createAuthenticatedClientOrThrow(request);
    if (auth instanceof NextResponse) return auth;
    
    const { client: supabase, context } = auth;
    const { tenantId } = context;
    const { searchParams } = new URL(request.url);
    const vendorId = searchParams.get('vendor_id');
    const search = searchParams.get('search');

    // Call the new RPC to get open POs for receiving
    const { data: openPOs, error } = await supabase
      .schema('supply_chain')
      .rpc('rpc_get_open_pos_for_receiving', {
        p_tenant_id: tenantId,
        p_vendor_id: vendorId || null,
        p_search: search || null,
        p_limit: 100
      });

    if (error) {
      console.error('Error fetching open POs:', error);
      return NextResponse.json(
        { error: 'Failed to fetch open POs', details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: openPOs || [],
      meta: { tenantId, count: openPOs?.length || 0 }
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
    const auth = await createAuthenticatedClientOrThrow(request);
    if (auth instanceof NextResponse) return auth;
    
    const { client: supabase, context } = auth;
    const { tenantId, userId } = context;

    // ENFORCE IDEMPOTENCY: Require Idempotency-Key header
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
    const { purchase_order_id, location_id, lines, notes } = body;

    if (!location_id) {
      return NextResponse.json(
        { error: 'location_id is required' },
        { status: 400 }
      );
    }

    if (!lines || lines.length === 0) {
      return NextResponse.json(
        { error: 'At least one line item is required' },
        { status: 400 }
      );
    }

    // Generate receipt number from idempotency key or create unique number
    const receiptNumber = `RCV-${idempotencyKey.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 16)}`;

    // Use RPC for atomic receipt creation and posting
    const { data: result, error: rpcError } = await supabase
      .schema('supply_chain')
      .rpc('rpc_create_receipt_v2', {
        p_receipt_number: receiptNumber,
        p_location_id: location_id,
        p_lines: lines,
        p_po_id: purchase_order_id || null,
        p_vendor_id: null, // Will be auto-populated from PO if linked
        p_received_at: new Date().toISOString(),
        p_notes: notes || null,
        p_status: 'confirmed',
        p_auto_post: true // Automatically post to inventory
      });

    if (rpcError) {
      console.error('Error creating receipt via RPC:', rpcError);
      return NextResponse.json(
        { error: 'Failed to create receipt', details: rpcError.message },
        { status: 500 }
      );
    }

    const receipt = result?.receipt;
    if (!receipt) {
      return NextResponse.json(
        { error: 'Receipt creation did not return data' },
        { status: 500 }
      );
    }

    console.log('Receipt created and posted successfully via RPC:', receipt.id);

    return NextResponse.json({ 
      data: receipt,
      message: `Receipt created successfully. ${result.posted_lines || 0} line(s) posted to inventory.`,
      posted_result: result.post_result
    }, { status: 201 });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

