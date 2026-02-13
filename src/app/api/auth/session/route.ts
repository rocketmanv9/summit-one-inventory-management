import { NextResponse } from 'next/server';
import { clearAuth, getAuthContext } from '@/lib/auth';

/**
 * GET /api/auth/session
 *
 * Returns current session information from JWT claims in access_token cookie
 *
 * Response:
 * {
 *   user_id: string,
 *   tenant_id: string,
 *   email: string
 * }
 */
export async function GET() {
  try {
    const auth = await getAuthContext();
    if (!auth) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      user_id: auth.userId,
      tenant_id: auth.tenantId,
      email: auth.userEmail || '',
    });

  } catch (error) {
    console.error('[Auth Session] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/auth/session
 *
 * Logout - clears session cookies
 */
export async function DELETE() {
  try {
    await clearAuth();

    return NextResponse.json(
      { message: 'Logged out' },
      { status: 200 }
    );

  } catch (error) {
    console.error('[Auth Session] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
