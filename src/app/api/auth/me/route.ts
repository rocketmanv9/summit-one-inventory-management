/**
 * User Info API
 * GET /api/auth/me - Get current user info including role
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';

export async function GET(request: NextRequest) {
  try {
    const auth = await createAuthenticatedClientOrThrow(request);
    if (auth instanceof NextResponse) return auth;

    const { context, client } = auth;
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    const { data: { user } } = await client.auth.getUser(token || undefined);

    return NextResponse.json({
      data: {
        userId: context.userId,
        tenantId: context.tenantId,
        role: context.role,
        email: context.email || user?.email,
        name: user?.user_metadata?.full_name || null
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

