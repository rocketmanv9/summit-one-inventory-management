import { NextRequest } from 'next/server';
import { requireIdempotencyKey } from '@/lib/db-middleware';
import { handleLogout } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    // STRICT IDEMPOTENCY: Require Idempotency-Key header for logout
    await requireIdempotencyKey(request);

    // Note: logout is a session cleanup operation
    // Idempotency: multiple logout calls are safe (session delete is idempotent)
    return handleLogout(request);
  } catch (error) {
    console.error('Logout error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to logout' }),
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  // Allow GET for logout as well (e.g., from logout link)
  return handleLogout(request);
}

