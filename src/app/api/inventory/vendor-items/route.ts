import { createUserClient } from '@/lib/db-middleware';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
    const searchParams = request.nextUrl.searchParams;
    const vendorId = searchParams.get('vendor_id');
    const catalogItemId = searchParams.get('catalog_item_id');

    // Fetch vendor items
    let query = supabase
      .schema('supply_chain')
      .from('vendor_items')
      .select('*')
      .order('created_at', { ascending: false });

    if (vendorId) {
      query = query.eq('vendor_id', vendorId);
    }

    if (catalogItemId) {
      query = query.eq('catalog_item_id', catalogItemId);
    }

    const { data: vendorItems, error: viError } = await query;

    if (viError) {
      console.error('Error fetching vendor items:', viError);
      return NextResponse.json({ error: viError.message }, { status: 500 });
    }

    console.log(`[Vendor Items GET] Found ${vendorItems?.length || 0} vendor items for tenant ${tenantId}, vendorId filter: ${vendorId}`);

    if (!vendorItems || vendorItems.length === 0) {
      return NextResponse.json([]);
    }

    // Fetch related vendors
    const vendorIds = [...new Set(vendorItems.map((vi: any) => vi.vendor_id))];
    const { data: vendors, error: vendorError } = await supabase
      .schema('supply_chain')
      .from('vendors')
      .select('id, name, code')
      .in('id', vendorIds);

    if (vendorError) {
      console.error('Error fetching vendors:', vendorError);
    }
    console.log(`[Vendor Items GET] Fetched ${vendors?.length || 0} vendors`);

    // Fetch related catalog items
    const catalogItemIds = [...new Set(vendorItems.map((vi: any) => vi.catalog_item_id))];
    const { data: catalogItems, error: catalogError } = await supabase
      .schema('inventory')
      .from('catalog_items')
      .select('id, sku, name, description')
      .in('id', catalogItemIds);

    if (catalogError) {
      console.error('Error fetching catalog items:', catalogError);
    }
    console.log(`[Vendor Items GET] Fetched ${catalogItems?.length || 0} catalog items`);

    // Join the data
    const vendorMap = new Map(vendors?.map((v: any) => [v.id, v]) || []);
    const catalogMap = new Map(catalogItems?.map((c: any) => [c.id, c]) || []);

    const enrichedData = vendorItems.map((vi: any) => ({
      ...vi,
      vendor: vendorMap.get(vi.vendor_id) || null,
      catalog_item: catalogMap.get(vi.catalog_item_id) || null,
    }));

    console.log(`[Vendor Items GET] Returning ${enrichedData.length} enriched items`);
    return NextResponse.json(enrichedData);
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
    const { supabase, tenantId } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY: Require Idempotency-Key header for vendor item creation
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for vendor item creation' },
        { status: 400 }
      );
    }
    
    const body = await request.json();

    const { data: vendorItem, error } = await supabase
      .schema('supply_chain')
      .from('vendor_items')
      .insert({
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
        last_event_id: idempotencyKey,
      })
      .select('*')
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

    return NextResponse.json(enrichedData, { status: 201 });
  } catch (error) {
    console.error('Error in vendor items POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

