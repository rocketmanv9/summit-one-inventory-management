import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_ROUTES = [
  '/',
  '/auth/callback',
  '/error',
  '/health',
  '/api/health',
  '/api/auth',
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

  const accessToken = request.cookies.get('access_token')?.value;

  if (!accessToken) {
    return NextResponse.redirect(new URL('/error?msg=not_authenticated', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
