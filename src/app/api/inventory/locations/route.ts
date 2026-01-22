/**
 * Locations API
 * GET /api/inventory/locations - List all locations
 * POST /api/inventory/locations - Create new location
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

    const { searchParams } = new URL(request.url);
    const locationType = searchParams.get('type');

    let query = supabase
      .from('locations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('active', true);

    if (locationType) {
      query = query.eq('location_type', locationType);
    }

    const { data: locations, error } = await query.order('name');

    if (error) {
      console.error('Error fetching locations:', error);
      return NextResponse.json(
        { error: 'Failed to fetch locations' },
        { status: 500 }
      );
    }

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
    const { name, location_type, address, parent_location_id } = body;

    const supabase = createClient();

    const { data: location, error } = await supabase      .schema('inventory')      .from('locations')
      .insert({
        tenant_id: tenantId,
        name,
        location_type: location_type || 'warehouse',
        address,
        parent_location_id,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating location:', error);
      return NextResponse.json(
        { error: 'Failed to create location' },
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
