# Architecture Diagrams & Visual Flow

## Overall Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT REQUEST                               │
│                   GET /api/inventory/items                          │
│           Header: x-sso-ticket=ticket_dev_test                      │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    API ROUTE HANDLER                                │
│  export const GET = withAuth(async (req, ctx) => { ... });          │
│                                                                       │
│  withAuth() is a Higher-Order Function that wraps the handler       │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼ (1. EXTRACT)
┌─────────────────────────────────────────────────────────────────────┐
│          EXTRACT AUTHENTICATION (withAuth)                          │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Check sources for ticket (in order):                       │   │
│  │  1. x-sso-ticket header                                     │   │
│  │  2. inventory_ticket cookie                                 │   │
│  │  3. ticket query parameter                                  │   │
│  │                                                               │   │
│  │  Found? → Use Ticket Flow                                   │   │
│  │  Not found? → Fall back to Session Flow (legacy)            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  Ticket Flow (NEW):                                                 │
│    ticket_dev_test → Validate → { user_id, tenant_id, role }      │
│                                                                       │
│  Session Flow (LEGACY):                                             │
│    inventory_session cookie → Parse → { userId, tenantId, ... }    │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼ (2. VALIDATE)
┌─────────────────────────────────────────────────────────────────────┐
│        VALIDATE TICKET WITH CORE API (withAuth)                     │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Production:                                                 │   │
│  │  GET https://core.summit-one.app/api/auth/validate-sso-     │   │
│  │      ticket?ticket=ticket_dev_test                          │   │
│  │                                                               │   │
│  │  Development:                                                │   │
│  │  GET http://localhost:3000/api/mock/sso/validate?           │   │
│  │      ticket=ticket_dev_test                                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  Response:                                                           │
│  {                                                                   │
│    "user_id": "00000000-0000-0000-0000-000000000000",              │
│    "tenant_id": "11111111-1111-1111-1111-111111111111",            │
│    "email": "user@example.com",                                     │
│    "role": "authenticated"                                          │
│  }                                                                   │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼ (3. MINT JWT)
┌─────────────────────────────────────────────────────────────────────┐
│        MINT SCOPED JWT (The Bridge to RLS)                          │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  JWT Payload:                                                │   │
│  │  {                                                            │   │
│  │    "sub": "00000000-0000-0000-0000-000000000000",           │   │
│  │    "role": "authenticated",                                  │   │
│  │    "app_metadata": {                                         │   │
│  │      "tenant_id": "11111111-1111-1111-1111-111111111111"    │   │
│  │    },                                                        │   │
│  │    "iat": 1234567890,                                        │   │
│  │    "exp": 1234571490                         (1 hour from now)  │   │
│  │  }                                                            │   │
│  │                                                               │   │
│  │  Signed with: SUPABASE_JWT_SECRET                            │   │
│  │  Algorithm: HS256                                            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0... │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼ (4. INIT CLIENT)
┌─────────────────────────────────────────────────────────────────────┐
│        INITIALIZE SUPABASE CLIENT (withAuth)                        │
│                                                                       │
│  createClient(                                                      │
│    NEXT_PUBLIC_SUPABASE_URL,                                       │
│    NEXT_PUBLIC_SUPABASE_ANON_KEY,  ← NOT service role              │
│    {                                                                │
│      global: {                                                      │
│        headers: {                                                   │
│          Authorization: `Bearer ${jwt}`                            │
│        }                                                             │
│      }                                                               │
│    }                                                                 │
│  );                                                                  │
│                                                                       │
│  ✅ anon_key + RLS policies will enforce tenant isolation           │
│  ✅ No service role (no cross-tenant leaks)                         │
│  ✅ JWT in header so RLS can read tenant_id                        │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼ (5. BUILD CONTEXT)
┌─────────────────────────────────────────────────────────────────────┐
│        BUILD AUTHENTICATION CONTEXT                                 │
│                                                                       │
│  AuthContext = {                                                    │
│    supabase: <SupabaseClient>,                                     │
│    user: {                                                          │
│      id: "00000000-0000-0000-0000-000000000000",                   │
│      email: "user@example.com",                                     │
│      role: "authenticated"                                          │
│    },                                                               │
│    tenantId: "11111111-1111-1111-1111-111111111111",               │
│    params: { ... }  ← Route dynamic parameters                     │
│  }                                                                   │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼ (6. EXECUTE HANDLER)
┌─────────────────────────────────────────────────────────────────────┐
│        EXECUTE ROUTE HANDLER                                        │
│                                                                       │
│  export const GET = withAuth(async (req, ctx) => {                  │
│    const { supabase, tenantId, user } = ctx;                       │
│                                                                       │
│    const { data, error } = await supabase                          │
│      .from('catalog_items')                                        │
│      .select();                                                     │
│      // ^ RLS filter applied automatically                         │
│      // Only sees items where tenant_id = ctx.tenantId             │
│                                                                       │
│    if (error) throw error;  ← withAuth catches & formats           │
│                                                                       │
│    return NextResponse.json({ data });                             │
│  });                                                                 │
│                                                                       │
│  ✅ No manual auth setup                                            │
│  ✅ No try/catch needed                                             │
│  ✅ No error handling boilerplate                                   │
│  ✅ RLS works automatically                                         │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼ (7. RETURN RESPONSE)
┌─────────────────────────────────────────────────────────────────────┐
│                    RESPONSE TO CLIENT                               │
│                                                                       │
│  Success (200):                                                     │
│  {                                                                   │
│    "data": [                                                        │
│      { "id": "...", "name": "Item A", "tenant_id": "11111..." }   │
│    ]                                                                 │
│  }                                                                   │
│                                                                       │
│  Error (401):                                                       │
│  {                                                                   │
│    "error": "Unauthorized: Invalid ticket or session"               │
│  }                                                                   │
│                                                                       │
│  Error (500):                                                       │
│  {                                                                   │
│    "error": "Internal Server Error"                                 │
│  }                                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Authentication Flow Comparison

