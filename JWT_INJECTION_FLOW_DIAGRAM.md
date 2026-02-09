# JWT Injection - Visual Flow Diagram

## The Complete Auth Flow (With JWT)

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  STEP 1: User Lands with Ticket (from Core)                         │
│                                                                       │
│  Browser: http://localhost:3000/?ticket=ticket_abc123xyz...         │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  STEP 2: Home Page Detects Ticket (src/app/page.tsx)               │
│                                                                       │
│  useEffect() {                                                       │
│    if (ticket in URL) {                                              │
│      redirect to /auth/callback?ticket=...                          │
│    }                                                                  │
│  }                                                                    │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  STEP 3: Backend Validates Ticket (src/app/auth/callback/route.ts) │
│                                                                       │
│  GET /auth/callback?ticket=ticket_abc123xyz...                       │
│                                                                       │
│  1. Validate ticket (length must be 32)                              │
│  2. Call CORE_EXCHANGE_URL with ticket                               │
│     POST https://dev.summit-one.app/api/auth/exchange               │
│     Body: { ticket: "ticket_abc123xyz..." }                          │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  STEP 4: Core Responds with User & Tenant Info                      │
│                                                                       │
│  Response:                                                            │
│  {                                                                    │
│    "user": {                                                          │
│      "id": "00000000-0000-0000-0000-000000000000",                   │
│      "email": "user@summit-one.app"                                  │
│    },                                                                 │
│    "target_tenant_id": "11111111-1111-1111-1111-111111111111"       │
│  }                                                                    │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  ⭐ STEP 5: MINT JWT (NEW!)                                          │
│                                                                       │
│  import { SignJWT } from 'jose';                                     │
│                                                                       │
│  const secretKey = new TextEncoder().encode(                         │
│    process.env.SUPABASE_JWT_SECRET  ← from .env.local               │
│  );                                                                   │
│                                                                       │
│  const accessToken = await new SignJWT({                             │
│    sub: "00000000-0000-0000-0000-000000000000",  ← user_id          │
│    role: "authenticated",                                            │
│    app_metadata: {                                                   │
│      tenant_id: "11111111-1111-1111-1111-111111111111"  ← tenant_id │
│    }                                                                  │
│  })                                                                   │
│    .setProtectedHeader({ alg: 'HS256' })                             │
│    .setIssuedAt()                                                    │
│    .setExpirationTime('1h')                                          │
│    .sign(secretKey);  ← Signs using SUPABASE_JWT_SECRET              │
│                                                                       │
│  Result: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJz...               │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  STEP 6: Set Session Cookies (Backup)                               │
│                                                                       │
│  cookieStore.set('user_id', "000...000", { httpOnly: true })        │
│  cookieStore.set('tenant_id', "111...111", { httpOnly: true })      │
│  cookieStore.set('user_email', "user@summit-one.app", ...)          │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  STEP 7: Redirect with JWT in URL                                   │
│                                                                       │
│  return NextResponse.redirect(                                       │
│    /dashboard?access_token=JWT&refresh_token=dummy-refresh-token    │
│  );                                                                   │
│                                                                       │
│  Browser URL becomes:                                                │
│  http://localhost:3000/dashboard?access_token=eyJh...&refresh_...   │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  ⭐ STEP 8: HYDRATE SESSION (NEW!)                                   │
│                                                                       │
│  Location: src/components/AuthSessionHydrator.tsx                    │
│  Mounted in: src/app/layout.tsx                                      │
│                                                                       │
│  useEffect() {                                                       │
│    const accessToken = searchParams.get('access_token');             │
│    const refreshToken = searchParams.get('refresh_token');           │
│                                                                       │
│    if (accessToken && refreshToken) {                                │
│      const supabase = createClient(URL, ANON_KEY);                  │
│                                                                       │
│      await supabase.auth.setSession({                                │
│        access_token: accessToken,     ← JWT from URL                 │
│        refresh_token: refreshToken    ← dummy                        │
│      });                                                              │
│                                                                       │
│      window.history.replaceState({}, '', '/dashboard');              │
│      // URL now clean: http://localhost:3000/dashboard              │
│    }                                                                  │
│  }                                                                    │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  STEP 9: Dashboard Page Loads                                       │
│                                                                       │
│  At this point:                                                      │
│  ✅ Supabase client has JWT in its auth session                     │
│  ✅ JWT includes tenant_id in app_metadata                          │
│  ✅ URL is clean (tokens removed)                                   │
│  ✅ Ready to query database                                         │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  ⭐ STEP 10: COMPONENTS CALL SUPABASE (RLS Works Now!)               │
│                                                                       │
│  // In any dashboard component:                                      │
│  const supabase = createClient();                                    │
│  const { data } = await supabase                                     │
│    .from('catalog_items')                                            │
│    .select();                                                        │
│                                                                       │
│  Behind the scenes:                                                  │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │ Request to Supabase:                                       │     │
│  │ GET /rest/v1/catalog_items                                │     │
│  │ Authorization: Bearer eyJhbGciOiJIUzI1NiIs...JWT...       │     │
│  │                                                            │     │
│  │ Supabase validates:                                       │     │
│  │ 1. JWT signature (verified with SUPABASE_JWT_SECRET)     │     │
│  │ 2. Extract tenant_id from JWT payload                     │     │
│  │ 3. Apply RLS policy:                                      │     │
│  │    WHERE tenant_id = auth.jwt() -> 'app_metadata'..       │     │
│  │          -> 'tenant_id'                                   │     │
│  │ 4. Only return rows matching the tenant                   │     │
│  │                                                            │     │
│  │ Response: Only YOUR tenant's items                         │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Why This Works (The Key Insight)

