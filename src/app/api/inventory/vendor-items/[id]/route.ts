import { createClient, getTenantIdFromHeaders } from '@/lib/db-middleware';
import { NextRequest, NextResponse } from 'next/server';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = getTenantIdFromHeaders(request.headers);
    const body = await request.json();
    const { id } = await params;

    const supabase = createClient();

    const { data: vendorItem, error } = await supabase
      .schema('supply_chain')
      .from('vendor_items')
      .update({
        vendor_sku: body.vendor_sku,
        vendor_uom: body.vendor_uom,
        pack_size: body.pack_size,
        is_preferred: body.is_preferred,
        unit_cost: body.unit_cost,
        currency: body.currency,
        lead_time_days: body.lead_time_days,
        min_order_qty: body.min_order_qty,
        notes: body.notes,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .single();

    if (error) {
      console.error('Error updating vendor item:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!vendorItem) {
      return NextResponse.json({ error: 'Vendor item not found' }, { status: 404 });
    }

    // Fetch related vendor
    const { data: vendor } = await supabase
      .schema('supply_chain')
      .from('vendors')
      .select('id, name, code')
      .eq('id', vendorItem.vendor_id)
      .single();

    // Fetch related catalog item
    const { data: catalogItem } = await supabase
      .schema('inventory')
      .from('catalog_items')
      .select('id, sku, name, description')
      .eq('id', vendorItem.catalog_item_id)
      .single();

    const enrichedData = {
      ...vendorItem,
      vendor: vendor || null,
      catalog_item: catalogItem || null,
    };

    return NextResponse.json(enrichedData);
  } catch (error) {
    console.error('Error in vendor item PUT:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = getTenantIdFromHeaders(request.headers);
    const { id } = await params;

    const supabase = createClient();

    const { error } = await supabase
      .schema('supply_chain')
      .from('vendor_items')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Error deleting vendor item:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in vendor item DELETE:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