### BEFORE: Manual Auth Per Route (80+ copies)

```
Route Handler
  ├─ Import createAuthenticatedClientOrThrow
  ├─ Import handleApiError
  ├─ try {
  │   ├─ Call createAuthenticatedClientOrThrow(request)
  │   ├─ Check if result is NextResponse (error)
  │   ├─ Destructure { client, context }
  │   ├─ Destructure { userId, tenantId, ... } from context
  │   ├─ Business logic
  │   └─ Return NextResponse.json()
  │ } catch (error) {
  │   └─ return handleApiError(error)
  └─ }
  
❌ ~50 lines per route
❌ Duplicated 80+ times
❌ Hard to modify (touches 80 files)
❌ Inconsistent implementations
```

### AFTER: Centralized Auth via Wrapper (1 location)

```
Route Handler
  ├─ Import { withAuth } from '@/lib/api-wrapper'
  ├─ export const GET = withAuth(async (req, ctx) => {
  │   ├─ Destructure { supabase, tenantId, user } from ctx
  │   ├─ Business logic
  │   └─ return NextResponse.json()
  └─ })

withAuth Wrapper
  ├─ Extract ticket/session
  ├─ Validate authentication
  ├─ Mint JWT if needed
  ├─ Initialize client
  ├─ Build context
  ├─ Execute handler
  └─ Catch errors

✅ ~15 lines per route
✅ One wrapper location (src/lib/api-wrapper.ts)
✅ Change auth once = all routes updated
✅ Consistent implementations
```

---

## Ticket Validation Sources (Priority Order)

```
incoming request
       │
       ▼
┌──────────────────────────────────────────────────┐
│ Check for x-sso-ticket header?                   │
├──────────────────────────────────────────────────┤
│ if (req.headers.get('x-sso-ticket')) {           │
│   ✅ FOUND → use it (highest priority)            │
│ }                                                │
└──────────────────────────────────────────────────┘
       │
       ├─ NOT FOUND
       ▼
┌──────────────────────────────────────────────────┐
│ Check for inventory_ticket cookie?               │
├──────────────────────────────────────────────────┤
│ if (req.cookies.get('inventory_ticket')) {       │
│   ✅ FOUND → use it (2nd priority)                │
│ }                                                │
└──────────────────────────────────────────────────┘
       │
       ├─ NOT FOUND
       ▼
┌──────────────────────────────────────────────────┐
│ Check for ticket query parameter?                │
├──────────────────────────────────────────────────┤
│ if (searchParams.get('ticket')) {                │
│   ✅ FOUND → use it (3rd priority, dev only)     │
│ }                                                │
└──────────────────────────────────────────────────┘
       │
       ├─ NOT FOUND (Try next flow)
       ▼
┌──────────────────────────────────────────────────┐
│ No ticket found → Fall back to session           │
│ (for backward compatibility)                     │
└──────────────────────────────────────────────────┘
```

---

## RLS Enforcement

### Without RLS (DANGEROUS - old service role approach)

```
Client 1 (Tenant A)          Client 2 (Tenant B)
  │                            │
  └─→ /api/inventory/items ←─┘
       │
       ├─ Uses service role (has full access)
       │
       ├─ Developer manually filters:
       │  WHERE tenant_id = ? 
       │  (easy to forget!)
       │
       ├─ Client 1 ← ALL ITEMS (Tenant A + B) ❌
       └─ Client 2 ← ALL ITEMS (Tenant A + B) ❌
       
RISK: Single manual WHERE clause bug = data leak
```

### With RLS (SAFE - new JWT approach)

