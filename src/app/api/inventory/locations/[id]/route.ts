/**
 * Location Operations API
 * PUT /api/inventory/locations/[id] - Update a location
 * DELETE /api/inventory/locations/[id] - Delete a location
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient, getIdempotencyKey } from '@/lib/db-middleware';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId, userId } = await createUserClient(request);
    
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
    
    const { id: locationId } = await params;
    const body = await request.json();
    const { name, location_type_id, address, parent_location_id, active } = body;

    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Location name is required' },
        { status: 400 }
      );
    }

    if (!location_type_id) {
      return NextResponse.json(
        { error: 'Location type is required' },
        { status: 400 }
      );
    }

    // Validate parent_location_id doesn't create a circular reference
    if (parent_location_id === locationId) {
      return NextResponse.json(
        { error: 'A location cannot be its own parent' },
        { status: 400 }
      );
    }

    // Verify location type exists and belongs to tenant
    const { data: typeCheck, error: typeError } = await supabase
      .schema('inventory')
      .from('location_types')
      .select('id')
      .eq('id', location_type_id)
      .single();

    if (typeError || !typeCheck) {
      return NextResponse.json(
        { error: 'Invalid location type' },
        { status: 400 }
      );
    }

    // Update the location
    const { error: updateError } = await supabase
      .schema('inventory')
      .from('locations')
      .update({
        name: name.trim(),
        location_type_id,
        address: address?.trim() || null,
        parent_location_id: parent_location_id || null,
        active: active !== undefined ? active : true,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq('id', locationId);

    if (updateError) {
      console.error('Error updating location:', updateError);
      return NextResponse.json(
        { error: 'Failed to update location' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Unexpected error:', error);
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
    
    const { id: locationId } = await params;

    // Check if location has any stock
    const { data: stockCheck, error: stockError } = await supabase
      .schema('inventory')
      .from('stock_balances')
      .select('qty_on_hand')
      .eq('location_id', locationId)
      .gt('qty_on_hand', 0)
      .limit(1);

    if (stockError) {
      console.error('Error checking stock:', stockError);
      return NextResponse.json(
        { error: 'Failed to verify location can be deleted' },
        { status: 500 }
      );
    }

    if (stockCheck && stockCheck.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete location with existing inventory. Transfer or adjust stock to zero first.' },
        { status: 400 }
      );
    }

    // Delete the location
    const { error: deleteError } = await supabase
      .schema('inventory')
      .from('locations')
      .delete()
      .eq('id', locationId)
      .eq('tenant_id', tenantId); // Ensure tenant isolation

    if (deleteError) {
      console.error('Error deleting location:', deleteError);
      
      // Check for foreign key violations
      if (deleteError.code === '23503') {
        return NextResponse.json(
          { error: 'Cannot delete location because it is referenced by other records (reservations, transfers, etc.)' },
          { status: 400 }
        );
      }
      
      return NextResponse.json(
        { error: 'Failed to delete location' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
