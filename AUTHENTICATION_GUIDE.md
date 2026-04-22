# Authentication System - Complete Code Analysis

**⚠️ THIS DOCUMENT DESCRIBES THE ACTUAL CODE BEHAVIOR, NOT ASPIRATIONAL DOCUMENTATION**

Last analyzed: 2026-02-16
Source: Direct code inspection (not documentation)
Files analyzed: src/lib/auth.ts, src/lib/auth-token.ts, src/app/auth/callback/route.ts, src/app/api/auth/*, middleware.ts, src/supabase/client.ts

---

## CRITICAL UNDERSTANDING: NO JWT SIGNATURE VERIFICATION ON SERVER

**⚠️ IMPORTANT**: The server-side `getAuthContext()` in `src/lib/auth.ts` **DOES NOT VERIFY JWT SIGNATURES**. It only base64-decodes the JWT payload.

```typescript
// src/lib/auth.ts - Lines 22-35: This is what actually happens
function parseJwtPayload(token: string): JwtPayload | null {
  try {
    const payloadSegment = token.split('.')[1];
    if (!payloadSegment) return null;

    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');  // <-- Just base64 decode, NO signature check

    return JSON.parse(decoded) as JwtPayload;
  } catch {
    return null;
  }
}
```

**Why is this safe?**
- The middleware validates the cookie exists before allowing requests to protected routes
- The JWT can only be set by the auth callback (which is the only place that creates JWTs)
- The JWT is HttpOnly (browser cannot access via JavaScript)
- The browser never sees the JWT in localStorage (it's server-side only)
- Therefore, the server trusts that if the cookie exists, it's valid

---

## Part 1: LOGIN FLOW (Core Ticket → JWT → Dashboard)

### 1.1 Entry Point: `/auth/callback` Route Handler

**File**: `src/app/auth/callback/route.ts` (lines 19-219)

**How it works** (step-by-step through actual code):

```
1. User lands on Core-controlled page
2. Core redirects to: http://localhost:3000/auth/callback?ticket=<32-char-ticket>&target_org=<org_id>&target_service=inventory
3. Browser makes GET request to /auth/callback
```

### 1.2 Ticket Validation

**Code** (lines 23-51):
```typescript
const { searchParams } = new URL(request.url);
const ticket = searchParams.get('ticket');
const targetOrg = searchParams.get('target_org');
const targetTenantId = searchParams.get('target_tenant_id') || targetOrg;
const targetService = searchParams.get('target_service');

// Validate service is specified
if (!resolvedTargetService) {
  return NextResponse.redirect(new URL('/error?msg=missing_target_service', request.url), ...);
}

// Validate ticket is exactly 32 characters
if (!ticket || ticket.length !== 32) {
  return NextResponse.redirect(new URL('/error?msg=no_ticket', request.url), ...);
}
```

**What this does:**
- Extracts ticket from URL parameters
- MUST be exactly 32 characters (no flexibility)
- Extracts target_org and target_service
- If missing, redirects to error page

### 1.3 Core API Exchange (Trading Ticket for Identity)

**Code** (lines 53-108):

```typescript
const exchangeUrl = process.env.CORE_EXCHANGE_URL;
const coreAnonKey = process.env.CORE_ANON_KEY;

if (!exchangeUrl || !coreAnonKey) {
  throw new Error('Missing Core configuration');
}

const requestBody = {
  ticket,
  target_service: resolvedTargetService,
  target_org: targetOrg,
  target_tenant_id: targetOrg,
};

const exchangeResponse = await fetch(exchangeUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': coreAnonKey,
    Authorization: `Bearer ${coreAnonKey}`,
  },
  body: JSON.stringify(requestBody),
  signal: AbortSignal.timeout(Number.parseInt(process.env.CORE_EXCHANGE_TIMEOUT_MS || '15000', 10)),
});

if (!exchangeResponse.ok) {
  const errorText = await exchangeResponse.text();
  throw new Error(`Exchange failed: ${exchangeResponse.status}`);
}

const userData = await exchangeResponse.json();
```

**What this does:**
- Calls CORE_EXCHANGE_URL with the ticket
- Sends ticket + target_service + target_org
- Uses Core's anonymous key for authentication
- Has a 15 second timeout (configurable via CORE_EXCHANGE_TIMEOUT_MS)
- If exchange fails, throws error and redirects to error page

### 1.4 Identity Resolution from Core Response

**Code** (lines 112-131):

```typescript
const {
  userId,
  tenantId,
  email,
  name,
  role,
  user,
  target_tenant_id,
} = userData;

// Fallback resolution - flexible field names
const resolvedUserId = userId || user?.id;
const resolvedTenantId = tenantId || target_tenant_id;
const resolvedEmail = email || user?.email || '';
const resolvedName = name || user?.full_name || user?.name || '';
const resolvedRole = role || 'authenticated';

if (!resolvedUserId || !resolvedTenantId) {
  throw new Error('Invalid response from Core');
}
```

**What this does:**
- Extracts identity from Core response (flexible field names - supports multiple formats)
- Falls back to nested user object if needed
- Defaults role to 'authenticated' if missing
- REQUIRES at least userId and tenantId (throws error if missing)
- Allows Core to respond in multiple formats (camelCase or snake_case at various levels)

### 1.5 JWT Minting (Creating Access Token)

**Code** (lines 136-160):

```typescript
const jwtSecret = process.env.SUPABASE_JWT_SECRET;
if (!jwtSecret) {
  throw new Error('JWT signing not configured');
}

const secretKey = new TextEncoder().encode(jwtSecret);
const accessToken = await new SignJWT({
  sub: resolvedUserId,
  email: resolvedEmail || undefined,
  role: 'authenticated',
  app_metadata: {
    tenant_id: resolvedTenantId,
    role: resolvedRole,
  },
  user_metadata: {
    full_name: resolvedName || undefined,
    email: resolvedEmail || undefined,
    role: resolvedRole,
  },
})
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('1h')  // <-- EXPIRES IN 1 HOUR
  .sign(secretKey);
```

**What this does:**
- Uses jose library's `SignJWT` to create a JWT
- Algorithm: HS256 (HMAC with SHA-256)
- Payload structure:
  - `sub`: user ID (subject/user identifier)
  - `email`: user's email
  - `role`: always 'authenticated' (top-level)
  - `app_metadata.tenant_id`: tenant for RLS
  - `app_metadata.role`: user's actual role (admin/user)
  - `user_metadata.full_name`: user's name
  - `user_metadata.email`: email
  - `user_metadata.role`: actual role again
- **EXPIRES IN 1 HOUR** (hardcoded)
- Signed with SUPABASE_JWT_SECRET (HS256)

### 1.6 JWT Minting (Creating Refresh Token)

**Code** (lines 162-180):

```typescript
const refreshToken = await new SignJWT({
  sub: resolvedUserId,
  email: resolvedEmail || undefined,
  role: 'authenticated',
  token_use: 'refresh',  // <-- KEY: marks this as refresh token
  app_metadata: {
    tenant_id: resolvedTenantId,
    role: resolvedRole,
  },
  user_metadata: {
    full_name: resolvedName || undefined,
    email: resolvedEmail || undefined,
    role: resolvedRole,
  },
})
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('7d')  // <-- EXPIRES IN 7 DAYS
  .sign(secretKey);
```

**What this does:**
- Identical to access token BUT with:
  - `token_use: 'refresh'` claim (critical for validation in refresh endpoint)
  - **EXPIRES IN 7 DAYS** (not configurable)

### 1.7 Cookie Storage (HttpOnly, Secure, SameSite)

**Code** (lines 189-205):

```typescript
const cookieStore = await cookies();

cookieStore.set('access_token', accessToken, {
  httpOnly: true,           // <-- Browser cannot access via JS
  secure: process.env.NODE_ENV === 'production',  // <-- HTTPS only in prod
  sameSite: 'lax',          // <-- Cross-site requests with safe methods allowed
  maxAge: 3600,             // <-- 1 hour in seconds
  path: '/',                // <-- Available to entire app
});

cookieStore.set('refresh_token', refreshToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 604800,           // <-- 7 days in seconds
  path: '/',
});
```

**What this does:**
- Sets HttpOnly cookies (browser JS cannot read/modify)
- Secure flag only in production (requires HTTPS)
- SameSite=Lax allows safe cross-site requests (GET with auth)
- Stores two cookies:
  - `access_token`: 1 hour expiry
  - `refresh_token`: 7 days expiry

### 1.8 Redirect to Dashboard

**Code** (line 208):

```typescript
return NextResponse.redirect(new URL('/dashboard', request.url), {
  headers: noStoreHeaders,
});
```

**What this does:**
- Redirects to /dashboard (middleware will protect it)
- Sends Cache-Control headers to prevent caching

---

## Part 2: MIDDLEWARE PROTECTION

**File**: `middleware.ts` (lines 19-56)

### 2.1 How Middleware Works

```typescript
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API route protection
  if (pathname.startsWith('/api/')) {
    if (isPublicApiRoute(pathname)) {
      return NextResponse.next();  // Allow public API routes
    }

    const authenticated = hasRequiredCookies(request);
    if (!authenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.next();  // Allow protected API routes
  }

  // Page route protection
  const authenticated = hasRequiredCookies(request);
  if (!authenticated) {
    const coreLoginUrl = process.env.NEXT_PUBLIC_CORE_APP_URL || '/';
    const redirectUrl = new URL(coreLoginUrl, request.nextUrl.origin);
    return NextResponse.redirect(redirectUrl);  // Redirect to Core login
  }

  return NextResponse.next();  // Allow page routes
}
```

### 2.2 Cookie Check (The Only Auth Check at Middleware Level)

**Code** (lines 14-17):

```typescript
function hasRequiredCookies(request: NextRequest) {
  const accessToken = request.cookies.get('access_token')?.value;
  return Boolean(accessToken);  // <-- Just checks if cookie exists
}
```

**CRITICAL POINT**: Middleware only checks if the cookie **EXISTS**. It does NOT:
- Verify the JWT signature
- Check expiration
- Validate any claims

**Protected Routes**: All routes except:
```typescript
const PUBLIC_API_PATHS = new Set(['/api/health']);
const PUBLIC_API_PREFIXES = ['/api/auth', '/api/mock', '/api/debug'];

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
```

---

## Part 3: TOKEN RETRIEVAL & CACHING (Client-Side)

**File**: `src/lib/auth-token.ts`

### 3.1 Token Caching in Memory

**Code** (lines 17-20):

```typescript
let cachedAccessToken: string | null = null;
let accessTokenPromise: Promise<string | null> | null = null;
let refreshPromise: Promise<string | null> | null = null;
let refreshTimeoutId: number | null = null;
```

**What this does:**
- Stores token in browser memory (not localStorage)
- `cachedAccessToken`: The actual JWT string
- `accessTokenPromise`: Deduplicates concurrent token fetches
- `refreshPromise`: Deduplicates concurrent refresh calls
- `refreshTimeoutId`: Schedules proactive refresh before expiration

### 3.2 Fetching Token from Server

**Code** (lines 54-64):

```typescript
async function fetchAccessTokenFromServer(): Promise<string | null> {
  const response = await fetch('/api/auth/token', {
    method: 'GET',
    credentials: 'include',  // <-- Include cookies in request
    cache: 'no-store',       // <-- Don't cache this response
  }).catch(() => null);

  if (!response?.ok) return null;
  const data = (await response.json()) as { access_token?: string };
  return typeof data.access_token === 'string' ? data.access_token : null;
}
```

**What this does:**
- Calls `/api/auth/token` (which just returns the cookie value)
- Includes cookies in request (`credentials: 'include'`)
- Returns the access_token from response JSON

### 3.3 API Endpoint: `/api/auth/token`

**File**: `src/app/api/auth/token/route.ts`

```typescript
export const dynamic = 'force-dynamic';  // Never cache
export const revalidate = 0;             // Never revalidate

export async function GET() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('access_token')?.value || null;

  if (!accessToken) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return NextResponse.json(
    { access_token: accessToken },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
```

**What this does:**
- Reads `access_token` cookie from server
- Returns it as JSON to the client
- Sends `Cache-Control: no-store` to prevent caching

### 3.4 Loading & Caching Token

**Code** (lines 70-92):

```typescript
export async function loadAccessToken(force = false): Promise<string | null> {
  if (!force && cachedAccessToken) return cachedAccessToken;  // Return cached if not forcing reload
  if (typeof window === 'undefined') return null;              // SSR safety

  if (!force && accessTokenPromise) {
    return accessTokenPromise;  // Deduplicate concurrent requests
  }

  accessTokenPromise = fetchAccessTokenFromServer();

  const token = await accessTokenPromise;
  accessTokenPromise = null;

  if (!token) {
    cachedAccessToken = null;
    clearRefreshTimer();
    return null;
  }

  cachedAccessToken = token;
  scheduleRefreshFromToken(token);  // Schedule proactive refresh
  return token;
}
```

**What this does:**
- Fetches token from server via `/api/auth/token`
- Caches it in memory
- Deduplicates concurrent requests
- Schedules automatic refresh before expiration
- Returns null if fetch fails

### 3.5 Proactive Token Refresh (Before Expiration)

**Code** (lines 30-52):

```typescript
function scheduleRefreshFromToken(token: string): void {
  if (typeof window === 'undefined') return;

  clearRefreshTimer();

  const expiresAt = getJwtExpiration(token);  // Get exp claim in milliseconds
  if (!expiresAt) return;

  const refreshAt = expiresAt - 5 * 60 * 1000;  // <-- Refresh 5 MINUTES BEFORE EXPIRY
  const delay = Math.max(0, refreshAt - Date.now());

  refreshTimeoutId = window.setTimeout(() => {
    void refreshAccessToken().then((nextToken) => {
      if (nextToken) {
        scheduleRefreshFromToken(nextToken);  // Reschedule for new token
        return;
      }

      clearStoredAccessToken();
      redirectToCoreLogin();  // Redirect if refresh fails
    });
  }, delay);
}
```

**What this does:**
- Extracts expiration from JWT (`exp` claim)
- Calculates refresh time as `exp - 5 minutes`
- Sets up browser timeout to refresh before token expires
- If refresh succeeds, reschedules with new token
- If refresh fails, clears token and redirects to Core login

### 3.6 Extracting JWT Expiration

**Code** (lines 140-144):

```typescript
export function getJwtExpiration(token: string): number | null {
  const payload = parseJwtPayload(token);
  if (!payload?.exp) return null;
  return payload.exp * 1000;  // <-- Convert from seconds to milliseconds
}

export function isJwtExpired(token: string, skewSeconds = 30): boolean {
  const expiresAt = getJwtExpiration(token);
  if (!expiresAt) return false;
  return Date.now() >= expiresAt - skewSeconds * 1000;  // <-- 30 second skew
}
```

**What this does:**
- Parses JWT payload (no signature check!)
- Reads `exp` claim (in seconds)
- Converts to milliseconds
- `isJwtExpired()` includes 30-second skew (considers token expired 30 seconds before actual expiry)

---

## Part 4: TOKEN REFRESH FLOW

**File**: `src/app/api/auth/refresh/route.ts`

### 4.1 Refresh Request Handler

**Code** (lines 8-79):

```typescript
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get('refresh_token')?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: 'Refresh token missing' }, { status: 401 });
  }

  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!jwtSecret) {
    return NextResponse.json({ error: 'Auth not configured' }, { status: 500 });
  }

  const secretKey = new TextEncoder().encode(jwtSecret);

  let refreshClaims: Record<string, unknown>;
  try {
    const { payload: refreshPayload } = await jwtVerify(refreshToken, secretKey, {
      algorithms: ['HS256'],  // <-- Actually verifies signature here!
    });

    refreshClaims = refreshPayload as Record<string, unknown>;
    const tokenUse = refreshClaims.token_use;
    const subject = refreshClaims.sub;
    const appMetadata = refreshClaims.app_metadata as Record<string, unknown> | undefined;
    const tenantId = appMetadata?.tenant_id;

    if (
      tokenUse !== 'refresh' ||
      typeof subject !== 'string' ||
      typeof tenantId !== 'string'
    ) {
      return NextResponse.json({ error: 'Invalid refresh token' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Refresh token expired or invalid' }, { status: 401 });
  }

  // Extract claims but exclude standard/useless claims
  const {
    exp: _exp,
    iat: _iat,
    nbf: _nbf,
    jti: _jti,
    token_use: _tokenUse,
    ...claims
  } = refreshClaims;

  // Mint new access token (same claims, new expiration)
  const newAccessToken = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')  // <-- New token also expires in 1 hour
    .sign(secretKey);

  cookieStore.set('access_token', newAccessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 3600,
    path: '/',
  });

  return NextResponse.json(
    { expiresAt: Date.now() + 3600 * 1000 },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
```

**What this does:**
- Reads `refresh_token` cookie
- **ACTUALLY VERIFIES JWT SIGNATURE** with `jwtVerify()` (unlike server-side auth!)
- Requires `token_use === 'refresh'` claim
- Mints new access_token (1 hour expiry)
- Uses old token's claims (except standard ones)
- Sets new access_token cookie
- Returns expiration timestamp

**KEY DIFFERENCE**: This endpoint **DOES verify JWT signature**, unlike `getAuthContext()`

---

## Part 5: LOGOUT FLOW

**File**: `src/app/api/auth/logout/route.ts` & `src/lib/auth.ts`

### 5.1 Clearing Cookies

**Code** (src/lib/auth.ts, lines 94-98):

```typescript
export async function clearAuth(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete('access_token');
  cookieStore.delete('refresh_token');
}
```

**What this does:**
- Deletes both cookies from the browser

### 5.2 Logout Endpoints

**GET /api/auth/logout** (line 25-38):
```typescript
export async function GET() {
  await clearAuth();
  const coreUrl = process.env.NEXT_PUBLIC_CORE_APP_URL || 'https://dev.summit-one.app';
  return NextResponse.redirect(coreUrl);
}
```

**POST /api/auth/logout** (line 4-23):
```typescript
export async function POST() {
  await clearAuth();
  const coreUrl = process.env.NEXT_PUBLIC_CORE_APP_URL || 'https://dev.summit-one.app';
  return NextResponse.json({
    success: true,
    redirectUrl: coreUrl
  });
}
```

**What this does:**
- Clears cookies
- Redirects to Core base URL
- Returns redirect URL in response (POST)

---

## Part 6: SERVER-SIDE AUTH (Extracting Identity from Request)

**File**: `src/lib/auth.ts`

### 6.1 Getting Auth Context

**Code** (lines 41-59):

```typescript
export async function getAuthContext(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('access_token')?.value;

  if (!accessToken) {
    return null;
  }

  const payload = parseJwtPayload(accessToken);  // <-- NO SIGNATURE VERIFICATION
  const userId = payload?.sub;
  const tenantId = payload?.app_metadata?.tenant_id;
  const userEmail = payload?.user_metadata?.email;

  if (!userId || !tenantId) {
    return null;
  }

  return { userId, tenantId, userEmail };
}
```

**Critical Points:**
- **NO SIGNATURE VERIFICATION** - just base64 decoding
- Reads from `access_token` cookie
- Extracts `sub`, `app_metadata.tenant_id`, `user_metadata.email`
- Returns null if missing userId or tenantId

### 6.2 Requiring Auth (Throwing on Missing)

**Code** (lines 65-71):

```typescript
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuthContext();
  if (!auth) {
    throw new Error('Authentication required');
  }
  return auth;
}
```

**What this does:**
- Calls `getAuthContext()`
- Throws error if not authenticated
- Used in API routes: `const auth = await requireAuth();` will throw 401 if not auth'd

### 6.3 Helper Functions

```typescript
export async function getCurrentTenantId(): Promise<string> {
  const auth = await requireAuth();
  return auth.tenantId;
}

export async function getCurrentUserId(): Promise<string> {
  const auth = await requireAuth();
  return auth.userId;
}
```

**What this does:**
- Shortcut functions for common use cases
- Throw if not authenticated

---

## Part 7: CLIENT-SIDE SUPABASE INTEGRATION

**File**: `src/supabase/client.ts`

### 7.1 Injecting Token Into Supabase Requests

**Code** (lines 63-111):

```typescript
export function createBrowserAuthedClient() {
  if (typeof window === 'undefined') {
    return createClient();
  }

  if (browserAuthedClient) {
    return browserAuthedClient;
  }

  void loadAccessToken();  // Start loading token in background

  browserAuthedClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: async (input, init = {}) => {
          const token = await getValidAccessToken();  // Get token (refresh if expired)
          const headers = new Headers(init.headers);

          if (token) {
            headers.set('Authorization', `Bearer ${token}`);  // <-- Inject Bearer token
          }

          const response = await fetch(input, { ...init, headers });

          // Handle 401 by refreshing and retrying
          if (response.status !== 401) {
            return response;
          }

          const refreshedToken = await refreshAccessToken();
          if (!refreshedToken) {
            clearStoredAccessToken();
            redirectToCoreLogin();
            return response;
          }

          const retryHeaders = new Headers(init.headers);
          retryHeaders.set('Authorization', `Bearer ${refreshedToken}`);
          return fetch(input, { ...init, headers: retryHeaders });  // Retry with new token
        },
      },
      auth: {
        persistSession: false,  // <-- Don't use localStorage
      },
    }
  );

  return browserAuthedClient;
}
```

**What this does:**
- Creates Supabase client with custom fetch handler
- Token is injected via `Authorization: Bearer <token>` header
- On 401, automatically refreshes and retries
- Does NOT use localStorage
- Is a singleton (cached in browserAuthedClient)

---

## Part 8: ENVIRONMENT VARIABLES (Required for Auth to Work)

**File**: `.env.example`

### Login Phase (Core Exchange)
- `CORE_EXCHANGE_URL`: Endpoint to exchange ticket for identity
- `CORE_ANON_KEY`: API key for Core requests (sent as `apikey` and `Authorization` header)
- `CORE_EXCHANGE_TIMEOUT_MS`: Timeout for Core exchange (default 15000ms)

### JWT Minting & Verification
- `SUPABASE_JWT_SECRET`: HS256 secret (at least 32 chars!) used to:
  - Sign access tokens
  - Sign refresh tokens
  - Verify refresh tokens (in /api/auth/refresh)
  - **NOT used to verify access tokens on server** (middleware only checks existence)

### Database & RLS
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Anon key for Supabase RLS
- `SUPABASE_SERVICE_ROLE_KEY`: Server-only service role key (admin operations)

### Redirects
- `NEXT_PUBLIC_CORE_APP_URL`: Where to redirect on logout / expired session
- `NEXT_PUBLIC_APP_URL`: This app's base URL

---

## Part 9: SECURITY ANALYSIS & GOTCHAS

### ✅ What's Secure

1. **HttpOnly Cookies**: Browser JavaScript cannot read tokens
2. **SameSite=Lax**: CSRF protection for state-changing requests
3. **Secure Flag in Production**: HTTPS only
4. **Proactive Refresh**: Client refreshes token before expiration
5. **Refresh Token Validation**: Server verifies refresh token signature
6. **Timeout on Core Exchange**: Prevents hanging requests
7. **No localStorage**: Tokens not exposed to XSS via storage API

### ⚠️ Potential Issues / Gotchas

1. **Server-side auth doesn't verify JWT signature**
   - Risk: If SUPABASE_JWT_SECRET is compromised, attacker could mint tokens
   - Mitigation: Secret is server-only, not exposed to client
   - Assumption: Middleware already validated the cookie exists

2. **No per-request JWT validation**
   - Each API route trusts that if cookie exists, JWT is valid
   - Works if middleware is the only security gate

3. **5-minute proactive refresh window**
   - Tokens refreshed 5 minutes before expiry
   - If network issues prevent refresh, requests will fail (by design)
   - User gets redirected to Core login

4. **No explicit logout on server**
   - Logout just clears cookies
   - Old JWT is still valid until expiration (7 days)
   - Tokens can't be revoked (stateless design)
   - If someone captures a token, it's valid for hours

5. **Token refresh doesn't rotate refresh token**
   - Same refresh token used for all refreshes
   - Refresh token valid for 7 days
   - If refresh token is captured, attacker can get access tokens for 7 days

6. **No CSRF token on refresh**
   - POST /api/auth/refresh only checks refresh token cookie
   - Should be safe due to SameSite=Lax, but monitor carefully

### ✋ KNOWN MISMATCHES IN CODE

From `docs/AUTH.md` section 13:

> Current mismatches in the tree:
> - No `/api/auth/exchange` route exists. (but dev-login page references it)
> - `/auth/callback` requires a 32-character ticket
> - Mock validator returns snake_case keys

These are real issues in the code that need fixing.

---

## Part 10: TRACING A REQUEST THROUGH THE ENTIRE AUTH SYSTEM

### Scenario: User goes from Core → Dashboard → API call

```
1. Core creates 32-char ticket
2. Core redirects to: http://localhost:3000/auth/callback?ticket=abc123...&target_org=org1
3. Browser makes GET /auth/callback?ticket=...
4. Middleware sees /auth/callback (not protected, no token needed)
5. Handler exchanges ticket with CORE_EXCHANGE_URL
6. Core returns { userId, tenantId, email, ... }
7. Handler mints:
   - access_token (1h) with sub, tenant_id, email claims
   - refresh_token (7d) with token_use: 'refresh'
8. Handler sets HttpOnly cookies
9. Handler redirects to /dashboard
10. Browser makes GET /dashboard
11. Middleware checks for access_token cookie ✓
12. Page loads, calls loadAccessToken()
13. loadAccessToken() fetches /api/auth/token
14. /api/auth/token returns cookie value { access_token: "jwt..." }
15. Token cached in memory
16. scheduleRefreshFromToken() sets timeout for 5min before expiry
17. Page makes Supabase call via createBrowserAuthedClient()
18. Custom fetch handler calls getValidAccessToken()
19. Returns cached token (if not expired)
20. Token injected as Authorization: Bearer header
21. Supabase RLS validates claims (tenant_id)
22. Request succeeds
23. 55 minutes later: timeout fires, calls refreshAccessToken()
24. refreshAccessToken() POSTs /api/auth/refresh
25. /api/auth/refresh validates refresh_token signature
26. Mints new access_token, updates cookie
27. New token scheduled for refresh
28. All future requests use new token
```

---

## Part 11: DEBUGGING TIPS

### Check if token is cached
```typescript
import { getStoredAccessToken } from '@/lib/auth-token';
console.log('Cached token:', getStoredAccessToken());
```

### Check token payload
```typescript
import { parseJwtPayload } from '@/lib/auth-token';
const token = "eyJ..."; // Your JWT
const payload = parseJwtPayload(token);
console.log(payload);
// Should have: sub, app_metadata.tenant_id, user_metadata.email
```

### Check if token is expired
```typescript
import { isJwtExpired } from '@/lib/auth-token';
console.log('Expired?', isJwtExpired(token));
```

### Check server-side auth
```typescript
import { getAuthContext } from '@/lib/auth';

export async function GET() {
  const auth = await getAuthContext();
  console.log('Auth context:', auth);
  // Should have: userId, tenantId, userEmail
}
```

### Force refresh
```typescript
import { refreshAccessToken } from '@/lib/auth-token';
await refreshAccessToken();
```

---

## Summary Table: Auth Flow Steps

| Step | Component | Time | Signature Check | Details |
|------|-----------|------|-----------------|---------|
| 1 | Core → Callback | Login | N/A | User redirected with ticket |
| 2 | Callback → Core | Login | N/A | Exchange ticket for identity |
| 3 | Callback → JWT Mint | Login | N/A | Create access + refresh tokens |
| 4 | Middleware | Every Request | Cookie exists only | Check `access_token` cookie exists |
| 5 | Client loadAccessToken() | On mount | N/A | Fetch token from `/api/auth/token` |
| 6 | Client scheduleRefresh | On load | Exp claim | Schedule refresh 5min before expiry |
| 7 | Supabase client | On API call | N/A | Inject as Authorization header |
| 8 | POST /api/auth/refresh | When expired | HS256 verify! | Verify refresh token signature |
| 9 | New access token cookie | After refresh | N/A | Updated in HttpOnly cookie |
| 10 | Server getAuthContext() | In API route | None! | Base64 decode payload |

---

## Remember

**This document describes the ACTUAL code behavior.**

If you find a discrepancy between this and the code, the code is right.

Last verified: 2026-02-16
