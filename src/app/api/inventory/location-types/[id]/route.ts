/**
 * Location Type Operations API
 * DELETE /api/inventory/location-types/[id] - Delete a location type
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    const { id: typeId } = await params;

    // Check if any locations are using this type
    const { data: locationCheck, error: checkError } = await supabase
      .schema('inventory')
      .from('locations')
      .select('id, name')
      .eq('location_type_id', typeId)
      .eq('active', true)
      .limit(5);

    if (checkError) {
      console.error('Error checking locations:', checkError);
      return NextResponse.json(
        { error: 'Failed to verify location type can be deleted' },
        { status: 500 }
      );
    }

    if (locationCheck && locationCheck.length > 0) {
      const locationNames = locationCheck.map((l: any) => l.name).join(', ');
      return NextResponse.json(
        { 
          error: `Cannot delete location type because it is used by ${locationCheck.length} location(s): ${locationNames}${locationCheck.length === 5 ? ', ...' : ''}` 
        },
        { status: 400 }
      );
    }

    // Delete the location type
    const { error: deleteError } = await supabase
      .schema('inventory')
      .from('location_types')
      .delete()
      .eq('id', typeId);

    if (deleteError) {
      console.error('Error deleting location type:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete location type' },
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
