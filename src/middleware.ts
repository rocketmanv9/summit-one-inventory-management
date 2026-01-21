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
  
  const response = NextResponse.next();
  
  // Get the dev session cookie
  const sessionCookie = request.cookies.get('inventory_session');
  
  if (sessionCookie) {
    try {
      const session = JSON.parse(sessionCookie.value);
      
      // Set headers for API routes to use
      response.headers.set('x-tenant-id', session.tenantId);
      response.headers.set('x-user-id', session.userId);
      response.headers.set('x-user-role', session.role || 'user');
      
    } catch (error) {
      console.error('Failed to parse session cookie:', error);
    }
  }
  
  return response;
}

// Apply middleware to dashboard and API routes
export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
