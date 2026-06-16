import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_API_PATHS = new Set(['/api/health']);
const PUBLIC_API_PREFIXES = ['/api/auth', '/api/mock', '/api/debug', '/api/m'];

function isPublicApiRoute(pathname: string) {
  if (PUBLIC_API_PATHS.has(pathname)) {
    return true;
  }

  return PUBLIC_API_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

interface TokenClaims {
  tenantId?: string;
  exp?: number;
}

// Routing check only — signature verification happens in requireAuthContext()
// on every API call. Here we just decode the payload to decide whether the
// token is still good enough to enter the app, or whether the user should
// bounce back to the portal for a fresh ticket.
function decodeAccessToken(request: NextRequest): TokenClaims | null {
  const token = request.cookies.get('access_token')?.value;
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return {
      tenantId: json?.app_metadata?.tenant_id,
      exp: typeof json?.exp === 'number' ? json.exp : undefined,
    };
  } catch {
    return null;
  }
}

// An expired (or undateable) token must NOT grant entry — otherwise a stale
// cookie keeps the user in an app where every request 401s instead of sending
// them to the portal for a fresh ticket.
function isExpired(claims: TokenClaims): boolean {
  if (!claims.exp) return true;
  return claims.exp * 1000 <= Date.now();
}

// A session is good for routing only if the token is present, unexpired, and
// carries a tenant.
function hasValidSession(claims: TokenClaims | null): boolean {
  return Boolean(claims) && !isExpired(claims!) && Boolean(claims!.tenantId);
}

function portalRedirect(request: NextRequest) {
  const coreLoginUrl =
    process.env.NEXT_PUBLIC_CORE_APP_URL || process.env.NEXT_PUBLIC_CORE_URL || '/';
  const redirectUrl = new URL(coreLoginUrl, request.nextUrl.origin);
  return NextResponse.redirect(redirectUrl);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const claims = decodeAccessToken(request);

  if (pathname.startsWith('/api/')) {
    if (isPublicApiRoute(pathname)) {
      return NextResponse.next();
    }

    if (!claims) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Expired token → 401 so the client refreshes via the public /api/auth/* routes.
    if (isExpired(claims)) {
      return NextResponse.json({ error: 'Token expired' }, { status: 401 });
    }

    if (!claims.tenantId) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
    }

    return NextResponse.next();
  }

  // Page routes: any missing/expired/tenant-less token bounces to the portal
  // for a fresh ticket.
  if (!hasValidSession(claims)) {
    return portalRedirect(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/:path*',
    '/ai/:path*',
    '/dashboard/:path*',
    '/debug/:path*',
    '/examples/:path*',
    '/fleet/:path*',
    '/inventory/:path*',
    '/operations/:path*',
    '/purchasing/:path*',
    '/scan/:path*',
    '/settings/:path*',
  ],
};
