import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { SignJWT } from 'jose';

// Prevent caching/prefetching of this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Exchange ticket for JWT and session
 *
 * Flow:
 * 1. Validate ticket with Core API
 * 2. Get user_id, tenant_id from response
 * 3. Mint Supabase JWT signed with SUPABASE_JWT_SECRET
 * 4. Redirect to dashboard with JWT in URL (for client to setSession)
 * 5. AuthSessionHydrator component captures JWT and hydrates Supabase session
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticket = searchParams.get('ticket');
    const targetOrg = searchParams.get('target_org');
    const targetService = searchParams.get('target_service');

    console.log('[Auth Callback] Request:', { ticketLength: ticket?.length, targetOrg, targetService });

    // Validate ticket
    if (!ticket || ticket.length !== 32) {
      console.error('[Auth Callback] Invalid ticket');
      return NextResponse.redirect(new URL('/error?msg=no_ticket', request.url));
    }

    const exchangeUrl = process.env.CORE_EXCHANGE_URL;
    const coreAnonKey = process.env.CORE_SUPABASE_ANON_KEY;

    if (!exchangeUrl || !coreAnonKey) {
      console.error('[Auth Callback] Missing Core configuration');
      throw new Error('Missing Core configuration');
    }

    // Exchange ticket with Core API endpoint
    const requestBody = { 
      ticket, 
      target_org: targetOrg,
      target_service: targetService 
    };
    console.log('[Auth Callback] Exchanging ticket:', { 
      exchangeUrl, 
      ticketPrefix: ticket.substring(0, 8),
      targetOrg,
      targetService,
      anonKeyPrefix: coreAnonKey.substring(0, 20)
    });

    const exchangeResponse = await fetch(exchangeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': coreAnonKey,
        Authorization: `Bearer ${coreAnonKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(5000),
    });

    if (!exchangeResponse.ok) {
      const errorText = await exchangeResponse.text();
      console.error('[Auth Callback] Exchange failed:', {
        status: exchangeResponse.status,
        error: errorText,
      });
      throw new Error(`Exchange failed: ${exchangeResponse.status}`);
    }

    const userData = await exchangeResponse.json();

    const {
      userId,
      tenantId,
      email,
      name,
      role,
      user,
      target_tenant_id,
    } = userData;

    const resolvedUserId = userId || user?.id;
    const resolvedTenantId = tenantId || target_tenant_id;
    const resolvedEmail = email || user?.email || '';
    const resolvedName = name || user?.full_name || user?.name || '';
    const resolvedRole = role || 'authenticated';

    if (!resolvedUserId || !resolvedTenantId) {
      console.error('[Auth Callback] Invalid response from Core:', userData);
      throw new Error('Invalid response from Core');
    }

    console.log('[Auth Callback] Success:', { userId: resolvedUserId, tenantId: resolvedTenantId });

    // Mint JWT for Supabase RLS
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) {
      console.error('[Auth Callback] SUPABASE_JWT_SECRET not configured');
      throw new Error('JWT signing not configured');
    }

    const secretKey = new TextEncoder().encode(jwtSecret);
    const accessToken = await new SignJWT({
      sub: resolvedUserId,
      email: resolvedEmail || undefined,
      role: 'authenticated',
      app_metadata: {
        tenant_id: resolvedTenantId,
        role: resolvedRole,
      },
      user_metadata: {
        full_name: resolvedName || undefined,
        email: resolvedEmail || undefined,
        role: resolvedRole,
      },
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secretKey);

    console.log('[Auth Callback] JWT minted:', {
      userId: resolvedUserId,
      tenantId: resolvedTenantId,
      tokenLength: accessToken.length,
    });

    // Create session cookies (backup)
    const cookieStore = await cookies();
    
    cookieStore.set('user_id', resolvedUserId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 604800, // 7 days
      path: '/',
    });

    cookieStore.set('tenant_id', resolvedTenantId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 604800,
      path: '/',
    });

    cookieStore.set('user_email', resolvedEmail || '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 604800,
      path: '/',
    });

    // Redirect to dashboard with JWT in URL
    // AuthSessionHydrator component will:
    // 1. Grab the tokens from URL
    // 2. Call supabase.auth.setSession()
    // 3. Clear URL parameters
    const dashboardUrl = new URL('/dashboard', request.url);
    dashboardUrl.searchParams.set('access_token', accessToken);
    
    return NextResponse.redirect(dashboardUrl);

  } catch (error) {
    console.error('[Auth Callback] Error:', error);
    return NextResponse.redirect(
      new URL(`/error?msg=${encodeURIComponent(error instanceof Error ? error.message : 'Unknown error')}`, request.url)
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
