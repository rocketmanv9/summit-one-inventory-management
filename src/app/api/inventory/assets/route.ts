/**
 * Assets API
 * GET /api/inventory/assets - List all assets with assignment status
 * POST /api/inventory/assets - Create new asset
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  try {
    const { supabase, tenantId } = await createUserClient(request);

    // Simplified: Just return assets data without the view
    const { data: assets, error } = await supabase
      .schema('inventory')
      .from('assets')
      .select(`
        *,
        catalog_item:catalog_items(id, name, sku),
        location:locations!assets_location_id_fkey(id, name, location_type_id, location_type:location_types(id, name))
      `)
      .order('asset_tag');

    if (error) {
      console.error('Error fetching assets:', error);
      return NextResponse.json(
        { error: 'Failed to fetch assets', details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: assets || [],
      meta: { tenantId, count: assets?.length || 0 }
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
    const { supabase, tenantId } = await createUserClient(request);

    // ENFORCE IDEMPOTENCY: Require Idempotency-Key header for asset creation
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for asset creation' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { catalog_item_id, asset_tag, serial_number, location_id, purchase_date, purchase_cost, warranty_expires } = body;

    const { data: asset, error } = await supabase
      .from('assets')
      .insert({
        catalog_item_id,
        asset_tag,
        serial_number,
        location_id,
        purchase_date,
        purchase_cost,
        warranty_expires,
        status: 'available',
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating asset:', error);
      return NextResponse.json(
        { error: 'Failed to create asset' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: asset }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

