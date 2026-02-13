import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { jwtVerify, SignJWT } from 'jose';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST() {
  try {
    const cookieStore = await cookies();
    const refreshToken = cookieStore.get('refresh_token')?.value;

    if (!refreshToken) {
      return NextResponse.json({ error: 'Refresh token missing' }, { status: 401 });
    }

    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) {
      console.error('[Auth Refresh] SUPABASE_JWT_SECRET not configured');
      return NextResponse.json({ error: 'Auth not configured' }, { status: 500 });
    }

    const secretKey = new TextEncoder().encode(jwtSecret);

    let refreshClaims: Record<string, unknown>;
    try {
      const { payload: refreshPayload } = await jwtVerify(refreshToken, secretKey, {
        algorithms: ['HS256'],
      });

      refreshClaims = refreshPayload as Record<string, unknown>;
      const tokenUse = refreshClaims.token_use;
      const subject = refreshClaims.sub;
      const appMetadata = refreshClaims.app_metadata as Record<string, unknown> | undefined;
      const tenantId = appMetadata?.tenant_id;

      if (
        tokenUse !== 'refresh' ||
        typeof subject !== 'string' ||
        typeof tenantId !== 'string'
      ) {
        return NextResponse.json({ error: 'Invalid refresh token' }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ error: 'Refresh token expired or invalid' }, { status: 401 });
    }

    const {
      exp: _exp,
      iat: _iat,
      nbf: _nbf,
      jti: _jti,
      token_use: _tokenUse,
      ...claims
    } = refreshClaims;

    const newAccessToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secretKey);

    cookieStore.set('access_token', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 3600,
      path: '/',
    });

    return NextResponse.json(
      { expiresAt: Date.now() + 3600 * 1000 },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[Auth Refresh] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
