# From One Microservice Perspective

Last verified: 2026-02-18
Source of truth: runtime code

## 1) Scope
This document describes how auth, tickets, tenant isolation, and idempotency work in the Inventory Management microservice today, and how a shared microservice chassis should be built to make onboarding and service creation repeatable and safe.

## 2) Auth in this service (what actually runs)

### 2.1 Entry flow (browser)
- The home page at src/app/page.tsx looks for a Core ticket in the URL.
- If a ticket exists, the browser redirects to /auth/callback with ticket, target_org, and target_service.
- If no ticket exists, the page calls GET /api/auth/token and redirects to Core login when unauthenticated.

### 2.2 Ticket exchange and JWT minting
- GET /auth/callback is the core integration point. See src/app/auth/callback/route.ts.
- Ticket format: must be exactly 32 characters.
- target_service is required; missing target_service redirects to /error.
- The exchange request calls CORE_EXCHANGE_URL using CORE_ANON_KEY in both apikey and Authorization headers.
- The exchange response resolves identity as:
  - userId or user.id
  - tenantId or target_tenant_id
  - email/name/role if present
- The service mints two HS256 JWTs using SUPABASE_JWT_SECRET:
  - access_token, 1 hour
  - refresh_token, 7 days, includes token_use = refresh
- Tokens are stored in HttpOnly cookies (SameSite=Lax, Secure only in production).
- The handler redirects to /dashboard without exposing tokens in the URL.

### 2.2.1 SSO callback (step-by-step)
1) Entry
- Route: GET /auth/callback
- Inputs: ticket, target_org, target_tenant_id (optional), target_service (required)
- Cache control: no-store

2) Validation
- Reject missing target_service with /error?msg=missing_target_service
- Reject missing or non-32-char ticket with /error?msg=no_ticket

3) Exchange request
- URL: CORE_EXCHANGE_URL
- Headers:
  - Content-Type: application/json
  - apikey: CORE_ANON_KEY
  - Authorization: Bearer CORE_ANON_KEY
- Body:
  - ticket
  - target_service
  - target_org
  - target_tenant_id (currently set to target_org)
- Timeout: CORE_EXCHANGE_TIMEOUT_MS (default 15000)

4) Exchange response normalization
- Accepts these shapes:
  - userId or user.id
  - tenantId or target_tenant_id
  - email or user.email
  - name or user.full_name or user.name
  - role (defaults to authenticated)
- Fails if user id or tenant id is missing.

5) JWT minting (HS256)
- access_token claims include:
  - sub: user id
  - email
  - role: authenticated
  - app_metadata: { tenant_id, role }
  - user_metadata: { full_name, email, role }
- refresh_token includes the same claims plus token_use: refresh
- Signing key: SUPABASE_JWT_SECRET
- Expiration: access 1 hour, refresh 7 days

6) Cookie write
- access_token:
  - HttpOnly, SameSite=Lax, Secure in production, MaxAge 3600, Path /
- refresh_token:
  - HttpOnly, SameSite=Lax, Secure in production, MaxAge 604800, Path /

7) Redirect
- Success: redirect to /dashboard
- Failure: redirect to /error?msg=<error>

### 2.2.2 SSO callback contract (for chassis)
- Must be server-side only and never return tokens in a URL or body.
- Must log exchange failures with status and response body for diagnosis.
- Must enforce target_service and 32-char ticket checks before any exchange call.
- Must include tenant_id in app_metadata for RLS to work.
- Must use HttpOnly cookies as the only durable token storage.

### 2.3 Token endpoints
- GET /api/auth/token returns { access_token } from the cookie (no-store).
- POST /api/auth/refresh verifies refresh_token and mints a new access_token.
- POST /api/auth/logout clears cookies and returns a redirect URL.
- GET /api/auth/logout clears cookies and redirects to Core.
- GET /api/auth/session returns user_id, tenant_id, email from the access_token claims.
- DELETE /api/auth/session clears cookies.

### 2.4 Client-side token handling
- src/lib/auth-token.ts caches access_token in memory only.
- It schedules refresh at exp - 5 minutes.
- On auth errors it attempts a refresh once, then redirects to Core login.

### 2.5 Supabase client auth
- src/supabase/client.ts injects Authorization: Bearer <token> and retries once after refresh.
- src/lib/api-client.ts uses the same token for the API shim and retries once after refresh.

### 2.6 Middleware behavior
- middleware.ts protects API and page routes by checking only presence of access_token cookie.
- It does not verify JWT signature or claims.
- Missing cookie returns 401 JSON for API routes and a redirect for page routes.

### 2.7 Current mismatches and caveats
- The callback uses CORE_ANON_KEY, while some docs mention CORE_SUPABASE_ANON_KEY.
- Dev login posts to /api/auth/exchange, but that route does not exist.
- Mock SSO validator expects ticket_* format, but /auth/callback requires 32 characters.
- getAuthContext decodes the JWT payload without verifying the signature.

