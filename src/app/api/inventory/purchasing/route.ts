/**
 * Purchasing (Purchase Orders) API
 * GET /api/inventory/purchasing - List purchase orders
 * POST /api/inventory/purchasing - Create new PO
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  try {
    const { supabase, tenantId } = await createUserClient(request);

    // Fetch purchase orders (exclude cancelled/deleted POs by default)
    const { data: purchaseOrders, error } = await supabase
      .schema('supply_chain')
      .from('purchase_orders')
      .select('*')
      .neq('status', 'cancelled')
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
    const vendorIds = [...new Set(purchaseOrders.map((po: any) => po.vendor_id).filter(Boolean))];
    console.log('Vendor IDs to fetch:', vendorIds);
    const { data: vendors } = await supabase
      .schema('supply_chain')
      .from('vendors')
      .select('id, name, code')
      .in('id', vendorIds);
    console.log('Fetched vendors:', vendors);

    // Fetch related locations
    const locationIds = [...new Set(purchaseOrders.map((po: any) => po.delivery_location_id).filter(Boolean))];
    const { data: locations } = await supabase
      .schema('inventory')
      .from('locations')
      .select('id, name')
      .in('id', locationIds);

    // Fetch PO lines
    const poIds = purchaseOrders.map((po: any) => po.id);
    console.log('PO IDs to fetch lines for:', poIds);
    const { data: lines, error: linesError } = await supabase
      .schema('supply_chain')
      .from('purchase_order_lines')
      .select('*')
      .in('po_id', poIds);
    
    console.log('Fetched lines:', lines);
    console.log('Lines error:', linesError);

    // Fetch catalog items for the lines (separate query because it's cross-schema)
    const catalogItemIds = [...new Set(lines?.map((l: any) => l.catalog_item_id).filter(Boolean) || [])];
    const { data: catalogItems } = await supabase
      .schema('inventory')
      .from('catalog_items')
      .select('id, name, sku, unit_of_measure')
      .in('id', catalogItemIds);
    
    const catalogItemMap = new Map(catalogItems?.map((ci: any) => [ci.id, ci]) || []);

    // Create lookup maps
    const vendorMap = new Map(vendors?.map((v: any) => [v.id, v]) || []);
    const locationMap = new Map(locations?.map((l: any) => [l.id, l]) || []);
    const linesMap = new Map<string, any[]>();
    lines?.forEach((line: any) => {
      const existing = linesMap.get(line.po_id) || [];
      // Attach catalog item data to each line
      const enrichedLine = {
        ...line,
        catalog_items: line.catalog_item_id ? catalogItemMap.get(line.catalog_item_id) : null
      };
      linesMap.set(line.po_id, [...existing, enrichedLine]);
    });

    // Combine data
    const enrichedPOs = purchaseOrders.map((po: any) => ({
      ...po,
      vendors: po.vendor_id ? vendorMap.get(po.vendor_id) : null,
      locations: po.delivery_location_id ? locationMap.get(po.delivery_location_id) : null,
      purchase_order_lines: linesMap.get(po.id) || []
    }));
    
    console.log('Enriched PO sample:', enrichedPOs[0]);

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
  try {
    const { supabase, tenantId, userId } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY: Require Idempotency-Key header for PO creation
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for purchase order creation' },
        { status: 400 }
      );
    }
    
    const body = await request.json();
    const { vendor_id, ship_to_location_id, lines, expected_delivery_date, notes } = body;

    console.log('Creating PO with:', { vendor_id, ship_to_location_id, lineCount: lines?.length, lines });

    // Get tenant settings for PO numbering format
    const { data: settings } = await supabase
      .schema('supply_chain')
      .rpc('get_or_create_tenant_settings', { p_tenant_id: tenantId });

    // Generate PO number using atomic database function to prevent race conditions
    const format = settings?.po_number_format || 'sequential-year';
    const prefix = settings?.po_number_prefix || '';
    
    const { data: poNumber, error: poNumberError } = await supabase
      .schema('supply_chain')
      .rpc('generate_po_number', {
        p_tenant_id: tenantId,
        p_format: format,
        p_prefix: prefix
      });
    
    if (poNumberError || !poNumber) {
      console.error('Error generating PO number:', poNumberError);
      return NextResponse.json(
        { error: 'Failed to generate PO number' },
        { status: 500 }
      );
    }

    // Use RPC for atomic PO creation with lines
    const { data: result, error: rpcError } = await supabase
      .schema('supply_chain')
      .rpc('rpc_create_purchase_order', {
        p_vendor_id: vendor_id,
        p_po_number: poNumber,
        p_delivery_location_id: ship_to_location_id,
        p_lines: lines || [],
        p_expected_delivery_date: expected_delivery_date,
        p_notes: notes
      });

    if (rpcError) {
      console.error('Error creating PO via RPC:', rpcError);
      return NextResponse.json(
        { error: 'Failed to create purchase order', details: rpcError.message },
        { status: 500 }
      );
    }

    const po = result?.purchase_order;
    if (!po) {
      return NextResponse.json(
        { error: 'PO creation did not return data' },
        { status: 500 }
      );
    }

    console.log('PO created successfully via RPC:', po.id);

    // Process auto-approval if enabled
    if (lines && lines.length > 0) {

      // Check for auto-approval (vendor-specific or global limit)
      if (settings?.auto_approve_enabled) {
        const totalCost = lines.reduce((sum: number, line: any) => {
          return sum + (line.qty * line.unit_cost);
        }, 0);

        let applicableLimit: number | null = null;
        let limitSource = '';

        // Check for vendor-specific limit first
        if (vendor_id && settings.vendor_auto_approve_limits && settings.vendor_auto_approve_limits[vendor_id]) {
          applicableLimit = parseFloat(settings.vendor_auto_approve_limits[vendor_id]);
          limitSource = 'vendor-specific';
        } 
        // Fall back to global limit
        else if (settings.auto_approve_limit) {
          applicableLimit = settings.auto_approve_limit;
          limitSource = 'global';
        }

        if (applicableLimit !== null && totalCost <= applicableLimit) {
          // Auto-approve this PO
          await supabase
            .schema('supply_chain')
            .from('purchase_orders')
            .update({
              status: 'approved',
              approved_by_user_id: userId, // System auto-approved on behalf of user
              approved_at: new Date().toISOString(),
              notes: (notes || '') + `\n[AUTO-APPROVED (${limitSource}): Total $${totalCost.toFixed(2)} <= $${applicableLimit.toFixed(2)}]`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', po.id)
            .eq('tenant_id', tenantId);

          // Fetch updated PO to return
          const { data: updatedPO } = await supabase
            .schema('supply_chain')
            .from('purchase_orders')
            .select('*')
            .eq('id', po.id)
            .single();

          return NextResponse.json({
            data: updatedPO || po,
            message: 'Purchase order created and auto-approved',
            auto_approved: true
          }, { status: 201 });
        }
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

