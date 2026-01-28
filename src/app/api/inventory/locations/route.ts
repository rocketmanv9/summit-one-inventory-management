/**
 * Locations API
 * GET /api/inventory/locations - List all locations
 * POST /api/inventory/locations - Create new location
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

    const { searchParams } = new URL(request.url);
    const locationTypeId = searchParams.get('typeId');

    let query = supabase
      .schema('inventory')
      .from('locations')
      .select(`
        *,
        location_type:location_types!locations_location_type_id_fkey(name)
      `)
      .eq('tenant_id', tenantId)
      .eq('active', true);

    if (locationTypeId) {
      query = query.eq('location_type_id', locationTypeId);
    }

    const { data: locations, error } = await query.order('name');

    if (error) {
      console.error('Error fetching locations:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      return NextResponse.json(
        { error: 'Failed to fetch locations', details: error },
        { status: 500 }
      );
    }

    console.log(`[Locations API] Fetched ${locations?.length || 0} locations for tenant ${tenantId}`);

    return NextResponse.json({
      data: locations,
      meta: { tenantId, count: locations?.length || 0 }
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
    const { name, location_type_id, address, parent_location_id } = body;

    const userId = getUserIdFromHeaders(request.headers);
    console.log('Creating location with:', { name, location_type_id, address, parent_location_id, tenantId, userId });

    if (!location_type_id) {
      return NextResponse.json(
        { error: 'Location type is required' },
        { status: 400 }
      );
    }

    const supabase = createClient();

    const { data: location, error } = await supabase
      .schema('inventory')
      .from('locations')
      .insert({
        tenant_id: tenantId,
        name,
        location_type_id,
        address,
        parent_location_id,
        created_by: userId,
        updated_by: userId,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating location:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      return NextResponse.json(
        { error: error.message || 'Failed to create location' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: location }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
