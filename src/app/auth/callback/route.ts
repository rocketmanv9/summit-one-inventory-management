import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const coreToken = searchParams.get('core_token');
    const coreEnv = searchParams.get('core_env') || 'dev';
    const targetOrg = searchParams.get('target_org');
    
    console.log('SSO Callback received:', { coreEnv, targetOrg, hasToken: !!coreToken });
    
    if (!coreToken) {
      console.error('No token provided in callback');
      return NextResponse.redirect(new URL('/error?message=no_token', req.url));
    }
    
    const normalizedEnv = ['dev', 'development'].includes(coreEnv) ? 'dev'
      : ['stage', 'staging'].includes(coreEnv) ? 'stage'
      : ['prod', 'production'].includes(coreEnv) ? 'prod'
      : 'dev';

    const coreApiUrl =
      (normalizedEnv === 'dev' ? process.env.CORE_API_URL_DEV : undefined) ||
      (normalizedEnv === 'stage' ? process.env.CORE_API_URL_STAGE : undefined) ||
      (normalizedEnv === 'prod' ? process.env.CORE_API_URL_PROD : undefined) ||
      process.env.NEXT_PUBLIC_CORE_URL ||
      'http://localhost:3000';

    const validateResponse = await fetch(`${coreApiUrl}/api/auth/validate-sso-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${coreToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: coreToken, env: normalizedEnv })
    });

    if (!validateResponse.ok) {
      console.error('Core token validation failed:', validateResponse.status);
      return NextResponse.redirect(new URL('/error?message=invalid_token', req.url));
    }

    const validatePayload = await validateResponse.json();
    const user = validatePayload.user || validatePayload;

    const tenantId =
      user?.tenant_id ||
      user?.tenantId ||
      user?.app_metadata?.active_tenant_id ||
      user?.app_metadata?.tenant_id ||
      targetOrg;

    if (!tenantId || !user?.user_id && !user?.id) {
      console.error('Invalid Core validation payload:', validatePayload);
      return NextResponse.redirect(new URL('/error?message=invalid_token', req.url));
    }

    // Create local session
    const session = {
      userId: user.user_id || user.id,
      email: user.email,
      tenantId,
      tenantSlug: user.tenant_slug,
      role: user.role || user.app_metadata?.role,
      fullName: user.full_name || user.user_metadata?.full_name,
      coreToken,
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
