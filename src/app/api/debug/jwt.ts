/**
 * Debug JWT content - temporarily added to diagnose auth issues
 * This endpoint logs the JWT claims to help identify the correct tenant_id path
 * SECURITY: Requires valid JWT authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';

export async function GET(request: NextRequest) {
  try {
    // SECURITY: Verify JWT before exposing JWT structure
    // This prevents unauthenticated reconnaissance
    const authContext = await createAuthenticatedClientOrThrow(request);
    if (authContext instanceof NextResponse) {
      return NextResponse.json({
        error: 'Unauthorized - Valid JWT required',
        message: 'This debug endpoint requires authentication'
      }, { status: 401 });
    }
    
    // Decode JWT (without verification, just to see the payload)
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({
        error: 'Unauthorized - Valid JWT required',
        suggestion: 'Include Authorization: Bearer <valid_token>'
      }, { status: 401 });
    }

    const token = authHeader.substring(7); // Remove "Bearer "
    
    // Parse JWT payload
    const parts = token.split('.');
    if (parts.length !== 3) {
      return NextResponse.json({ error: 'Invalid JWT format' }, { status: 401 });
    }

    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    
    return NextResponse.json({
      jwt_payload: payload,
      has_app_metadata: 'app_metadata' in payload,
      has_tenant_id_root: 'tenant_id' in payload,
      app_metadata_keys: payload.app_metadata ? Object.keys(payload.app_metadata) : null,
      all_keys: Object.keys(payload)
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      hint: 'This endpoint helps diagnose JWT structure'
    }, { status: 500 });
  }
}
