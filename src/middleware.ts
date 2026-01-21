/**
 * Next.js Middleware
 * Runs on every request to set tenant context from session cookie
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
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

// Apply proxy to API routes
export const config = {
  matcher: '/api/:path*',
};
