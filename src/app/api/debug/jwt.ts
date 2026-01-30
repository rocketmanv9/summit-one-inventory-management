/**
 * Debug JWT content - temporarily added to diagnose auth issues
 * This endpoint logs the JWT claims to help identify the correct tenant_id path
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  try {
    // Get the JWT from the Authorization header
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader) {
      return NextResponse.json({
        error: 'No Authorization header',
        suggestion: 'Include Authorization: Bearer <token>'
      }, { status: 400 });
    }

    const token = authHeader.substring(7); // Remove "Bearer "
    
    // Decode JWT (without verification, just to see the payload)
    const parts = token.split('.');
    if (parts.length !== 3) {
      return NextResponse.json({ error: 'Invalid JWT format' }, { status: 400 });
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
