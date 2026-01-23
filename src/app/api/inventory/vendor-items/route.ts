import { createClient, getTenantIdFromHeaders } from '@/lib/db-middleware';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const tenantId = getTenantIdFromHeaders(request.headers);
    const searchParams = request.nextUrl.searchParams;
    const vendorId = searchParams.get('vendor_id');
    const catalogItemId = searchParams.get('catalog_item_id');

    const supabase = createClient();

    let query = supabase
      .schema('supply_chain')
      .from('vendor_items')
      .select(`
        *,
        vendor:vendors!vendor_id (
          id,
          name,
          code
        ),
        catalog_item:inventory.catalog_items!catalog_item_id (
          id,
          sku,
          name,
          description
        )
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (vendorId) {
      query = query.eq('vendor_id', vendorId);
    }

    if (catalogItemId) {
      query = query.eq('catalog_item_id', catalogItemId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching vendor items:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in vendor items GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = getTenantIdFromHeaders(request.headers);
    const body = await request.json();

    const supabase = createClient();

    const { data, error } = await supabase
      .schema('supply_chain')
      .from('vendor_items')
      .insert({
        tenant_id: tenantId,
        vendor_id: body.vendor_id,
        catalog_item_id: body.catalog_item_id,
        vendor_sku: body.vendor_sku,
        vendor_uom: body.vendor_uom,
        pack_size: body.pack_size,
        is_preferred: body.is_preferred || false,
        unit_cost: body.unit_cost,
        currency: body.currency || 'USD',
        lead_time_days: body.lead_time_days,
        min_order_qty: body.min_order_qty,
        notes: body.notes,
      })
      .select(`
        *,
        vendor:vendors!vendor_id (
          id,
          name,
          code
        ),
        catalog_item:inventory.catalog_items!catalog_item_id (
          id,
          sku,
          name,
          description
        )
      `)
      .single();

    if (error) {
      console.error('Error creating vendor item:', error);
      
      // Handle unique constraint violation
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'This vendor already supplies this item' },
          { status: 409 }
        );
      }

      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Error in vendor items POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
