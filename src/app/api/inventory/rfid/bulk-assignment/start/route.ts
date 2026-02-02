import { NextRequest, NextResponse } from 'next/server';
import { createDeviceClient, deviceAuthError } from '@/lib/device-auth';

/**
 * POST /api/inventory/rfid/bulk-assignment/start
 * Start a bulk RFID tag assignment session
 * 
 * SECURITY: Machine endpoint - requires device token
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase, deviceId, tenantId } = await createDeviceClient(request);

    // ENFORCE IDEMPOTENCY
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const body = await request.json();
    const { location_id, assignment_method, notes } = body;

    // Create bulk assignment session
    const { data, error } = await supabase
      .schema('inventory')
      .from('rfid_bulk_assignment_sessions')
      .insert({
        tenant_id: tenantId,
        device_id: deviceId,
        location_id: location_id || null,
        assignment_method: assignment_method || 'bulk_manual',
        status: 'active',
        notes: notes || null,
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('[RFID Bulk Assignment] Error:', error);
      return NextResponse.json(
        { error: 'Failed to start bulk assignment session' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data,
      message: 'Bulk assignment session started'
    }, { status: 201 });
  } catch (error: any) {
    if (error.message?.includes('token')) {
      return deviceAuthError(error.message);
    }
    console.error('[RFID Bulk Assignment] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

