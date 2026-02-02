import { NextRequest, NextResponse } from 'next/server';
import { authenticateDevice } from '@/lib/device-auth';

/**
 * POST /api/inventory/rfid/devices/authenticate
 * Authenticate an RFID device using device_code and api_key
 * 
 * SECURITY: Machine endpoint - no user JWT required
 * - Validates device credentials (device_code + api_key)
 * - Issues signed device token (JWT) for subsequent requests
 * - Token contains: device_id, tenant_id, scopes
 */
export async function POST(request: NextRequest) {
  try {
    // ENFORCE IDEMPOTENCY (even for machine auth - prevents duplicate device sessions)
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const body = await request.json();
    const { device_code, api_key } = body;

    if (!device_code || !api_key) {
      return NextResponse.json(
        { error: 'device_code and api_key are required' },
        { status: 400 }
      );
    }

    // Authenticate device and issue token
    const result = await authenticateDevice(device_code, api_key);

    if (!result) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    return NextResponse.json({ 
      token: result.token,
      device_id: result.deviceId,
      tenant_id: result.tenantId,
      message: 'Device authenticated successfully'
    });
  } catch (error: any) {
    console.error('[RFID Auth] Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

