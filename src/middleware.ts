import { NextResponse, type NextRequest } from 'next/server';

interface TokenClaims {
  tenantId?: string;
  exp?: number;
}

// Routing check only — signature verification happens server-side in the
// chassis route factories on every API call. Here we just decode the payload
// to decide whether the session is good enough to enter the app.
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

// Good for routing only if the token is present, unexpired, and carries a tenant.
function hasValidSession(claims: TokenClaims | null): boolean {
  return Boolean(claims) && !isExpired(claims!) && Boolean(claims!.tenantId);
}

function portalRedirect(request: NextRequest) {
  const coreLoginUrl =
    process.env.NEXT_PUBLIC_CORE_APP_URL || process.env.NEXT_PUBLIC_CORE_URL || '/';
  return NextResponse.redirect(new URL(coreLoginUrl, request.nextUrl.origin));
}

// Gates app PAGE routes only (see matcher). API routes enforce their own auth
// via the chassis route factories, and crons/webhooks authenticate without a
// session cookie, so /api/* is deliberately NOT matched here. Public pages
// (/, /auth/callback, /m/* mobile QR pages, /error, /dev-login) are excluded
// simply by not appearing in the matcher.
export async function middleware(request: NextRequest) {
  const claims = decodeAccessToken(request);
  if (!hasValidSession(claims)) {
    return portalRedirect(request);
  }
  return NextResponse.next({ request });
}

export const config = {
  matcher: [
    '/ai/:path*',
    '/dashboard/:path*',
    '/debug/:path*',
    '/fleet/:path*',
    '/inventory/:path*',
    '/operations/:path*',
    '/scan/:path*',
    '/settings/:path*',
  ],
};
