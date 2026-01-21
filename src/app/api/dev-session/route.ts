import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * POST /api/dev-session
 * Creates a development session cookie for testing
 * DO NOT USE IN PRODUCTION - This bypasses SSO authentication
 */
export async function POST(req: NextRequest) {
  // Only allow in development
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SESSION !== 'true') {
    return NextResponse.json(
      { error: 'Dev session not allowed in production' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { userId, email, tenantId, role, fullName } = body;

    if (!userId || !email || !tenantId || !role) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, email, tenantId, role' },
        { status: 400 }
      );
    }

    // Create session
    const session = {
      userId,
      email,
      tenantId,
      role,
      fullName: fullName || 'Dev User',
      expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
    };

    // Store in HTTP-only cookie
    const cookieStore = await cookies();
    cookieStore.set('inventory_session', JSON.stringify(session), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    console.log('[Dev Session] Created session for:', { email, tenantId, role });

    return NextResponse.json({ 
      success: true,
      session: {
        email,
        tenantId,
        role,
        fullName: session.fullName,
      }
    });
  } catch (error) {
    console.error('[Dev Session] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create dev session' },
      { status: 500 }
    );
  }
}
