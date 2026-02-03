/**
 * Next.js Middleware
 * Ticket-based auth is handled client-side via useTicketAuth.
 * No cookie-based session handling or server redirects here.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

// Apply middleware to dashboard and API routes
export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*', '/:path*'],
};
