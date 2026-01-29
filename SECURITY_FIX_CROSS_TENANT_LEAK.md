# CRITICAL SECURITY FIX: Cross-Tenant Data Leak Elimination

**Date**: January 29, 2026  
**Severity**: 🔴 **CRITICAL**  
**Status**: ✅ **PARTIALLY REMEDIATED** (infrastructure ready, full deployment pending)

---

## EXECUTIVE SUMMARY

### The Problem
ALL ~95 user-facing API routes were vulnerable to cross-tenant data leaks because they:
1. Used **service role** (bypasses ALL RLS policies)
2. Trusted **x-tenant-id header** from **client cookies** (easily spoofed)
3. Relied on manual `.eq('tenant_id', tenantId)` filtering (can be forgotten)

### Attack Vector
```
Attacker logs in as tenant-A → Modifies cookie to tenant-B → 
API reads spoofed cookie → Service role bypasses RLS → 
Manual filter uses spoofed tenant_id → 🚨 ACCESS TO tenant-B DATA
```

### The Fix
- ✅ Created **JWT-based authenticated client** (uses RLS, not service role)
- ✅ Added **database triggers** to auto-inject tenant_id from JWT
- ✅ Added **RLS WITH CHECK** policies (belt-and-suspenders)
- ✅ Hardened **webhook routes** to verify tenant from HMAC-signed payload
- ✅ Created **security tests** to prove cross-tenant access is blocked
- ⏳ **Remaining**: Update all ~95 API routes to use new pattern

---

## DETAILED AUDIT RESULTS

### Routes Analyzed: 107 total

#### 🟢 **LOW RISK** (Machine/Webhook Routes - Verified Identity)
| Route | Auth Method | Tenant Source | Status |
|-------|-------------|---------------|--------|
| `/api/webhooks/core-events` | HMAC signature | Verified webhook payload | ✅ FIXED |

#### 🔴 **CRITICAL RISK** (User Routes - Cookie-based)
| Route Category | Count | Current Auth | Risk | Remediation Status |
|----------------|-------|--------------|------|-------------------|
| `/api/inventory/*` | ~70 | Service role + cookie | CRITICAL | ⏳ 1 example fixed |
| `/api/supply-chain/*` | ~15 | Service role + cookie | CRITICAL | ⏳ Pending |
| `/api/widgets/*` | ~5 | Service role + cookie | CRITICAL | ⏳ Pending |
| `/api/dashboards/*` | ~4 | Service role + cookie | CRITICAL | ⏳ Pending |
| `/api/tenant` | 1 | Service role + cookie | CRITICAL | ⏳ Pending |

**Total Vulnerable Routes**: ~95

---

## FILES CHANGED

### 1. New Security Infrastructure ✅
- **[src/lib/secure-server-client.ts](src/lib/secure-server-client.ts)** (NEW)
  - `createAuthenticatedClient()` - JWT + RLS for user routes
  - `createAuthenticatedClientFromCookie()` - Cookie-based JWT client
  - `createVerifiedServiceClient()` - Service role ONLY for verified machine routes
  
### 2. Database Security Hardening ✅
- **[supabase/migrations/20260129000001_fix_rls_tenant_injection.sql](supabase/migrations/20260129000001_fix_rls_tenant_injection.sql)** (NEW)
  - Adds `auto_inject_tenant_id()` trigger function
  - Applies trigger to 10 critical tables (catalog_items, assets, stock_balances, etc.)
  - Adds `WITH CHECK` clause to RLS policies
  - **Status**: ✅ Applied to database successfully

### 3. Example Route Fixes ✅
- **[src/app/api/inventory/items/route.ts](src/app/api/inventory/items/route.ts)**
  - Before: Service role + manual tenant filter
  - After: JWT client + automatic RLS enforcement
  - **Pattern to replicate across all user routes**

- **[src/app/api/webhooks/core-events/route.ts](src/app/api/webhooks/core-events/route.ts)**
  - Before: Service role with unverified tenant
  - After: Verified service client with HMAC-validated tenant_id

### 4. Security Tests ✅
- **[__tests__/security/cross-tenant-access.test.ts](__tests__/security/cross-tenant-access.test.ts)** (NEW)
  - Tests cross-tenant read blocking
  - Tests cross-tenant write/update/delete blocking
  - Tests forged authorization headers
  - Tests service role requires explicit tenant_id

---

## HOW IT WORKS NOW

### Before (Insecure)
```typescript
export async function GET(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers); // From COOKIE!
  const supabase = createClient(); // SERVICE ROLE - bypasses RLS
  
  const { data } = await supabase
    .from('catalog_items')
    .select('*')
    .eq('tenant_id', tenantId); // Manual filter - can be spoofed
}
```

### After (Secure)
```typescript
export async function GET(request: NextRequest) {
  const auth = await createAuthenticatedClient(request); // Validates JWT
  
  if (!auth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  
  const { client: supabase, context } = auth;
  
  // NO manual tenant filter needed - RLS enforces automatically
  const { data } = await supabase
    .from('catalog_items')
    .select('*'); // RLS ensures only context.tenantId rows returned
}
```

