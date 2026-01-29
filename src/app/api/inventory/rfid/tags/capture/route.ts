import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

/**
 * POST /api/inventory/rfid/tags/capture
 * Capture an EPC tag scan
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
    const { epc_hex, device_id, rssi, location_id, notes } = body;

    if (!epc_hex) {
      return NextResponse.json(
        { error: 'epc_hex is required' },
        { status: 400 }
      );
    }

    const supabase = createClient();

    // Call RPC function to capture EPC
    const { data, error } = await supabase.rpc('rfid_capture_epc', {
      p_tenant_id: tenantId,
      p_epc_hex: epc_hex,
      p_device_id: device_id || null,
      p_rssi: rssi || null,
      p_location_id: location_id || null,
      p_scanned_by_user_id: userId,
      p_notes: notes || null
    });

    if (error) {
      console.error('Error capturing EPC:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to capture EPC' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data,
      message: 'EPC captured successfully'
    }, { status: 201 });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
