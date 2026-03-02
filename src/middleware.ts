import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Middleware
 *
 * Runs before all requests to apply global logic:
 * - Security headers
 * - Request logging (optional)
 * - Path-based routing
 *
 * Note: Rate limiting is handled per-route in API handlers
 * (middleware runs on Edge, but rate limiting needs Upstash which
 * is initialized per-route for better control)
 */

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Add security headers to all responses
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );

  // Add HSTS header in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }

  // Optional: Log requests (disable in production for performance)
  if (process.env.NODE_ENV === 'development') {
    console.log(`[${request.method}] ${request.nextUrl.pathname}`);
  }

  return response;
}

// Configure which routes use this middleware
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png|.*\\.jpg).*)',
  ],
};
