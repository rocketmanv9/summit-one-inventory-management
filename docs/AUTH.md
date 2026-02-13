# Authentication

Last verified: 2026-02-13
Source of truth: runtime code

## 1) Overview
This service does not use Supabase Auth. It implements a custom Summit One Core SSO flow that exchanges a Core ticket for a Supabase-compatible JWT and stores it in HttpOnly cookies. The Core exchange and JWT minting live in [src/app/auth/callback/route.ts](src/app/auth/callback/route.ts).

## 2) Login flow (Core redirect to dashboard)
1. User lands on the home page in [src/app/page.tsx](src/app/page.tsx).
2. If the URL includes `ticket`, the client redirects to `/auth/callback?ticket=...` and forwards `target_org` when present.
3. `GET /auth/callback` validates the ticket length is 32 characters.
4. The callback calls `CORE_EXCHANGE_URL` with Core anon auth headers and body `{ ticket, target_org, target_service }`.
5. Identity is resolved from the exchange response fields: `userId` or `user.id`, `tenantId` or `target_tenant_id`, plus `email`, `name`, and `role` when present.
6. The service mints two HS256 JWTs with `SUPABASE_JWT_SECRET`:
   - `access_token` expiring in 1 hour
   - `refresh_token` expiring in 7 days with `token_use: 'refresh'`
7. The callback sets cookies `access_token` and `refresh_token` as HttpOnly, SameSite=Lax, Path=/, and Secure only in production.
8. The callback redirects to `/dashboard`.
9. Middleware in [middleware.ts](middleware.ts) allows access to protected routes only if `access_token` cookie exists.

If there is no ticket, the home page calls `/api/auth/token`. When unauthenticated, it redirects to `${NEXT_PUBLIC_CORE_APP_URL}/login`.

## 3) JWT claims
The access token payload minted by the callback contains:
- `sub` (user id)
- `email`
- `role: 'authenticated'`
- `app_metadata.tenant_id` and `app_metadata.role`
- `user_metadata.full_name`, `user_metadata.email`, `user_metadata.role`

The refresh token includes the same claims plus `token_use: 'refresh'`.

## 4) Token storage and retrieval
- Primary storage: HttpOnly cookies (`access_token`, `refresh_token`).
- Client cache: in-memory `cachedAccessToken` in [src/lib/auth-token.ts](src/lib/auth-token.ts).
- Client retrieval: `/api/auth/token` in [src/app/api/auth/token/route.ts](src/app/api/auth/token/route.ts).
- Tokens are not stored in localStorage.

## 5) Token lifecycle and refresh
Client-side logic in [src/lib/auth-token.ts](src/lib/auth-token.ts):
- `loadAccessToken()` fetches `/api/auth/token`, caches the token, and schedules refresh at $exp - 5\text{ minutes}$.
- `refreshAccessToken()` calls `POST /api/auth/refresh` and reloads the access token.
- On refresh failure, the in-memory token is cleared and the browser redirects to Core login.

Server-side refresh in [src/app/api/auth/refresh/route.ts](src/app/api/auth/refresh/route.ts):
- Requires a valid `refresh_token` cookie.
- Verifies HS256 signature with `SUPABASE_JWT_SECRET` and `token_use === 'refresh'`.
- Mints a new 1 hour access token and resets the `access_token` cookie.
- Returns `{ expiresAt }` with `Cache-Control: no-store`.

## 6) Supabase client auth
Client helpers in [src/supabase/client.ts](src/supabase/client.ts):
- `createAuthenticatedClient(accessToken)` injects `Authorization: Bearer <token>` globally.
- `createBrowserAuthedClient()` uses a custom fetch wrapper that:
  - Loads the token via `/api/auth/token`.
  - Injects the `Authorization` header.
  - On 401, calls `/api/auth/refresh` and retries once.

## 7) API client shim auth
The shim in [src/lib/api-client.ts](src/lib/api-client.ts) routes `/api/inventory/*` and `/api/supply-chain/*` to Supabase directly. On auth errors it calls `refreshAccessToken()` and retries once, then redirects to Core login on failure.

