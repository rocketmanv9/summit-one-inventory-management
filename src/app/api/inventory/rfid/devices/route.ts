import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

/**
 * GET /api/inventory/rfid/devices
 * List all RFID devices for the tenant
 */
export async function GET(request: NextRequest) {
  try {
    const { supabase, tenantId } = await createUserClient(request);

    const { data: devices, error } = await supabase
      .from('rfid_devices')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching RFID devices:', error);
      return NextResponse.json(
        { error: 'Failed to fetch RFID devices', details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: devices || [],
      meta: { count: devices?.length || 0 }
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/inventory/rfid/devices
 * Register a new RFID device
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase, tenantId, userId } = await createUserClient(request);

    const body = await request.json();
    const { device_code, device_type, scopes, notes } = body;

    if (!device_code || !device_type || !scopes) {
      return NextResponse.json(
        { error: 'device_code, device_type, and scopes are required' },
        { status: 400 }
      );
    }

    // Validate device_type
    const validTypes = ['handheld_cycle_count', 'handheld_assignment', 'portal_reader'];
    if (!validTypes.includes(device_type)) {
      return NextResponse.json(
        { error: `Invalid device_type. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Call RPC function to register device
    const { data, error } = await supabase.rpc('rfid_register_device', {
      p_tenant_id: tenantId,
      p_device_code: device_code,
      p_device_type: device_type,
      p_scopes: scopes,
      p_notes: notes || null,
      p_registered_by: userId
    });

    if (error) {
      console.error('Error registering RFID device:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to register RFID device' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data,
      message: 'RFID device registered successfully. Save the API key securely - it will not be shown again.'
    }, { status: 201 });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

