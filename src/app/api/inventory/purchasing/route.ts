/**
 * Purchasing (Purchase Orders) API
 * GET /api/inventory/purchasing - List purchase orders
 * POST /api/inventory/purchasing - Create new PO
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
    const vendorId = searchParams.get('vendor_id');

    let query = supabase
      .from('purchase_orders')
      .select(`
        *,
        vendors(id, name, code),
        locations(id, name),
        purchase_order_lines(
          id,
          catalog_item_id,
          qty_ordered,
          qty_received,
          unit_cost,
          status,
          catalog_items(id, name, sku, unit_of_measure)
        )
      `)
      .eq('tenant_id', tenantId);

    if (status) {
      query = query.eq('status', status);
    }

    if (vendorId) {
      query = query.eq('vendor_id', vendorId);
    }

    const { data: purchaseOrders, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching purchase orders:', error);
      return NextResponse.json(
        { error: 'Failed to fetch purchase orders' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: purchaseOrders,
      meta: { tenantId, count: purchaseOrders?.length || 0 }
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
    const { vendor_id, ship_to_location_id, lines, expected_delivery_date, notes } = body;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Generate PO number
    const poNumber = `PO-${Date.now().toString(36).toUpperCase()}`;

    // Create PO header
    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .insert({
        tenant_id: tenantId,
        po_number: poNumber,
        vendor_id,
        ship_to_location_id,
        status: 'draft',
        expected_delivery_date,
        notes,
        created_by: userId,
        last_event_id: `po-create-${Date.now()}-${Math.random().toString(36).substring(7)}`
      })
      .select()
      .single();

    if (poError) {
      console.error('Error creating PO:', poError);
      return NextResponse.json(
        { error: 'Failed to create purchase order' },
        { status: 500 }
      );
    }

    // Create PO lines
    if (lines && lines.length > 0) {
      const poLines = lines.map((line: any) => ({
        tenant_id: tenantId,
        purchase_order_id: po.id,
        catalog_item_id: line.catalog_item_id,
        qty_ordered: line.qty,
        unit_cost: line.unit_cost,
        status: 'pending',
        last_event_id: `pol-${Date.now()}-${Math.random().toString(36).substring(7)}`
      }));

      const { error: linesError } = await supabase
        .from('purchase_order_lines')
        .insert(poLines);

      if (linesError) {
        console.error('Error creating PO lines:', linesError);
        // PO was created but lines failed - return partial success
      }
    }

    return NextResponse.json({ data: po }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
