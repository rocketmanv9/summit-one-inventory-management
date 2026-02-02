# OPERATION CLEAN SLATE - Deletion Checklist

## Overview

With the ticket exchange endpoint and frontend hook in place, you can now delete the entire 80+ route API layer. The frontend will communicate directly with Supabase using the session token.

**After deletion:**
- ✅ 1 API route (exchange only)
- ✅ Frontend talks directly to Supabase
- ✅ No API client library needed
- ✅ Simpler, faster, fewer moving parts
- ✅ RLS policies handle security

---

## FOLDERS TO DELETE

### 1. ❌ DELETE ENTIRE: `src/app/api/inventory/`
All inventory routes - replaced by direct Supabase queries from frontend

**Files to delete:**
- `src/app/api/inventory/items/route.ts` ❌
- `src/app/api/inventory/locations/route.ts` ❌
- `src/app/api/inventory/categories/route.ts` ❌
- `src/app/api/inventory/movements/route.ts` ❌
- `src/app/api/inventory/[id]/route.ts` ❌
- `src/app/api/inventory/` (entire folder)

**Reason:** Frontend uses `supabase.from('inventory_items').select()` instead

---

### 2. ❌ DELETE ENTIRE: `src/app/api/supply-chain/`
All supply chain routes - replaced by direct Supabase queries

**Files to delete:**
- `src/app/api/supply-chain/orders/route.ts` ❌
- `src/app/api/supply-chain/vendors/route.ts` ❌
- `src/app/api/supply-chain/purchase-orders/route.ts` ❌
- `src/app/api/supply-chain/receiving/route.ts` ❌
- `src/app/api/supply-chain/[id]/route.ts` ❌
- `src/app/api/supply-chain/` (entire folder)

**Reason:** Frontend uses `supabase.from('purchase_orders').select()` instead

---

### 3. ❌ DELETE ENTIRE: `src/app/api/widgets/`
Widget management routes - replaced by direct Supabase queries

**Files to delete:**
- `src/app/api/widgets/route.ts` ❌
- `src/app/api/widgets/[id]/route.ts` ❌
- `src/app/api/widgets/` (entire folder)

**Reason:** Frontend uses `supabase.from('widgets').select()` instead

---

### 4. ❌ DELETE ENTIRE: `src/app/api/cycle-counts/`
Cycle count routes - replaced by direct Supabase queries

**Files to delete:**
- `src/app/api/cycle-counts/` (entire folder)

**Reason:** Frontend uses Supabase client directly

---

### 5. ❌ DELETE ENTIRE: `src/app/api/dashboard/`
Dashboard data routes - replaced by direct Supabase queries

**Files to delete:**
- `src/app/api/dashboard/` (entire folder)

**Reason:** Frontend uses `supabase.rpc('dashboard_summary')` instead

---

### 6. ❌ DELETE: `src/app/api/auth/` (Except `/exchange/`)
Old auth routes - replaced by new exchange endpoint

**Files to delete:**
- `src/app/api/auth/callback/route.ts` ❌
- `src/app/api/auth/login/route.ts` ❌
- `src/app/api/auth/logout/route.ts` ❌
- `src/app/api/auth/me/route.ts` ❌
- `src/app/api/auth/refresh/route.ts` ❌

**KEEP:**
- ✅ `src/app/api/auth/exchange/route.ts` - THE ONE AND ONLY

---

### 7. ❌ DELETE ENTIRE: `src/app/api/webhooks/` (EXCEPT if you have real webhooks)
If you have webhook receivers for Stripe, external services, etc., keep those.
If these are just "helper" routes for testing, delete them.

**Common candidates to delete:**
- `src/app/api/webhooks/stripe/route.ts` - Usually has alternatives
- `src/app/api/webhooks/test/route.ts` ❌

**Keep if:**
- Real external webhooks (Stripe, Twilio, etc.)
- Verified signature validation
- Required for production

---

### 8. ❌ DELETE: `src/app/api/mock/` (All mock endpoints)
These were for development/testing with the old wrapper pattern.

**Files to delete:**
- `src/app/api/mock/sso/validate/route.ts` ❌
- `src/app/api/mock/` (entire folder)

**Reason:** Exchange endpoint has built-in mock validation

---

## LIBRARY/UTILITY FILES TO DELETE

