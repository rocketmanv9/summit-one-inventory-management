/**
 * User Info API
 * GET /api/auth/me - Get current user info including role
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    return NextResponse.json({
      data: {
        userId: user.id,
        tenantId: user.tenant_id,
        role: user.role,
        email: user.email,
        name: user.name
      },
      authenticated: true
    });
  } catch (error) {
    console.error('Auth me error:', error);
    return NextResponse.json(
      { error: 'Failed to get user info' },
      { status: 500 }
    );
  }
}

