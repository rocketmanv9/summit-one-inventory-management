import { NextRequest, NextResponse } from 'next/server';
import { createDeviceClient, deviceAuthError } from '@/lib/device-auth';

/**
 * POST /api/inventory/rfid/bulk-assignment/[session_id]/complete
 * Complete a bulk assignment session
 * 
 * SECURITY: Machine endpoint - requires device token
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ session_id: string }> }
) {
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
    const { session_id: sessionId } = await params;

    // Complete the session
    const { data, error } = await supabase
      .schema('inventory')
      .from('rfid_bulk_assignment_sessions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .eq('tenant_id', tenantId)
      .eq('device_id', deviceId)
      .eq('status', 'active')
      .select()
      .single();

    if (error) {
      console.error('[RFID Bulk Assignment] Error completing session:', error);
      return NextResponse.json(
        { error: 'Failed to complete bulk assignment session' },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Session not found or already completed' },
        { status: 404 }
      );
    }

    return NextResponse.json({ 
      data,
      message: 'Bulk assignment session completed successfully'
    });
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
