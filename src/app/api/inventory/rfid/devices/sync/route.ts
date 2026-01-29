import { NextRequest, NextResponse } from 'next/server';
import { createDeviceClient, deviceAuthError } from '@/lib/device-auth';

/**
 * POST /api/inventory/rfid/devices/sync
 * Sync cycle counts for an RFID device
 * 
 * SECURITY: Machine endpoint - requires device token
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase, deviceId, tenantId } = await createDeviceClient(request);

    // Get pending cycle counts for this device
    const { data: cycleCounts, error } = await supabase
      .schema('inventory')
      .from('cycle_counts')
      .select(`
        id,
        count_number,
        location_id,
        status,
        assigned_to_device_id,
        scheduled_start,
        expected_duration_minutes
      `)
      .eq('tenant_id', tenantId)
      .eq('assigned_to_device_id', deviceId)
      .in('status', ['pending', 'in_progress'])
      .order('scheduled_start', { ascending: true });

    if (error) {
      console.error('[RFID Sync] Error fetching cycle counts:', error);
      return NextResponse.json(
        { error: 'Failed to sync cycle counts' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data: cycleCounts || [],
      device_id: deviceId,
      message: 'Cycle counts synced successfully'
    });
  } catch (error: any) {
    if (error.message?.includes('token')) {
      return deviceAuthError(error.message);
    }
    console.error('[RFID Sync] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