### 9. ❌ DELETE: `src/lib/api-wrapper.ts`
The old wrapper pattern - no longer needed

**Reason:** All routes deleted, frontend uses Supabase directly

---

### 10. ❌ DELETE: `src/lib/db-middleware.ts`
Database middleware for creating authenticated clients

**Reason:** Frontend creates Supabase client directly with exchange token

---

### 11. ❌ DELETE: `src/lib/secure-server-client.ts`
Secure server client factory

**Reason:** No longer used (was for API routes)

---

### 12. ❌ DELETE: `src/lib/api-error-handler.ts`
API error handling utilities

**Reason:** Routes are gone, error handling moves to frontend

---

### 13. ❌ DELETE: `src/lib/api-client.ts` (if exists)
Frontend API client library

**Reason:** Frontend uses `supabase` client directly now

---

## POTENTIALLY DELETE (Review First)

### 14. ? REVIEW: `src/lib/auth-errors.ts`
Error classes for authentication

**Decision:**
- If only used by deleted files → ❌ DELETE
- If used elsewhere → ✅ KEEP

**Search for usage:**
```bash
grep -r "AuthenticationError\|AuthorizationError" src/ --exclude-dir=app/api
```

---

### 15. ? REVIEW: `src/middleware.ts`
Request middleware

**Decision:**
- If protects API routes → Keep but update to only protect `/api/auth/exchange`
- If handles redirects for auth → Update to work with useTicketAuth hook

---

### 16. ? REVIEW: `src/lib/rpc.ts` (if exists)
RPC call utilities for API routes

**Decision:**
- If only calls API routes → ❌ DELETE
- If wraps Supabase RPC calls → ✅ KEEP and use directly in frontend

---

## FILES TO CREATE/UPDATE

### NEW: Frontend code to update calls

**Old pattern (API routes):**
```typescript
const response = await fetch('/api/inventory/items', {
  method: 'POST',
  body: JSON.stringify(data)
});
```

**New pattern (Supabase directly):**
```typescript
const { data, error } = await supabase
  .from('catalog_items')
  .insert(data)
  .select();
```

**Files that need updating:**
- `src/components/**/` - All dashboard components
- `src/pages/**/` - All page components
- `src/app/**/` - All app router components

---

## STEP-BY-STEP DELETION PROCESS

### Phase 1: Verify Exchange Works ✅ (Do this first)

```bash
# 1. Start dev server
npm run dev

# 2. Test exchange endpoint
curl -X POST http://localhost:3000/api/auth/exchange \
  -H "Content-Type: application/json" \
  -d '{"ticket": "ticket_test"}'

# 3. Verify response includes access_token
# Expected: { "access_token": "eyJ...", "user": { "id": "00000..." } }
```

If this works, proceed to Phase 2.

---

### Phase 2: Update Dashboard Components

Update your dashboard to use Supabase directly:

**Before:**
```typescript
const [items, setItems] = useState([]);

useEffect(() => {
  fetch('/api/inventory/items')
    .then(r => r.json())
    .then(d => setItems(d.data));
}, []);
```

**After:**
```typescript
const [items, setItems] = useState([]);
const supabase = createClientComponentClient();

useEffect(() => {
  supabase
    .from('catalog_items')
    .select()
    .then(({ data }) => setItems(data || []))
}, []);
```

---

### Phase 3: Add useTicketAuth to Root Layout

```typescript
// src/app/layout.tsx
import { useTicketAuth } from '@/hooks/use-ticket-auth';

export default function RootLayout({ children }) {
  const { isLoading, user, error } = useTicketAuth();
  
  if (isLoading) return <div>Authenticating...</div>;
  if (error) return <div>Auth error: {error}</div>;
  
  return (
    <SupabaseProvider>
      {children}
    </SupabaseProvider>
  );
}
```

---

### Phase 4: Test All Features

With Supabase client working:

```bash
# 1. Test with ticket URL
open "http://localhost:3000/?ticket=ticket_test"

# 2. Verify dashboard loads
# 3. Verify data displays
# 4. Test create operation
# 5. Test update operation
# 6. Test delete operation
```

---

### Phase 5: Delete API Routes

Only after everything works on Supabase direct calls:

