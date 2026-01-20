/**
 * Assets API
 * GET /api/inventory/assets - List all assets with assignment status
 * POST /api/inventory/assets - Create new asset
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
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
    const assignedOnly = searchParams.get('assigned') === 'true';

    // First try the assets view with assignment info
    let query = supabase
      .from('assets')
      .select(`
        *,
        catalog_items(id, name, sku),
        locations(id, name, location_type),
        asset_state(status, current_location_id, last_event_id)
      `)
      .eq('tenant_id', tenantId);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: assets, error } = await query.order('asset_tag');

    if (error) {
      console.error('Error fetching assets:', error);
      return NextResponse.json(
        { error: 'Failed to fetch assets' },
        { status: 500 }
      );
    }

    // If we need assigned assets, also fetch from v_assets_assigned view
    if (assignedOnly) {
      const { data: assignedAssets, error: assignedError } = await supabase
        .from('v_assets_assigned')
        .select('*')
        .eq('tenant_id', tenantId);

      if (!assignedError && assignedAssets) {
        return NextResponse.json({
          data: assignedAssets,
          meta: { tenantId, count: assignedAssets.length }
        });
      }
    }

    return NextResponse.json({
      data: assets,
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

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

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
