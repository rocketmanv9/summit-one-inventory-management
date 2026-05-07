import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_API_PATHS = new Set(['/api/health']);
const PUBLIC_API_PREFIXES = ['/api/auth', '/api/mock', '/api/debug', '/api/m'];

function isPublicApiRoute(pathname: string) {
  if (PUBLIC_API_PATHS.has(pathname)) {
    return true;
  }

  return PUBLIC_API_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function hasRequiredCookies(request: NextRequest) {
  const accessToken = request.cookies.get('access_token')?.value;
  return Boolean(accessToken);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    if (isPublicApiRoute(pathname)) {
      return NextResponse.next();
    }

    const authenticated = hasRequiredCookies(request);
    if (!authenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.next();
  }

  const authenticated = hasRequiredCookies(request);
  if (!authenticated) {
    const coreLoginUrl = process.env.NEXT_PUBLIC_CORE_APP_URL || '/';
    const redirectUrl = new URL(coreLoginUrl, request.nextUrl.origin);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/:path*',
    '/dashboard/:path*',
    '/debug/:path*',
    '/examples/:path*',
    '/inventory/:path*',
    '/operations/:path*',
    '/purchasing/:path*',
    '/settings/:path*',
  ],
};
