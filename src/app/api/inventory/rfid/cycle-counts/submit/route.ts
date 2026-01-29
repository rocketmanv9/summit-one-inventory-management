import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

/**
 * POST /api/inventory/rfid/cycle-counts/submit
 * Submit cycle count results from RFID device
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
    const { device_id, cycle_count_id, epc_list, scan_metadata } = body;

    if (!device_id || !cycle_count_id || !epc_list) {
      return NextResponse.json(
        { error: 'device_id, cycle_count_id, and epc_list are required' },
        { status: 400 }
      );
    }

    const supabase = createClient();

    // Call RPC function to submit cycle count results
    const { data, error } = await supabase.rpc('rfid_submit_cycle_count_results', {
      p_device_id: device_id,
      p_cycle_count_id: cycle_count_id,
      p_epc_list: epc_list,
      p_scan_metadata: scan_metadata || null
    });

    if (error) {
      console.error('Error submitting cycle count results:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to submit cycle count results' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data,
      message: 'Cycle count results submitted successfully'
    }, { status: 201 });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
