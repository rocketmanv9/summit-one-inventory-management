/**
 * DEV ONLY: Local development login bypass
 * Creates a mock session for testing without Core SSO
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
  // Only allow in development
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { error: 'Not available in production' },
      { status: 403 }
    );
  }

  try {
    const tenantId = process.env.NEXT_PUBLIC_TENANT_ID || 'ae837809-1a24-4ab5-ba06-34fd98c05f48';
    
    // Create a dev session
    const session = {
      userId: '00000000-0000-0000-0000-000000000001',
      email: 'grant@summitone.com',
      tenantId: tenantId,
      role: 'admin',
      fullName: 'Grant',
      expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
    };

    const cookieStore = await cookies();
    cookieStore.set('inventory_session', JSON.stringify(session), {
      httpOnly: true,
      secure: (process.env.NODE_ENV as string) === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24, // 24 hours
      path: '/'
    });

    return NextResponse.json({ 
      success: true, 
      session,
      message: 'Dev session created. Refresh the page.' 
    });
  } catch (error) {
    console.error('Dev login error:', error);
    return NextResponse.json(
      { error: 'Failed to create dev session' },
      { status: 500 }
    );
  }
}
