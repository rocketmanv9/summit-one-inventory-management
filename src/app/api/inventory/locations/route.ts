/**
 * Locations API
 * GET /api/inventory/locations - List all locations
 * POST /api/inventory/locations - Create new location
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
    const { searchParams } = new URL(request.url);
    const locationTypeId = searchParams.get('typeId');

    let query = supabase
      .schema('inventory')
      .from('locations')
      .select(`
        *,
        location_type:location_types!locations_location_type_id_fkey(name)
      `)
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
  try {
    const { supabase, tenantId, userId } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY: Require Idempotency-Key header for location creation
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for location creation' },
        { status: 400 }
      );
    }
    
    const body = await request.json();
    const { name, location_type_id, address, parent_location_id } = body;

    console.log('Creating location with:', { name, location_type_id, address, parent_location_id, tenantId, userId });

    if (!location_type_id) {
      return NextResponse.json(
        { error: 'Location type is required' },
        { status: 400 }
      );
    }

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