## 8) Server-side auth helpers
Helpers in [src/lib/auth.ts](src/lib/auth.ts):
- `getAuthContext()` reads `access_token` from cookies and base64-decodes the JWT payload (no signature verification).
- Required claims: `sub` and `app_metadata.tenant_id`.
- `requireAuth()` throws when missing.

## 9) Middleware protection
Middleware in [middleware.ts](middleware.ts) protects:
- `/api/:path*`, `/dashboard/:path*`, `/debug/:path*`, `/examples/:path*`, `/inventory/:path*`, `/operations/:path*`, `/purchasing/:path*`, `/settings/:path*`

Public API allowlist:
- `/api/health`
- `/api/auth/*`, `/api/mock/*`, `/api/debug/*`

Behavior:
- Protected API route without `access_token` cookie returns `401` JSON.
- Protected page route without `access_token` cookie redirects to `NEXT_PUBLIC_CORE_APP_URL` (or `/` fallback).

## 10) Tenant isolation and RLS
Tenant isolation is enforced in the database using RLS and tenant injection triggers. From migrations in [supabase/migrations](supabase/migrations):
- `inventory.auto_inject_tenant_id()` reads tenant from JWT in order:
  1) `app_metadata.tenant_id`
  2) `app_metadata.tenantId`
  3) root `tenant_id`
  It forces `NEW.tenant_id` to the JWT value and requires explicit tenant_id when using the service role.
- `public.current_tenant_id()` resolves tenant via `app.current_tenant_id` or the JWT paths above.

RLS policies across `inventory`, `supply_chain`, and selected `public` tables typically enforce `tenant_id = public.current_tenant_id()` with `USING` and `WITH CHECK` predicates.

## 11) Role enforcement
- Client-side: settings UI checks `app_metadata.role === 'admin'` in [src/app/(dashboard)/settings/page.tsx](src/app/(dashboard)/settings/page.tsx).
- RPC layer: [src/lib/rpc/supply-chain.ts](src/lib/rpc/supply-chain.ts) blocks `updateTenantSettings()` unless role is admin.
- Database: `supply_chain.rpc_update_tenant_settings` enforces admin role in the migration [supabase/migrations/20260213000000_enforce_admin_role_tenant_settings_rpc.sql](supabase/migrations/20260213000000_enforce_admin_role_tenant_settings_rpc.sql).

## 12) Logout
- `clearAuth()` in [src/lib/auth.ts](src/lib/auth.ts) deletes `access_token` and `refresh_token` cookies.
- `POST /api/auth/logout` clears cookies and returns `{ success, redirectUrl }`.
- `GET /api/auth/logout` clears cookies and redirects to Core base URL.
- `DELETE /api/auth/session` also clears cookies.

## 13) Dev and mock auth
Current dev-only code paths:
- `GET /api/mock/sso/validate` in [src/app/api/mock/sso/validate/route.ts](src/app/api/mock/sso/validate/route.ts) accepts `ticket_*` values and returns `{ user_id, tenant_id, role }`.
- `/dev-login` in [src/app/dev-login/page.tsx](src/app/dev-login/page.tsx) posts to `/api/auth/exchange` and calls `supabase.auth.setSession(...)`.

Current mismatches in the tree:
- No `/api/auth/exchange` route exists.
- `/auth/callback` requires a 32-character ticket while the mock validator expects `ticket_*`.
- The mock validator returns snake_case keys, but `/auth/callback` expects camelCase fields.

## 14) Auth-related environment variables
- CORE_EXCHANGE_URL: Core ticket exchange endpoint.
- CORE_SUPABASE_ANON_KEY: Core anon key for exchange requests.
- SUPABASE_JWT_SECRET: HS256 secret used to sign and verify JWTs.
- NEXT_PUBLIC_CORE_APP_URL: Core base URL for redirects.
- NEXT_PUBLIC_SERVICE_BASE_URL: Service base URL used by logout fallback.
- NEXT_PUBLIC_SUPABASE_URL: Supabase project URL.
- NEXT_PUBLIC_SUPABASE_ANON_KEY: Supabase anon key for client requests.
