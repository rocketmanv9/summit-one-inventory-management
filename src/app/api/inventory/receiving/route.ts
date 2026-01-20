/**
 * Receiving API
 * GET /api/inventory/receiving - List receipts
 * POST /api/inventory/receiving - Create receipt (receive against PO)
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
    const poId = searchParams.get('purchase_order_id');

    let query = supabase
      .from('receipts')
      .select(`
        *,
        purchase_orders(id, po_number, vendor_id, vendors(name)),
        locations(id, name),
        receipt_lines(
          id,
          purchase_order_line_id,
          qty_received,
          qty_accepted,
          qty_rejected,
          rejection_reason,
          catalog_items(id, name, sku)
        )
      `)
      .eq('tenant_id', tenantId);

    if (poId) {
      query = query.eq('purchase_order_id', poId);
    }

    const { data: receipts, error } = await query.order('received_at', { ascending: false });

    if (error) {
      console.error('Error fetching receipts:', error);
      return NextResponse.json(
        { error: 'Failed to fetch receipts' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: receipts,
      meta: { tenantId, count: receipts?.length || 0 }
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
    const { purchase_order_id, location_id, lines, notes } = body;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Create receipt header
    const { data: receipt, error: receiptError } = await supabase
      .from('receipts')
      .insert({
        tenant_id: tenantId,
        purchase_order_id,
        location_id,
        received_by: userId,
        received_at: new Date().toISOString(),
        notes,
        last_event_id: `receipt-${Date.now()}-${Math.random().toString(36).substring(7)}`
      })
      .select()
      .single();

    if (receiptError) {
      console.error('Error creating receipt:', receiptError);
      return NextResponse.json(
        { error: 'Failed to create receipt' },
        { status: 500 }
      );
    }

    // Create receipt lines and update stock via stock_movements
    if (lines && lines.length > 0) {
      for (const line of lines) {
        // Insert receipt line
        await supabase
          .from('receipt_lines')
          .insert({
            tenant_id: tenantId,
            receipt_id: receipt.id,
            purchase_order_line_id: line.purchase_order_line_id,
            catalog_item_id: line.catalog_item_id,
            qty_received: line.qty_received,
            qty_accepted: line.qty_accepted || line.qty_received,
            qty_rejected: line.qty_rejected || 0,
            rejection_reason: line.rejection_reason
          });

        // Insert stock movement for received qty
        if (line.qty_accepted > 0) {
          await supabase.rpc('insert_stock_movement', {
            p_tenant_id: tenantId,
            p_catalog_item_id: line.catalog_item_id,
            p_location_id: location_id,
            p_movement_type: 'received',
            p_qty: line.qty_accepted,
            p_reference_type: 'receipt',
            p_reference_id: receipt.id,
            p_user_id: userId,
            p_notes: `Received from PO`,
            p_last_event_id: `rcv-${line.catalog_item_id}-${Date.now()}`
          });
        }

        // Update PO line qty_received
        if (line.purchase_order_line_id) {
          const { data: poLine } = await supabase
            .from('purchase_order_lines')
            .select('qty_received')
            .eq('id', line.purchase_order_line_id)
            .single();

          await supabase
            .from('purchase_order_lines')
            .update({
              qty_received: (poLine?.qty_received || 0) + line.qty_received
            })
            .eq('id', line.purchase_order_line_id);
        }
      }
    }

    return NextResponse.json({ data: receipt }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
