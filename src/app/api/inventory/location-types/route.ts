/**
 * Location Types API
 * GET /api/inventory/location-types - List location types for tenant
 * POST /api/inventory/location-types - Create new location type
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';
import { handleApiError } from '@/lib/api-error-handler';

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await createUserClient(request);
    
    const { data: locationTypes, error } = await supabase
      .from('location_types')
      .select('id, name, description')
      .eq('active', true)
      .order('name');
    
    if (error) {
      console.error('Error fetching location types:', error);
      return NextResponse.json(
        { error: 'Failed to fetch location types' },
        { status: 500 }
      );
    }
    
    // Transform to value/label format for dropdowns
    const formattedTypes = (locationTypes || []).map((type: any) => ({
      value: type.id,
      label: type.name,
      description: type.description,
    }));
    
    return NextResponse.json({ data: formattedTypes });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY: Require Idempotency-Key header for location type creation
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for location type creation' },
        { status: 400 }
      );
    }
    
    const body = await request.json();
    const { name, description } = body;
    
    if (!name) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }
    
    // Auto-generate code from name
    const code = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    
    const { data, error } = await supabase
      .from('location_types')
      .insert({
        code,
        name,
        description: description || null,
        active: true,
      })
      .select()
      .single();
    
    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        return NextResponse.json(
          { error: 'Location type code already exists for your organization' },
          { status: 409 }
        );
      }
      console.error('Error creating location type:', error);
      return NextResponse.json(
        { error: 'Failed to create location type' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

