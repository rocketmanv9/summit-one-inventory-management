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

// Routing check only — signature verification happens in requireAuthContext()
// on every API call. Here we just need to know whether the token carries a
// tenant so users without one bounce back to the portal instead of landing
// in an app where every request 403s.
function tokenHasTenant(request: NextRequest): boolean {
  const token = request.cookies.get('access_token')?.value;
  if (!token) return false;
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return Boolean(json?.app_metadata?.tenant_id);
  } catch {
    return false;
  }
}

function portalRedirect(request: NextRequest) {
  const coreLoginUrl = process.env.NEXT_PUBLIC_CORE_APP_URL || '/';
  const redirectUrl = new URL(coreLoginUrl, request.nextUrl.origin);
  return NextResponse.redirect(redirectUrl);
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

    if (!tokenHasTenant(request)) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
    }

    return NextResponse.next();
  }

  const authenticated = hasRequiredCookies(request);
  if (!authenticated || !tokenHasTenant(request)) {
    return portalRedirect(request);
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
