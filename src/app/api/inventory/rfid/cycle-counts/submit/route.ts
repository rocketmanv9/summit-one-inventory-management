import { NextRequest, NextResponse } from 'next/server';
import { createDeviceClient, deviceAuthError } from '@/lib/device-auth';

/**
 * POST /api/inventory/rfid/cycle-counts/submit
 * Submit cycle count results from RFID device
 * 
 * SECURITY: Machine endpoint - requires device token
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase, deviceId, tenantId } = await createDeviceClient(request);

    const body = await request.json();
    const { cycle_count_id, epc_list, scan_metadata } = body;

    if (!cycle_count_id || !epc_list) {
      return NextResponse.json(
        { error: 'cycle_count_id and epc_list are required' },
        { status: 400 }
      );
    }

    // Record cycle count submission
    const { data, error } = await supabase
      .schema('inventory')
      .from('rfid_cycle_count_submissions')
      .insert({
        tenant_id: tenantId,
        device_id: deviceId,
        cycle_count_id,
        epc_list,
        scan_metadata: scan_metadata || {},
        submitted_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('[RFID Cycle Count] Error:', error);
      return NextResponse.json(
        { error: 'Failed to submit cycle count results' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data,
      message: 'Cycle count results submitted successfully'
    }, { status: 201 });
  } catch (error: any) {
    if (error.message?.includes('token')) {
      return deviceAuthError(error.message);
    }
    console.error('[RFID Cycle Count] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