```
❌ BEFORE:
  Browser: supabase.from('items').select()
  ↓
  Supabase: "I have no JWT, I can't verify who this is"
  ↓
  RLS: "No claims to check, data might be empty or unfiltered"
  ↓
  Result: ❌ BROKEN - Data doesn't load correctly


✅ AFTER (With JWT Injection):
  Browser: supabase.from('items').select()
           (with Authorization: Bearer JWT in header)
  ↓
  Supabase: "I have a valid JWT, let me verify it"
  ↓
  JWT Check: "Signature is valid, tenant_id = '111...111'"
  ↓
  RLS: "tenant_id matches, return this user's data"
  ↓
  Result: ✅ WORKS - User sees only their tenant's data
```

---

## The JWT Payload (Decoded)

What's actually inside the JWT:

```json
{
  "sub": "00000000-0000-0000-0000-000000000000",
  "role": "authenticated",
  "app_metadata": {
    "tenant_id": "11111111-1111-1111-1111-111111111111"
  },
  "iat": 1707000000,
  "exp": 1707003600
}
```

- `sub`: User ID (subject claim)
- `role`: Role for Supabase (always "authenticated")
- `app_metadata.tenant_id`: **THE MAGIC** - This is what RLS checks!
- `iat`: Issued at timestamp
- `exp`: Expiration (1 hour from now)

---

## Data Flow Diagram

```
CORE SSO          INVENTORY APP             SUPABASE
    │                  │                        │
    │─ ticket ────────→│                        │
    │                  │                        │
    │                  │─ validate ticket ─────→│ (Core's API)
    │                  │                        │
    │                  │← user + tenant ←──────│
    │                  │                        │
    │                  │ ⭐ Mint JWT            │
    │                  │ Sign with SECRET       │
    │                  │                        │
    │                  │ Redirect with JWT ───→│ (browser)
    │                  │                        │
    │                  │ AuthSessionHydrator    │
    │                  │ setSession(JWT)        │
    │                  │                        │
    │                  │ Request: SELECT items  │
    │                  │ + Authorization: JWT ─→│
    │                  │                        │
    │                  │ Verify JWT             │
    │                  │ Extract tenant_id      │
    │                  │ Apply RLS filter       │
    │                  │                        │
    │                  │← Only tenant's data ←─│
    │                  │                        │
```

---

## Status Summary

| Component | Location | Status |
|-----------|----------|--------|
| **Callback Upgrade** | `src/app/auth/callback/route.ts` | ✅ JWT Minting Added |
| **Hydrator Component** | `src/components/AuthSessionHydrator.tsx` | ✅ NEW - Session Setup |
| **Layout Mount** | `src/app/layout.tsx` | ✅ Hydrator Mounted |
| **Environment** | `.env.local` | ✅ SUPABASE_JWT_SECRET Set |
| **JWT Library** | `package.json` | ✅ `jose` Installed |

---

## Testing Checklist

- [ ] Start dev server: `npm run dev`
- [ ] Visit with ticket: `http://localhost:3000/?ticket=ticket_dev_test_12345678901234567890`
- [ ] Check browser console for `[AuthSessionHydrator]` logs
- [ ] Verify URL changes from `/?ticket=...` to `/dashboard`
- [ ] Check that dashboard loads successfully
- [ ] Verify Supabase session has JWT: `supabase.auth.getSession()`
- [ ] Test a data fetch: `supabase.from('catalog_items').select()`
- [ ] Verify RLS filtering works (see only your tenant's data)

