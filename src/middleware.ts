/**
 * Next.js Middleware
 * Runs on every request to set tenant context from session cookie
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  
  // Handle SSO redirect from Core: /dashboard?core_token=... -> /auth/callback?core_token=...
  if (pathname === '/dashboard' && searchParams.has('core_token')) {
    const callbackUrl = new URL('/auth/callback', request.url);
    callbackUrl.searchParams.set('core_token', searchParams.get('core_token')!);
    if (searchParams.has('core_env')) {
      callbackUrl.searchParams.set('core_env', searchParams.get('core_env')!);
    }
    if (searchParams.has('target_org')) {
      callbackUrl.searchParams.set('target_org', searchParams.get('target_org')!);
    }
    
    console.log('[Middleware] SSO redirect from Core, forwarding to auth callback');
    return NextResponse.redirect(callbackUrl);
  }
  
  // Get the session cookie
  const sessionCookie = request.cookies.get('inventory_session');
  
  console.log('[Middleware] Path:', pathname);
  console.log('[Middleware] Session cookie exists:', !!sessionCookie);
  
  if (sessionCookie) {
    try {
      const session = JSON.parse(sessionCookie.value);
      console.log('[Middleware] Session parsed:', { tenantId: session.tenantId, userId: session.userId, role: session.role });
      
      // Clone the request headers and add tenant context
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('x-tenant-id', session.tenantId);
      requestHeaders.set('x-user-id', session.userId);
      requestHeaders.set('x-user-role', session.role || 'user');
      
      console.log('[Middleware] Setting headers:', {
        'x-tenant-id': session.tenantId,
        'x-user-id': session.userId,
        'x-user-role': session.role || 'user'
      });
      
      // Return a new response with the modified request headers
      return NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
      
    } catch (error) {
      console.error('[Middleware] Failed to parse session cookie:', error);
    }
  } else {
    console.log('[Middleware] No session cookie found');
  }
  
  return NextResponse.next();
}

// Apply middleware to dashboard and API routes
export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
