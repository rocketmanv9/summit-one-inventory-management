import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

/**
 * POST /api/inventory/rfid/devices/authenticate
 * Authenticate an RFID device using device_code and api_key
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
    const { device_code, api_key } = body;

    if (!device_code || !api_key) {
      return NextResponse.json(
        { error: 'device_code and api_key are required' },
        { status: 400 }
      );
    }

    const supabase = createClient();

    // Call RPC function to authenticate device
    const { data, error } = await supabase.rpc('rfid_authenticate_device', {
      p_tenant_id: tenantId,
      p_device_code: device_code,
      p_api_key: api_key
    });

    if (error) {
      console.error('Error authenticating RFID device:', error);
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 401 }
      );
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    return NextResponse.json({ 
      data: data[0],
      message: 'Device authenticated successfully'
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
