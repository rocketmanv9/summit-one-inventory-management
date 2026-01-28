/**
 * Receiving API
 * GET /api/inventory/receiving - List receipts
 * POST /api/inventory/receiving - Create receipt (receive against PO)
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
    const { searchParams } = new URL(request.url);
    const poId = searchParams.get('po_id');

    const supabase = createClient();

    // Build query
    let query = supabase
      .schema('supply_chain')
      .from('receipts')
      .select(`
        id,
        receipt_number,
        received_at,
        po_id,
        location_id,
        received_by_user_id,
        notes,
        locations:location_id(id, name),
        users:received_by_user_id(id, email),
        receipt_lines(
          id,
          catalog_item_id,
          qty_received,
          catalog_items:catalog_item_id(id, name, sku)
        )
      `)
      .eq('tenant_id', tenantId);

    // Filter by PO if provided
    if (poId) {
      query = query.eq('po_id', poId);
    }

    const { data: receipts, error } = await query.order('received_at', { ascending: false });

    if (error) {
      console.error('Error fetching receipts:', error);
      return NextResponse.json(
        { error: 'Failed to fetch receipts', details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: receipts || [],
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

    const supabase = createClient();

    // Step 1: Create receipt header
    const eventId = `receipt-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const { data: receipt, error: receiptError } = await supabase
      .schema('supply_chain')
      .from('receipts')
      .insert({
        tenant_id: tenantId,
        po_id: purchase_order_id || null,
        location_id,
        received_by_user_id: userId,
        received_at: new Date().toISOString(),
        notes: notes || null,
        receipt_number: `RCV-${Date.now()}-${Math.floor(Math.random() * 1000)}`, // Auto-generate receipt number
        last_event_id: eventId
      })
      .select()
      .single();

    if (receiptError) {
      console.error('Error creating receipt:', receiptError);
      return NextResponse.json(
        { error: 'Failed to create receipt', details: receiptError.message },
        { status: 500 }
      );
    }

    // Step 2: Create receipt lines
    const receiptLinesToInsert = lines.map((line: any, index: number) => ({
      tenant_id: tenantId,
      receipt_id: receipt.id,
      po_line_id: line.purchase_order_line_id || null,
      catalog_item_id: line.catalog_item_id,
      qty_received: line.qty_received,
      line_number: index + 1
    }));

    const { error: linesError } = await supabase
      .schema('supply_chain')
      .from('receipt_lines')
      .insert(receiptLinesToInsert);

    if (linesError) {
      console.error('Error creating receipt lines:', linesError);
      // Rollback: delete the receipt header
      await supabase
        .schema('supply_chain')
        .from('receipts')
        .delete()
        .eq('id', receipt.id);
      
      return NextResponse.json(
        { error: 'Failed to create receipt lines', details: linesError.message },
        { status: 500 }
      );
    }

    // Step 3: Post receipt to inventory using ATOMIC RPC
    const { data: postResult, error: postError } = await supabase.rpc('rpc_post_receipt_to_inventory', {
      p_receipt_id: receipt.id,
      p_actor_user_id: userId
    });

    if (postError) {
      console.error('Error posting receipt to inventory:', postError);
      return NextResponse.json(
        { error: 'Failed to post receipt to inventory', details: postError.message },
        { status: 500 }
      );
    }

    // Step 4: Update PO line status if linked to PO
    if (purchase_order_id) {
      // Get all PO lines
      const { data: poLines } = await supabase
        .schema('supply_chain')
        .from('purchase_order_lines')
        .select('id, qty_ordered, qty_received')
        .eq('purchase_order_id', purchase_order_id);

      if (poLines) {
        for (const line of lines) {
          if (line.purchase_order_line_id) {
            const poLine = poLines.find((pl: any) => pl.id === line.purchase_order_line_id);
            if (poLine) {
              const newQtyReceived = (poLine.qty_received || 0) + line.qty_received;
              let lineStatus = 'open';
              
              if (newQtyReceived >= poLine.qty_ordered) {
                lineStatus = 'fully_received';
              } else if (newQtyReceived > 0) {
                lineStatus = 'partially_received';
              }

              await supabase
                .schema('supply_chain')
                .from('purchase_order_lines')
                .update({
                  qty_received: newQtyReceived,
                  status: lineStatus
                })
                .eq('id', line.purchase_order_line_id);
            }
          }
        }
      }

      // Step 5: Update PO header status based on line statuses
      const { data: updatedPoLines } = await supabase
        .schema('supply_chain')
        .from('purchase_order_lines')
        .select('status')
        .eq('purchase_order_id', purchase_order_id);

      if (updatedPoLines && updatedPoLines.length > 0) {
        const allFullyReceived = updatedPoLines.every((line: any) => line.status === 'fully_received');
        const anyPartiallyReceived = updatedPoLines.some((line: any) => line.status === 'partially_received');
        
        let poStatus = 'placed';
        if (allFullyReceived) {
          poStatus = 'fully_received';
        } else if (anyPartiallyReceived) {
          poStatus = 'partially_received';
        }

        await supabase
          .schema('supply_chain')
          .from('purchase_orders')
          .update({ status: poStatus })
          .eq('id', purchase_order_id);
      }
    }

    return NextResponse.json({ 
      data: receipt,
      postResult,
      message: `Receipt created successfully. Posted ${postResult?.posted_lines || 0} line(s) to inventory.`
    }, { status: 201 });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
