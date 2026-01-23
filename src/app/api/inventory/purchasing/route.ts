/**
 * Purchasing (Purchase Orders) API
 * GET /api/inventory/purchasing - List purchase orders
 * POST /api/inventory/purchasing - Create new PO
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

    // Fetch purchase orders
    const { data: purchaseOrders, error } = await supabase
      .schema('supply_chain')
      .from('purchase_orders')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching purchase orders:', error);
      return NextResponse.json(
        { error: 'Failed to fetch purchase orders', details: error },
        { status: 500 }
      );
    }

    if (!purchaseOrders || purchaseOrders.length === 0) {
      return NextResponse.json({
        data: [],
        meta: { tenantId, count: 0 }
      });
    }

    // Fetch related vendors
    const vendorIds = [...new Set(purchaseOrders.map(po => po.vendor_id).filter(Boolean))];
    const { data: vendors } = await supabase
      .schema('supply_chain')
      .from('vendors')
      .select('id, name, vendor_number')
      .in('id', vendorIds);

    // Fetch related locations
    const locationIds = [...new Set(purchaseOrders.map(po => po.ship_to_location_id).filter(Boolean))];
    const { data: locations } = await supabase
      .schema('inventory')
      .from('locations')
      .select('id, name')
      .in('id', locationIds);

    // Fetch PO lines
    const poIds = purchaseOrders.map(po => po.id);
    const { data: lines } = await supabase
      .schema('supply_chain')
      .from('purchase_order_lines')
      .select('*')
      .in('purchase_order_id', poIds);

    // Create lookup maps
    const vendorMap = new Map(vendors?.map(v => [v.id, v]) || []);
    const locationMap = new Map(locations?.map(l => [l.id, l]) || []);
    const linesMap = new Map<string, any[]>();
    lines?.forEach(line => {
      const existing = linesMap.get(line.purchase_order_id) || [];
      linesMap.set(line.purchase_order_id, [...existing, line]);
    });

    // Combine data
    const enrichedPOs = purchaseOrders.map(po => ({
      ...po,
      vendors: po.vendor_id ? vendorMap.get(po.vendor_id) : null,
      locations: po.ship_to_location_id ? locationMap.get(po.ship_to_location_id) : null,
      purchase_order_lines: linesMap.get(po.id) || []
    }));

    return NextResponse.json({
      data: enrichedPOs,
      meta: { tenantId, count: enrichedPOs.length }
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

    const supabase = createClient();

    // Generate PO number
    const poNumber = `PO-${Date.now().toString(36).toUpperCase()}`;

    // Create PO header
    const { data: po, error: poError } = await supabase
      .schema('supply_chain')
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
        .schema('supply_chain')
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
