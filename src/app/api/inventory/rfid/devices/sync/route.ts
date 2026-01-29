import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

/**
 * POST /api/inventory/rfid/devices/sync
 * Sync cycle counts for an RFID device
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
    const { device_id } = body;

    if (!device_id) {
      return NextResponse.json(
        { error: 'device_id is required' },
        { status: 400 }
      );
    }

    const supabase = createClient();

    // Call RPC function to sync cycle counts
    const { data, error } = await supabase.rpc('rfid_device_sync_cycle_counts', {
      p_device_id: device_id
    });

    if (error) {
      console.error('Error syncing cycle counts:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to sync cycle counts' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data: data || [],
      message: 'Cycle counts synced successfully'
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
