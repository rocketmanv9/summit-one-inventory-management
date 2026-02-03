import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/dev-session
 * Creates a development session cookie for testing
 * DO NOT USE IN PRODUCTION - This bypasses SSO authentication
 */
export async function POST(req: NextRequest) {
  // SECURITY: This endpoint is disabled for security reasons
  // Note: dev-only endpoint exempted from idempotency (disabled/404 in prod)
  // Use proper Supabase authentication instead
  return NextResponse.json(
    { error: 'This endpoint has been disabled. Use proper authentication.' },
    { status: 404 }
  );
}

