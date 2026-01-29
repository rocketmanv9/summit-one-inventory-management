import { createUserClient, getIdempotencyKey } from '@/lib/db-middleware';
import { NextRequest, NextResponse } from 'next/server';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY
    let idempotencyKey: string | null;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header required for PUT operations' },
        { status: 400 }
      );
    }
    
    const body = await request.json();
    const { id } = await params;

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
    const { supabase, tenantId } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY
    let idempotencyKey: string | null;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header required for DELETE operations' },
        { status: 400 }
      );
    }
    
    const { id } = await params;

    const { error } = await supabase
      .schema('supply_chain')
      .from('vendor_items')
      .delete()
      .eq('id', id);

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