### Database Protection (Defense in Depth)
```sql
-- Trigger: Auto-injects tenant_id on INSERT from JWT
CREATE TRIGGER auto_inject_tenant_catalog_items
  BEFORE INSERT ON inventory.catalog_items
  FOR EACH ROW
  EXECUTE FUNCTION inventory.auto_inject_tenant_id();

-- RLS Policy: Blocks access to other tenants
CREATE POLICY catalog_items_tenant_isolation ON inventory.catalog_items
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
```

**Result**: Even if code forgets to filter by tenant_id, the database BLOCKS cross-tenant access.

---

## DEPLOYMENT PLAN

### Phase 1: Infrastructure (DONE ✅)
- [x] Create `secure-server-client.ts` helper
- [x] Create and apply RLS migration
- [x] Fix 2 example routes (items, webhooks)
- [x] Create security tests

### Phase 2: Route Migration (NEXT STEP ⏳)
**For EACH of the ~95 user-facing API routes:**

1. **Import new client**:
   ```typescript
   import { createAuthenticatedClient } from '@/lib/secure-server-client';
   ```

2. **Replace auth logic**:
   ```typescript
   // OLD
   const tenantId = getTenantIdFromHeaders(request.headers);
   const supabase = createClient();
   
   // NEW
   const auth = await createAuthenticatedClient(request);
   if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
   const { client: supabase, context } = auth;
   ```

3. **Remove manual tenant filtering**:
   ```typescript
   // OLD
   .eq('tenant_id', tenantId)
   
   // NEW
   // (remove - RLS handles it)
   ```

4. **Test**:
   - Verify route still works for authenticated user
   - Verify route blocks cross-tenant access
   - Run security test suite

### Phase 3: Validation (AFTER MIGRATION)
- [ ] Run full security test suite
- [ ] Manual penetration testing (try to access other tenant's data)
- [ ] Code review: grep for `getTenantIdFromHeaders` (should be 0 results in user routes)
- [ ] Code review: grep for `SUPABASE_SERVICE_ROLE_KEY` (should only be in machine routes)

---

## VERIFICATION CHECKLIST

### Database RLS ✅
```bash
# Check triggers are active
docker exec supabase_db_summit-one-inventory-management psql -U postgres -d postgres -c "
SELECT tgname, tgrelid::regclass 
FROM pg_trigger 
WHERE tgname LIKE 'auto_inject_tenant%';"

# Expected: 10 triggers (catalog_items, assets, stock_balances, etc.)
```

### Route Security ⏳
```bash
# Search for remaining insecure patterns
grep -r "getTenantIdFromHeaders" src/app/api/
grep -r "createClient()" src/app/api/ | grep -v "createAuthenticatedClient"

# Expected: Should only appear in machine/webhook routes after migration
```

### Tests ⏳
```bash
npm test -- __tests__/security/cross-tenant-access.test.ts

# Expected: ALL tests pass (cross-tenant access blocked)
```

---

## RISK ASSESSMENT

### Before This Fix
- **Cross-Tenant Data Leak**: 🔴 **CRITICAL** (trivially exploitable)
- **Data Integrity**: 🔴 **CRITICAL** (users could modify other tenants' data)
- **Compliance**: 🔴 **FAIL** (GDPR, SOC2, ISO 27001 violations)

### After Full Deployment
- **Cross-Tenant Data Leak**: 🟢 **MITIGATED** (blocked by JWT + RLS + triggers)
- **Data Integrity**: 🟢 **PROTECTED** (RLS enforces write isolation)
- **Compliance**: 🟢 **PASS** (provably secure tenant isolation)

---

## NEXT STEPS (IN ORDER)

1. **Review this document** with team/stakeholders
2. **Apply the pattern** to remaining ~93 API routes (start with highest-traffic routes)
3. **Run security tests** after each batch of 10-15 routes
4. **Deploy to staging** and run penetration tests
5. **Code freeze** on API changes during migration
6. **Deploy to production** with monitoring
7. **Audit logs** for any failed authorization attempts
8. **Remove deprecated helpers** (`getTenantIdFromHeaders`, old `createClient`)

---

## REFERENCES

### Secure Patterns
- ✅ **User routes**: Use `createAuthenticatedClient()` with JWT
- ✅ **Machine routes**: Use `createVerifiedServiceClient(verified_tenant_id)`
- ❌ **NEVER**: Trust `x-tenant-id` header or cookie value
- ❌ **NEVER**: Use service role for user-initiated requests

### Testing
- Run tests: `npm test -- __tests__/security/cross-tenant-access.test.ts`
- Manual test: Try to modify `inventory_session` cookie and access other tenant's data
- Expected: 401 Unauthorized or empty dataset (RLS blocks access)

---

## QUESTIONS?

Contact the security team or the engineer who created this fix for clarification.

**This is a CRITICAL security issue. Do not delay deployment.**
