import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { cookies } from 'next/headers';

interface JWTPayload {
  id: string;
  email: string;
  app_metadata: {
    active_tenant_id: string;
    tenant_id: string;
    role: string;
    core_user_id: string;
  };
  user_metadata: {
    full_name: string;
    core_user_id: string;
  };
  exp: number;
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const coreToken = searchParams.get('core_token');
    const coreEnv = searchParams.get('core_env');
    const targetOrg = searchParams.get('target_org');
    
    console.log('SSO Callback received:', { coreEnv, targetOrg, hasToken: !!coreToken });
    
    if (!coreToken) {
      console.error('No token provided in callback');
      return NextResponse.redirect(new URL('/error?message=no_token', req.url));
    }
    
    // Verify JWT from Core using jose
    const secret = new TextEncoder().encode(process.env.CORE_SSO_SECRET);
    
    if (!secret || !process.env.CORE_SSO_SECRET) {
      console.error('CORE_SSO_SECRET not configured');
      return NextResponse.redirect(new URL('/error?message=invalid_token', req.url));
    }
    
    let payload: JWTPayload;
    try {
      const { payload: verifiedPayload } = await jwtVerify(coreToken, secret);
      payload = verifiedPayload as unknown as JWTPayload;
      console.log('Token verified successfully for user:', payload.email);
    } catch (error) {
      console.error('JWT verification failed:', error);
      return NextResponse.redirect(new URL('/error?message=invalid_token', req.url));
    }
    
    // Create local session
    const session = {
      userId: payload.id,
      email: payload.email,
      tenantId: payload.app_metadata.active_tenant_id,
      role: payload.app_metadata.role,
      fullName: payload.user_metadata.full_name,
      expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days from now
    };
    
    console.log('Session created for tenant:', session.tenantId);
    
    // Store in HTTP-only cookie
    const cookieStore = await cookies();
    cookieStore.set('inventory_session', JSON.stringify(session), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });
    
    // Redirect to dashboard
    return NextResponse.redirect(new URL('/dashboard', req.url));
  } catch (error) {
    console.error('SSO callback error:', error);
    return NextResponse.redirect(new URL('/error?message=invalid_token', req.url));
  }
}