```
Client 1 (Tenant A)
  ├─ SSO Ticket → Mint JWT with tenant_id=A
  │
  └─→ /api/inventory/items
       ├─ Supabase extracts tenant_id from JWT
       ├─ Enforces RLS:
       │  SELECT * FROM catalog_items
       │  WHERE tenant_id = auth.jwt()->>'app_metadata'->>'tenant_id'
       │
       └─ Client 1 ← Items for Tenant A only ✅

Client 2 (Tenant B)
  ├─ SSO Ticket → Mint JWT with tenant_id=B
  │
  └─→ /api/inventory/items
       ├─ Supabase extracts tenant_id from JWT
       ├─ Enforces RLS:
       │  SELECT * FROM catalog_items
       │  WHERE tenant_id = auth.jwt()->>'app_metadata'->>'tenant_id'
       │
       └─ Client 2 ← Items for Tenant B only ✅

SAFETY: RLS enforced at database layer (can't be bypassed)
NO manual WHERE clause needed
```

---

## Migration Timeline

```
PHASE 1: Infrastructure (DONE) ✅
────────────────────────────────
Day 1:  Create api-wrapper.ts (withAuth)
Day 1:  Create mock SSO endpoint
Day 1:  Update db-middleware (ticket support)
Day 1:  Refactor inventory/items example
        └─ Ready to test

        Status: Foundation ready, development unblocked


PHASE 2: Rolling Migration (Next) ⏳
────────────────────────────────────
Week 1: Refactor 10 routes (1 per day)
        └─ Test each on develop branch

Week 2: Refactor 10 more routes
        └─ Confident the pattern works

Week 3: Refactor 10 more routes
        └─ Momentum building

Week 4: Refactor 10 more routes

Week 5: Refactor 10 more routes
Week 6: Refactor remaining ~29 routes
        └─ Total: ~79 routes converted


PHASE 3: Deprecation (After all routes) 🗑️
────────────────────────────────────────────
Remove old code:
  ├─ createAuthenticatedClientOrThrow()
  ├─ secure-server-client.ts
  ├─ handleApiError.ts
  └─ Old session middleware

        Status: All routes use new pattern


PHASE 4: Production (When Core ready) 🚀
──────────────────────────────────────────
Set environment variable:
  NEXT_PUBLIC_CORE_URL=https://core.summit-one.app

Automatic behavior:
  ├─ Mock SSO disabled (fallback only)
  ├─ Real Core API called for all tickets
  └─ Full production ticket-based SSO active

        Status: Production ticket-based SSO live
```

---

## Code Size Impact

```
BEFORE: Per-route auth boilerplate
─────────────────────────────────

Route 1 (GET /api/inventory/items)
  50 lines (25 for auth setup)
  
Route 2 (POST /api/inventory/items)
  55 lines (25 for auth setup)
  
Route 3 (GET /api/users)
  45 lines (25 for auth setup)

... repeat 77 more times ...

Route 80 (DELETE /api/widgets/:id)
  40 lines (25 for auth setup)

TOTAL: ~4000 lines of code
DUPLICATED: ~2000 lines (25 lines × 80 routes)


AFTER: Centralized auth wrapper
────────────────────────────────

src/lib/api-wrapper.ts
  331 lines (defines withAuth, all auth logic)

Route 1 (GET /api/inventory/items)
  ✂️  30 lines (removed auth setup)
  
Route 2 (POST /api/inventory/items)
  ✂️  30 lines (removed auth setup)
  
Route 3 (GET /api/users)
  ✂️  20 lines (removed auth setup)

... repeat 77 more times ...

Route 80 (DELETE /api/widgets/:id)
  ✂️  15 lines (removed auth setup)

TOTAL: ~2700 lines of code
SAVED: ~1300 lines (avoid duplication)
SIMPLIFIED: 80 routes (all follow same pattern)
```

---

## Error Handling Flow

```
Route Handler throws error
       │
       ▼
┌─────────────────────────────────────────────────┐
│ try { ... } catch (error) in withAuth           │
└──────────────┬──────────────────────────────────┘
               │
               ▼
        ┌──────────────────┐
        │ handleApiError   │
        └────────┬─────────┘
                 │
        ┌────────┴─────────────────────┬──────────────────┬─────────┐
        │                              │                  │         │
        ▼                              ▼                  ▼         ▼
  "Unauthorized"        "Invalid..."           "Forbidden"      Other
        │                    │                    │              │
        ▼                    ▼                    ▼              ▼
    401 Error           400 Error             403 Error      500 Error
        │                    │                    │              │
        ▼                    ▼                    ▼              ▼
  { error:             { error:                { error:        { error:
    "Unauthorized" }    "Invalid..." }          "Forbidden" }   "Internal..." }

✅ Consistent response format
✅ No accidental info leaks
✅ Proper HTTP status codes
✅ Centralized logic
```

---

## Environment Variable Selection

```
NEXT_PUBLIC_CORE_URL environment variable
         │
         ├─ Set to https://core.summit-one.app
         │  │
         │  └─→ Use real Core API
         │      GET https://core.summit-one.app/api/auth/validate-sso-ticket
         │
         └─ NOT set (development)
            │
            └─→ Use mock endpoint
                GET http://localhost:3000/api/mock/sso/validate

                (Auto-detects by checking if NEXT_PUBLIC_CORE_URL exists)
```

---

This visual guide should help understand the flow and design of the new authentication architecture.
