/**
 * User Info API
 * GET /api/auth/me - Get current user info including role
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('inventory_session');

    if (!sessionCookie) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    try {
      const session = JSON.parse(sessionCookie.value);

      // Check if session is expired
      if (session.expiresAt && session.expiresAt < Date.now()) {
        return NextResponse.json({ error: 'Session expired' }, { status: 401 });
      }

      return NextResponse.json({
        data: {
          userId: session.userId,
          tenantId: session.tenantId,
          role: session.role,
          email: session.email,
          fullName: session.fullName,
        }
      });
    } catch (error) {
      console.error('Failed to parse session:', error);
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }
  } catch (error: any) {
    console.error('Error getting user info:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
