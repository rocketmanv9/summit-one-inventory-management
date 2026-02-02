/**
 * Next.js Middleware
 * Runs on every request to:
 * 1. Handle SSO ticket redirect from Core
 * 2. Validate session from cookies
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSession, extendSession } from './lib/auth/session';

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  
  // Handle SSO redirect from Core with ticket: /dashboard?ticket=... -> /api/auth/sso-callback?ticket=...
  if (searchParams.has('ticket')) {
    const ticketValue = searchParams.get('ticket');
    const targetService = searchParams.get('target_service') || 'dashboard';
    const callbackUrl = new URL('/api/auth/sso-callback', request.url);
    callbackUrl.searchParams.set('ticket', ticketValue!);
    callbackUrl.searchParams.set('target_service', targetService);
    if (searchParams.has('target_org')) {
      callbackUrl.searchParams.set('target_org', searchParams.get('target_org')!);
    }
    
    console.log('[Middleware] SSO redirect from Core, forwarding to SSO callback');
    return NextResponse.redirect(callbackUrl);
  }
  
  // Get the session cookie
  const sessionId = request.cookies.get('inventory_session_id')?.value;
  
  console.log('[Middleware] Path:', pathname);
  console.log('[Middleware] Session cookie exists:', !!sessionId);
  
  if (sessionId) {
    const session = getSession(sessionId);
    
    if (session) {
      console.log('[Middleware] Session valid:', { tenantId: session.user.tenant_id, userId: session.user.id, role: session.user.role });
      
      // Extend session on each request (sliding window)
      extendSession(sessionId);
      
      // Pass through - no header modification needed
      // Routes should use getAuthUser() to access user context
      return NextResponse.next();
    } else {
      console.log('[Middleware] Session invalid or expired');
      
      // For API routes, let them handle 401
      // For dashboard, redirect to login
      if (pathname.startsWith('/api')) {
        return NextResponse.next();
      }
    }
  } else {
    console.log('[Middleware] No session cookie found');
  }
  
  return NextResponse.next();
}

// Apply middleware to dashboard and API routes
export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*', '/:path*'],
};
