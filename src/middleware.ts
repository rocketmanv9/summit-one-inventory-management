import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Skip middleware for these paths
  if (
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/error') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/auth/callback') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }
  
  // Check for session cookie
  const sessionCookie = request.cookies.get('inventory_session');
  
  if (!sessionCookie) {
    // No session - redirect to core
    const coreUrl = process.env.NEXT_PUBLIC_CORE_URL || 'https://dev.summit-one.app';
    return NextResponse.redirect(`${coreUrl}/dashboard`);
  }
  
  try {
    const session = JSON.parse(sessionCookie.value);
    
    // Check if session is expired
    if (session.expiresAt && session.expiresAt < Date.now()) {
      // Session expired - delete cookie and redirect to core
      const response = NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_CORE_URL || 'https://dev.summit-one.app'}/dashboard`
      );
      response.cookies.delete('inventory_session');
      return response;
    }
    
    // Add tenant and user context to headers for API routes
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-tenant-id', session.tenantId);
    requestHeaders.set('x-user-id', session.userId);
    
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch (error) {
    console.error('Middleware session parsing error:', error);
    // Invalid session - redirect to core
    const response = NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_CORE_URL || 'https://dev.summit-one.app'}/dashboard`
    );
    response.cookies.delete('inventory_session');
    return response;
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth/callback (SSO callback)
     * - auth/callback (SSO callback page)
     * - error (error page)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api/auth/callback|auth/callback|error|_next/static|_next/image|favicon.ico).*)',
  ],
};
