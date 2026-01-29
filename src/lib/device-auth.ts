/**
 * Device Authentication Middleware
 * 
 * SECURITY MODEL:
 * - RFID devices are machines, not users
 * - Devices authenticate with device_code + api_key
 * - Server validates credentials and issues signed device token (JWT)
 * - Device token contains: device_id, tenant_id, scopes
 * - All device endpoints verify token before allowing access
 * - Service role used ONLY after device verification
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import * as jose from 'jose';

const DEVICE_TOKEN_SECRET = new TextEncoder().encode(
  process.env.DEVICE_TOKEN_SECRET || 'default-device-secret-change-in-production'
);
const DEVICE_TOKEN_EXPIRY = '24h'; // 24 hours

export interface DeviceContext {
  deviceId: string;
  tenantId: string;
  deviceCode: string;
  scopes: string[];
  supabase: any; // Service role client (verified)
}

/**
 * Authenticate device and issue JWT token
 * Called by /api/inventory/rfid/devices/authenticate
 */
export async function authenticateDevice(
  deviceCode: string,
  apiKey: string
): Promise<{ token: string; deviceId: string; tenantId: string } | null> {
  // Use service role to check device credentials (bypasses RLS)
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  // Get device by device_code
  const { data: device, error } = await supabase
    .schema('inventory')
    .from('rfid_devices')
    .select('id, tenant_id, device_code, api_key_hash, status, scopes')
    .eq('device_code', deviceCode)
    .eq('status', 'active')
    .single();

  if (error || !device) {
    console.error('[DeviceAuth] Device not found:', deviceCode);
    return null;
  }

  // Verify API key hash
  // In production, use bcrypt or similar
  const crypto = await import('crypto');
  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  
  if (device.api_key_hash !== apiKeyHash) {
    console.error('[DeviceAuth] Invalid API key for device:', deviceCode);
    return null;
  }

  // Update last_seen_at
  // Update last_seen_at and increment heartbeat_count
  await supabase
    .schema('inventory')
    .from('rfid_devices')
    .update({ 
      last_seen_at: new Date().toISOString()
    })
    .eq('id', device.id);

  // Increment heartbeat separately using RPC if available, or just skip
  // Note: Direct SQL increment not supported by Supabase client
  
  // Create device JWT token
  const token = await new jose.SignJWT({
    device_id: device.id,
    tenant_id: device.tenant_id,
    device_code: device.device_code,
    scopes: device.scopes || []
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(DEVICE_TOKEN_EXPIRY)
    .setSubject(device.id)
    .sign(DEVICE_TOKEN_SECRET);

  return {
    token,
    deviceId: device.id,
    tenantId: device.tenant_id
  };
}

/**
 * Verify device token and create service client
 * Used by all RFID device endpoints (sync, heartbeat, etc.)
 * 
 * @throws Error if token is invalid or expired
 */
export async function createDeviceClient(request: NextRequest): Promise<DeviceContext> {
  // Extract device token from Authorization header
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing device token - Authorization header required');
  }

  const token = authHeader.substring(7); // Remove 'Bearer '

  try {
    // Verify and decode JWT
    const { payload } = await jose.jwtVerify(token, DEVICE_TOKEN_SECRET);

    const deviceId = payload.device_id as string;
    const tenantId = payload.tenant_id as string;
    const deviceCode = payload.device_code as string;
    const scopes = (payload.scopes as string[]) || [];

    if (!deviceId || !tenantId) {
      throw new Error('Invalid device token payload');
    }

    // Create service role client for device operations
    // SECURITY: Only after token verification
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    return {
      deviceId,
      tenantId,
      deviceCode,
      scopes,
      supabase
    };
  } catch (error) {
    console.error('[DeviceAuth] Token verification failed:', error);
    throw new Error('Invalid or expired device token');
  }
}

/**
 * Helper to send device auth error response
 */
export function deviceAuthError(message: string, status: number = 401): NextResponse {
  return NextResponse.json(
    { error: message },
    { status }
  );
}
