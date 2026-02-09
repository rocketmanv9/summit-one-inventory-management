import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * GET /api/auth/session
 *
 * Returns current session information (user_id, tenant_id, email)
 * Uses cookies set by /auth/callback
 *
 * Response:
 * {
 *   user_id: string,
 *   tenant_id: string,
 *   email: string
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    
    const userId = cookieStore.get('user_id')?.value;
    const tenantId = cookieStore.get('tenant_id')?.value;
    const userEmail = cookieStore.get('user_email')?.value;

    if (!userId || !tenantId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      user_id: userId,
      tenant_id: tenantId,
      email: userEmail || '',
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
export async function DELETE(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    
    // Clear all auth cookies
    cookieStore.delete('user_id');
    cookieStore.delete('tenant_id');
    cookieStore.delete('user_email');

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
