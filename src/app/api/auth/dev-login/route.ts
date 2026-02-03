/**
 * DEV ONLY: Local development login bypass
 * Creates a mock session for testing without Core SSO
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  // SECURITY: This endpoint is disabled for security reasons
  // Use proper Supabase authentication instead
  return NextResponse.json(
    { error: 'This endpoint has been disabled. Use proper authentication.' },
    { status: 404 }
  );
}

