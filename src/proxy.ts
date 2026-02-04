import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_ROUTES = [
  '/',
  '/auth/callback',
  '/error',
  '/health',
  '/api/health',
  '/dev-login',
  '/test',
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static assets and public routes
  if (
    pathname.startsWith('/.well-known') ||
    pathname.startsWith('/_next') ||
    pathname.includes('favicon') ||
    PUBLIC_ROUTES.some(route => pathname.startsWith(route))
  ) {
    return NextResponse.next();
  }

  const userId = request.cookies.get('user_id')?.value;
  const tenantId = request.cookies.get('tenant_id')?.value;

  if (!userId || !tenantId) {
    return NextResponse.redirect(new URL('/error?msg=not_authenticated', request.url));
  }

  const headers = new Headers(request.headers);
  headers.set('x-user-id', userId);
  headers.set('x-tenant-id', tenantId);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
