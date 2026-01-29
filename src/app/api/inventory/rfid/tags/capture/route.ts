import { NextRequest, NextResponse } from 'next/server';
import { createDeviceClient, deviceAuthError } from '@/lib/device-auth';

/**
 * POST /api/inventory/rfid/tags/capture
 * Capture an EPC tag scan
 * 
 * SECURITY: Machine endpoint - requires device token
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase, deviceId, tenantId } = await createDeviceClient(request);

    const body = await request.json();
    const { epc_hex, rssi, location_id, notes } = body;

    if (!epc_hex) {
      return NextResponse.json(
        { error: 'epc_hex is required' },
        { status: 400 }
      );
    }

    // Record EPC capture
    const { data, error } = await supabase
      .schema('inventory')
      .from('rfid_epc_captures')
      .insert({
        tenant_id: tenantId,
        epc_hex,
        device_id: deviceId,
        rssi,
        location_id: location_id || null,
        notes: notes || null,
        captured_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('[RFID Capture] Error:', error);
      return NextResponse.json(
        { error: 'Failed to capture EPC' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data,
      message: 'EPC captured successfully'
    }, { status: 201 });
  } catch (error: any) {
    if (error.message?.includes('token')) {
      return deviceAuthError(error.message);
    }
    console.error('[RFID Capture] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

