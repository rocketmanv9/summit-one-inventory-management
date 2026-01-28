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

    // Fetch purchase orders (exclude cancelled/deleted POs by default)
    const { data: purchaseOrders, error } = await supabase
      .schema('supply_chain')
      .from('purchase_orders')
      .select('*')
      .eq('tenant_id', tenantId)
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
    const vendorIds = [...new Set(purchaseOrders.map(po => po.vendor_id).filter(Boolean))];
    console.log('Vendor IDs to fetch:', vendorIds);
    const { data: vendors } = await supabase
      .schema('supply_chain')
      .from('vendors')
      .select('id, name, code')
      .in('id', vendorIds);
    console.log('Fetched vendors:', vendors);

    // Fetch related locations
    const locationIds = [...new Set(purchaseOrders.map(po => po.delivery_location_id).filter(Boolean))];
    const { data: locations } = await supabase
      .schema('inventory')
      .from('locations')
      .select('id, name')
      .in('id', locationIds);

    // Fetch PO lines
    const poIds = purchaseOrders.map(po => po.id);
    console.log('PO IDs to fetch lines for:', poIds);
    const { data: lines, error: linesError } = await supabase
      .schema('supply_chain')
      .from('purchase_order_lines')
      .select('*')
      .in('po_id', poIds);
    
    console.log('Fetched lines:', lines);
    console.log('Lines error:', linesError);

    // Fetch catalog items for the lines (separate query because it's cross-schema)
    const catalogItemIds = [...new Set(lines?.map(l => l.catalog_item_id).filter(Boolean) || [])];
    const { data: catalogItems } = await supabase
      .schema('inventory')
      .from('catalog_items')
      .select('id, name, sku, unit_of_measure')
      .in('id', catalogItemIds);
    
    const catalogItemMap = new Map(catalogItems?.map(ci => [ci.id, ci]) || []);

    // Create lookup maps
    const vendorMap = new Map(vendors?.map(v => [v.id, v]) || []);
    const locationMap = new Map(locations?.map(l => [l.id, l]) || []);
    const linesMap = new Map<string, any[]>();
    lines?.forEach(line => {
      const existing = linesMap.get(line.po_id) || [];
      // Attach catalog item data to each line
      const enrichedLine = {
        ...line,
        catalog_items: line.catalog_item_id ? catalogItemMap.get(line.catalog_item_id) : null
      };
      linesMap.set(line.po_id, [...existing, enrichedLine]);
    });

    // Combine data
    const enrichedPOs = purchaseOrders.map(po => ({
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

    console.log('Creating PO with:', { vendor_id, ship_to_location_id, lineCount: lines?.length, lines });

    const supabase = createClient();

    // Get tenant settings for PO numbering format
    const { data: settings } = await supabase
      .schema('supply_chain')
      .rpc('get_or_create_tenant_settings', { p_tenant_id: tenantId });

    // Generate PO number based on tenant settings
    let poNumber: string;
    const format = settings?.po_number_format || 'sequential-year';
    const prefix = settings?.po_number_prefix || '';

    if (format === 'sequential-year') {
      // Format: YY-#### (e.g., 26-0001)
      const year = new Date().getFullYear().toString().slice(-2);
      const yearPrefix = prefix ? `${prefix}-${year}-` : `${year}-`;
      
      const { data: latestPOs } = await supabase
        .schema('supply_chain')
        .from('purchase_orders')
        .select('po_number')
        .eq('tenant_id', tenantId)
        .like('po_number', `${yearPrefix}%`)
        .order('created_at', { ascending: false })
        .limit(1);
      
      let nextNumber = 1;
      if (latestPOs && latestPOs.length > 0) {
        const parts = latestPOs[0].po_number.split('-');
        const lastNumber = parseInt(parts[parts.length - 1] || '0');
        nextNumber = lastNumber + 1;
      }
      
      poNumber = `${yearPrefix}${nextNumber.toString().padStart(4, '0')}`;
    } else if (format === 'sequential') {
      // Format: #### or PREFIX-#### (e.g., PO-0001)
      const seqPrefix = prefix ? `${prefix}-` : '';
      
      const { data: latestPOs } = await supabase
        .schema('supply_chain')
        .from('purchase_orders')
        .select('po_number')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(1);
      
      let nextNumber = 1;
      if (latestPOs && latestPOs.length > 0) {
        const parts = latestPOs[0].po_number.split('-');
        const lastNumber = parseInt(parts[parts.length - 1] || '0');
        nextNumber = lastNumber + 1;
      }
      
      poNumber = `${seqPrefix}${nextNumber.toString().padStart(4, '0')}`;
    } else if (format === 'timestamp') {
      // Format: PREFIX-TIMESTAMP (e.g., PO-MKY42T62)
      const tsPrefix = prefix || 'PO';
      poNumber = `${tsPrefix}-${Date.now().toString(36).toUpperCase()}`;
    } else {
      // Default fallback
      poNumber = `PO-${Date.now().toString(36).toUpperCase()}`;
    }

    // Create PO header
    const { data: po, error: poError } = await supabase
      .schema('supply_chain')
      .from('purchase_orders')
      .insert({
        tenant_id: tenantId,
        po_number: poNumber,
        vendor_id,
        delivery_location_id: ship_to_location_id,
        status: 'draft',
        order_date: new Date().toISOString().split('T')[0], // Today's date in YYYY-MM-DD format
        expected_delivery_date,
        notes,
        created_by_user_id: userId,
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
      const poLines = lines.map((line: any, index: number) => ({
        tenant_id: tenantId,
        po_id: po.id,
        line_number: index + 1,
        catalog_item_id: line.catalog_item_id,
        qty_ordered: line.qty,
        unit_cost: line.unit_cost,
        status: 'open',
        last_event_id: `pol-${Date.now()}-${index}-${Math.random().toString(36).substring(7)}`
      }));

      console.log('Inserting PO lines:', poLines);

      const { error: linesError } = await supabase
        .schema('supply_chain')
        .from('purchase_order_lines')
        .insert(poLines);

      if (linesError) {
        console.error('Error creating PO lines:', linesError);
        // PO was created but lines failed - return partial success
      } else {
        console.log('PO lines created successfully');
      }

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
