import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticket = searchParams.get('ticket');
    const targetOrg = searchParams.get('target_org');

    console.log('[Auth Callback] Request:', { ticketLength: ticket?.length, targetOrg });

    // Validate ticket
    if (!ticket || ticket.length !== 32) {
      console.error('[Auth Callback] Invalid ticket');
      return NextResponse.redirect(new URL('/error?msg=no_ticket', request.url));
    }

    const exchangeUrl = process.env.CORE_EXCHANGE_URL;
    const coreAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!exchangeUrl || !coreAnonKey) {
      console.error('[Auth Callback] Missing Core configuration');
      throw new Error('Missing Core configuration');
    }

    // Exchange ticket with Core API endpoint
    console.log('[Auth Callback] Exchanging ticket:', { exchangeUrl });

    const exchangeResponse = await fetch(exchangeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${coreAnonKey}`,
      },
      body: JSON.stringify({ ticket, target_org: targetOrg }),
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
    
    if (!userData.user?.id || !userData.target_tenant_id) {
      console.error('[Auth Callback] Invalid response from Core:', userData);
      throw new Error('Invalid response from Core');
    }

    const { user, target_tenant_id } = userData;

    console.log('[Auth Callback] Success:', { userId: user.id, tenantId: target_tenant_id });

    // Create session cookies
    const cookieStore = await cookies();
    
    cookieStore.set('user_id', user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 604800, // 7 days
      path: '/',
    });

    cookieStore.set('tenant_id', target_tenant_id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 604800,
      path: '/',
    });

    cookieStore.set('user_email', user.email || '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 604800,
      path: '/',
    });

    return NextResponse.redirect(new URL('/dashboard', request.url));

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
