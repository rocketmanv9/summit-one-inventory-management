/**
 * Assets API
 * GET /api/inventory/assets - List all assets with assignment status
 * POST /api/inventory/assets - Create new asset
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
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

    // Simplified: Just return assets data without the view
    const { data: assets, error } = await supabase
      .from('assets')
      .select(`
        *,
        catalog_item:catalog_items(id, name, sku),
        home_location:locations(id, name, location_type)
      `)
      .eq('tenant_id', tenantId)
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
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { catalog_item_id, asset_tag, serial_number, location_id, purchase_date, purchase_cost, warranty_expires } = body;

    const supabase = createClient();

    const { data: asset, error } = await supabase
      .from('assets')
      .insert({
        tenant_id: tenantId,
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
