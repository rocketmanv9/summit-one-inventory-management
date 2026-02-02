import { NextRequest, NextResponse } from 'next/server';
import { createDeviceClient, deviceAuthError } from '@/lib/device-auth';

/**
 * POST /api/inventory/rfid/devices/heartbeat
 * Record device heartbeat
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
    const { battery_level, signal_strength } = body;

    // Update device heartbeat
    const { error } = await supabase
      .schema('inventory')
      .from('rfid_devices')
      .update({
        last_seen_at: new Date().toISOString(),
        last_ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
        heartbeat_count: supabase.raw('heartbeat_count + 1')
      })
      .eq('id', deviceId)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('[RFID Heartbeat] Error:', error);
      return NextResponse.json(
        { error: 'Failed to record heartbeat' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      message: 'Heartbeat recorded',
      device_id: deviceId
    });
  } catch (error: any) {
    if (error.message?.includes('token')) {
      return deviceAuthError(error.message);
    }
    console.error('[RFID Heartbeat] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