```bash
# Delete inventory routes
rm -rf src/app/api/inventory/

# Delete supply chain routes
rm -rf src/app/api/supply-chain/

# Delete widget routes
rm -rf src/app/api/widgets/

# Delete cycle count routes
rm -rf src/app/api/cycle-counts/

# Delete dashboard routes
rm -rf src/app/api/dashboard/

# Delete old auth routes (keep exchange)
rm src/app/api/auth/callback/route.ts
rm src/app/api/auth/login/route.ts
rm src/app/api/auth/logout/route.ts
rm src/app/api/auth/me/route.ts
rm src/app/api/auth/refresh/route.ts

# Delete mock endpoints
rm -rf src/app/api/mock/

# Delete library files
rm src/lib/api-wrapper.ts
rm src/lib/db-middleware.ts
rm src/lib/secure-server-client.ts
rm src/lib/api-error-handler.ts
```

---

### Phase 6: Clean up Imports

Search for unused imports:

```bash
# Find all imports from deleted files
grep -r "from '@/lib/api-wrapper'" src/
grep -r "from '@/lib/db-middleware'" src/
grep -r "from '@/lib/secure-server-client'" src/
grep -r "createAuthenticatedClientOrThrow" src/
grep -r "handleApiError" src/
```

Remove those imports from all files.

---

## VERIFICATION CHECKLIST

After deletion, verify:

- [ ] Exchange endpoint still works
- [ ] useTicketAuth hook initializes
- [ ] Dashboard components load data from Supabase
- [ ] Create operations work
- [ ] Update operations work
- [ ] Delete operations work
- [ ] RLS policies enforce tenant isolation
- [ ] Error handling works for unauthorized access
- [ ] Token refresh handled automatically by Supabase
- [ ] URL cleaning works (ticket removed after auth)

---

## SAFETY NOTES

### 1. Backup First
```bash
git commit -m "checkpoint before clean slate"
git branch backup-before-clean-slate
```

### 2. Delete Incrementally
Don't delete everything at once. Delete one folder, test, then delete next.

### 3. Keep Webhooks
If you have real webhooks (Stripe, external services), keep `/api/webhooks/`.

### 4. Keep Auth Exchange
```bash
# This is the ONLY route you keep
✅ src/app/api/auth/exchange/route.ts
```

### 5. Test Before Merging
- Test on develop branch
- Test each feature
- Only merge to main when confident

---

## SIZE REDUCTION

### Before
```
src/app/api/ - ~80 routes
├── inventory/ - 20+ routes
├── supply-chain/ - 15+ routes
├── widgets/ - 10+ routes
├── cycle-counts/ - 10+ routes
├── dashboard/ - 8+ routes
├── auth/ - 5+ routes
└── webhooks/ - 5+ routes
```

### After
```
src/app/api/
└── auth/
    └── exchange/ - 1 route (the translator)
```

**Result: 80 routes → 1 route** ✂️

---

## FAQ

### Q: Won't RLS policies still work?
**A:** YES! The JWT minted by the exchange endpoint includes `app_metadata.tenant_id`. Supabase RLS reads this automatically. No changes needed to database.

### Q: How do users authenticate?
**A:** Core SSO generates a ticket → User visits app with `?ticket=XXXX` → useTicketAuth hook exchanges it → Frontend gets JWT → Uses Supabase directly

### Q: What if token expires?
**A:** Supabase client handles refresh automatically. You don't need to manage it.

### Q: Can I still have webhooks?
**A:** Yes! Keep `/api/webhooks/` for real webhooks (Stripe, external services). Delete test/mock webhooks.

### Q: Is this really faster?
**A:** Yes! Direct Supabase queries are faster than API route → Supabase hops. Plus fewer files to maintain.

### Q: What about API versioning?
**A:** No more API versions! RLS policies handle access control. Database is the source of truth.

---

## AFTER DELETION SUMMARY

```
From: 80+ API routes handling auth, data, validation
To:   1 API route (exchange only) + frontend talks directly to DB

Benefits:
✅ Simpler architecture
✅ Fewer moving parts
✅ Faster queries (no API hop)
✅ Easier to maintain
✅ RLS handles all security
✅ Direct database access from frontend
✅ No API middleware needed
```

---

**Ready to delete? Start with Phase 1 verification, then proceed incrementally.**
