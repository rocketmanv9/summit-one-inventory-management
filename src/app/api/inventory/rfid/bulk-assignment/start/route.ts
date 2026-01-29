import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

/**
 * POST /api/inventory/rfid/bulk-assignment/start
 * Start a bulk RFID tag assignment session
 */
export async function POST(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  const userId = getUserIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { location_id, assignment_method, notes } = body;

    const supabase = createClient();

    // Call RPC function to start bulk assignment session
    const { data, error } = await supabase.rpc('rfid_start_bulk_assignment_session', {
      p_tenant_id: tenantId,
      p_location_id: location_id || null,
      p_assignment_method: assignment_method || 'bulk_manual',
      p_started_by_user_id: userId,
      p_notes: notes || null
    });

    if (error) {
      console.error('Error starting bulk assignment session:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to start bulk assignment session' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data,
      message: 'Bulk assignment session started'
    }, { status: 201 });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
