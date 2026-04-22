# Microservice SSO Setup

Last verified: 2026-02-13
Source of truth: runtime code

## Purpose
This guide describes how another Summit One microservice integrates with Core SSO, exchanges tickets, mints Supabase-compatible JWTs, and protects routes. It is derived from the implementation in [src/app/auth/callback/route.ts](src/app/auth/callback/route.ts) and the auth endpoints in [src/app/api/auth](src/app/api/auth).

## Required environment variables
- CORE_EXCHANGE_URL: Core ticket exchange endpoint.
- CORE_SUPABASE_ANON_KEY: Core anon key used to call the exchange endpoint.
- SUPABASE_JWT_SECRET: HS256 signing secret used by Supabase to verify JWTs.
- NEXT_PUBLIC_CORE_APP_URL: Core base URL for browser login redirects.

Commonly used in the microservice:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- NEXT_PUBLIC_SERVICE_BASE_URL

## Ticket exchange (server route)
Implement GET /auth/callback. This is the critical integration point.

Key rules:
- Ticket must be exactly 32 characters.
- Exchange request must include `apikey` and `Authorization: Bearer <CORE_SUPABASE_ANON_KEY>` headers.
- Accept response field variants: `userId` or `user.id`, `tenantId` or `target_tenant_id`.

Minimal Next.js App Router handler (based on [src/app/auth/callback/route.ts](src/app/auth/callback/route.ts)):

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { SignJWT } from 'jose';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticket = searchParams.get('ticket');
  const targetOrg = searchParams.get('target_org');
  const targetService = searchParams.get('target_service');

  if (!ticket || ticket.length !== 32) {
    return NextResponse.redirect(new URL('/error?msg=no_ticket', request.url));
  }

  const exchangeUrl = process.env.CORE_EXCHANGE_URL;
  const coreAnonKey = process.env.CORE_SUPABASE_ANON_KEY;
  if (!exchangeUrl || !coreAnonKey) {
    throw new Error('Missing Core configuration');
  }

  const exchangeResponse = await fetch(exchangeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: coreAnonKey,
      Authorization: `Bearer ${coreAnonKey}`,
    },
    body: JSON.stringify({
      ticket,
      target_org: targetOrg,
      target_service: targetService,
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!exchangeResponse.ok) {
    throw new Error(`Exchange failed: ${exchangeResponse.status}`);
  }

  const userData = await exchangeResponse.json();
  const resolvedUserId = userData.userId || userData.user?.id;
  const resolvedTenantId = userData.tenantId || userData.target_tenant_id;
  const resolvedEmail = userData.email || userData.user?.email || '';
  const resolvedName = userData.name || userData.user?.full_name || userData.user?.name || '';
  const resolvedRole = userData.role || 'authenticated';

  if (!resolvedUserId || !resolvedTenantId) {
    throw new Error('Invalid response from Core');
  }

  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT signing not configured');
  }

  const secretKey = new TextEncoder().encode(jwtSecret);

  const accessToken = await new SignJWT({
    sub: resolvedUserId,
    email: resolvedEmail || undefined,
    role: 'authenticated',
    app_metadata: { tenant_id: resolvedTenantId, role: resolvedRole },
    user_metadata: { full_name: resolvedName || undefined, email: resolvedEmail || undefined, role: resolvedRole },
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretKey);

  const refreshToken = await new SignJWT({
    sub: resolvedUserId,
    email: resolvedEmail || undefined,
    role: 'authenticated',
    token_use: 'refresh',
    app_metadata: { tenant_id: resolvedTenantId, role: resolvedRole },
    user_metadata: { full_name: resolvedName || undefined, email: resolvedEmail || undefined, role: resolvedRole },
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey);

  const cookieStore = await cookies();
  cookieStore.set('access_token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 3600,
    path: '/',
  });
  cookieStore.set('refresh_token', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 604800,
    path: '/',
  });

  return NextResponse.redirect(new URL('/dashboard', request.url));
}
```

## Token endpoints
Implement these endpoints to support browser and API clients:

- GET /api/auth/token
  - Returns `{ access_token }` from the HttpOnly cookie.
  - Sends `Cache-Control: no-store`.

- POST /api/auth/refresh
  - Verifies refresh token (`SUPABASE_JWT_SECRET`, `token_use: 'refresh'`).
  - Mints a new 1 hour access token and updates the `access_token` cookie.

- POST /api/auth/logout and GET /api/auth/logout
  - Clears `access_token` and `refresh_token` cookies.
  - GET redirects to `NEXT_PUBLIC_CORE_APP_URL`.

## Middleware pattern
Protect all routes except a small public allowlist. The current implementation in [middleware.ts](middleware.ts) checks only for cookie presence (no signature verification).

Recommended behavior:
- Protected API routes return `401` JSON if `access_token` is missing.
- Protected page routes redirect to `NEXT_PUBLIC_CORE_APP_URL` if `access_token` is missing.
- Public allowlist should include `/api/auth/*` and `/auth/callback`.

## Client-side token injection
Mirror the browser flow in [src/lib/auth-token.ts](src/lib/auth-token.ts) and [src/supabase/client.ts](src/supabase/client.ts):

- Fetch `/api/auth/token` and cache the token in memory.
- Inject `Authorization: Bearer <token>` into Supabase requests.
- On 401/403, call `/api/auth/refresh` and retry once.