## 3) Tenant isolation (what enforces it)

### 3.1 Database enforcement
- RLS is enabled across tenant-scoped tables in inventory and supply_chain.
- Policies typically enforce tenant_id = public.current_tenant_id().
- inventory.auto_inject_tenant_id() injects tenant_id from JWT claims for inserts.
- public.current_tenant_id() resolves tenant id from JWT claims, supporting both:
  - app_metadata.tenant_id
  - app_metadata.tenantId

### 3.2 JWT claim contract
To keep tenant isolation consistent, every access token must include:
- sub (user id)
- app_metadata.tenant_id (preferred) or app_metadata.tenantId

## 4) Idempotency (what exists today)

### 4.1 Client-side idempotency
- apiWrite in src/lib/api-client.ts generates an Idempotency-Key header for writes.

### 4.2 Database-level idempotency
- Multiple RPCs and migrations enforce idempotency by event_id or last_event_id.
- Examples exist in migrations like:
  - 20260209000029_fix_create_receipt_jwt.sql
  - 20260209000030_auto_generate_receipt_number.sql
  - 20260209000016_reservation_destination_rpc.sql

### 4.3 Tests and checks
- tests/idempotency.spec.ts exercises idempotency for transfers, cycle counts, and webhooks.
- scripts/check-idempotency.mjs expects API mutation routes to enforce idempotency.

## 5) Tickets (what must be true for Core SSO to work)

### 5.1 Required inputs
- ticket (32 chars)
- target_service (required)
- target_org or target_tenant_id when applicable

### 5.2 Required environment variables
- CORE_EXCHANGE_URL
- CORE_ANON_KEY
- SUPABASE_JWT_SECRET
- NEXT_PUBLIC_CORE_APP_URL
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY

### 5.3 Required outputs
- access_token and refresh_token cookies must be set.
- access_token must include tenant_id claim for RLS.

## 6) Microservice chassis (what the shared skeleton should include)

### 6.1 Baseline structure
- src/app/auth/callback/route.ts
- src/app/api/auth/token/route.ts
- src/app/api/auth/refresh/route.ts
- src/app/api/auth/logout/route.ts
- src/app/api/auth/session/route.ts
- src/lib/auth.ts
- src/lib/auth-token.ts
- src/supabase/client.ts
- middleware.ts
- supabase/migrations/* (RLS + tenant triggers)
- scripts/check-idempotency.mjs
- tests/idempotency.spec.ts

### 6.2 Mandatory runtime guarantees
- Tickets are exchanged server-side only; never mint JWTs on the client.
- JWTs include tenant_id in app_metadata.
- Middleware blocks unauthenticated access.
- RLS and tenant policies are enabled on every tenant-scoped table.
- Mutations are idempotent at both API and DB layers.

### 6.3 Chassis API contract
Provide these endpoints in every service:
- GET /auth/callback (SSO exchange and cookie minting)
- GET /api/auth/token
- POST /api/auth/refresh
- POST + GET /api/auth/logout
- GET + DELETE /api/auth/session
- GET /api/health

### 6.4 RLS and tenant scaffolding
The chassis must include SQL templates for:
- tenant_id columns
- RLS enablement
- tenant isolation policies
- inventory.auto_inject_tenant_id or equivalent trigger
- public.current_tenant_id helper
- verification script (see supabase/snippets/verify_rls_policies.sql)

### 6.5 Idempotency scaffolding
The chassis must include:
- Standard Idempotency-Key handling for mutating HTTP routes
- last_event_id or event_id columns with unique constraints for event handlers
- Transactional writes for multi-table changes
- CI check equivalent to scripts/check-idempotency.mjs

### 6.6 Service onboarding checklist
- Auth: ticket exchange endpoint reachable, cookies set, refresh works.
- Tickets: target_service required and logged; Core exchange returns tenant_id.
- Tenant isolation: RLS enabled, policies present, triggers inject tenant_id.
- Idempotency: mutation routes reject missing Idempotency-Key.
- Events: outbox/poller wired if service emits domain events.
- Observability: auth exchange logs, RLS verification script, idempotency tests.

## 7) Recommendations to align docs and code
- Decide on CORE_ANON_KEY vs CORE_SUPABASE_ANON_KEY and standardize.
- Align dev-login or remove the missing /api/auth/exchange path.
- Align mock ticket format with the real callback length requirement.
- Consider JWT verification in middleware or at least in server handlers that trust claims.

## 8) Quick path for a new service
1) Copy the chassis skeleton.
2) Set required env vars and deploy a health endpoint.
3) Verify /auth/callback can mint tokens and access_token contains tenant_id.
4) Run RLS verification script and fix missing policies.
5) Add idempotency tests for the first mutation endpoint.
6) Only then build domain features.
