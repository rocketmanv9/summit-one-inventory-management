import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

/**
 * POST /api/inventory/rfid/devices/heartbeat
 * Record device heartbeat
 */
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
    const { device_id, battery_level, signal_strength } = body;

    if (!device_id) {
      return NextResponse.json(
        { error: 'device_id is required' },
        { status: 400 }
      );
    }

    const supabase = createClient();

    // Call RPC function to record heartbeat
    const { data, error } = await supabase.rpc('rfid_device_heartbeat', {
      p_device_id: device_id,
      p_battery_level: battery_level || null,
      p_signal_strength: signal_strength || null
    });

    if (error) {
      console.error('Error recording device heartbeat:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to record heartbeat' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data,
      message: 'Heartbeat recorded'
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
