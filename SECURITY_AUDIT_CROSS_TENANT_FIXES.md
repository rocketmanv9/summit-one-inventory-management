# Security Audit: Cross-Tenant Leak Remediation

**Date:** January 29, 2026  
**Engineer:** Summit Inventory Microservice Engineer  
**Severity:** CRITICAL

---

## 🚨 EXECUTIVE SUMMARY

**99+ API routes** had critical cross-tenant data leak vulnerabilities caused by:
1. **Service role key** used for user-driven operations (bypasses RLS)
2. **x-tenant-id header** blindly trusted from cookie session (client-controlled)
3. No JWT validation for user requests

**Risk:** Any authenticated user could access ANY tenant's data by modifying their session cookie.

---

## 📊 VULNERABILITY BREAKDOWN

| Category | Routes | Secure | Vulnerable | Fix Status |
|----------|--------|--------|------------|------------|
| USER-DRIVEN | 95+ | 1 | 94+ | 🔄 IN PROGRESS |
| MACHINE/DEVICE | 10+ | 0 | 10+ | 🔄 IN PROGRESS |
| WEBHOOK | 1 | 1 | 0 | ✅ SECURE |
| DEBUG/ADMIN | 6 | 0 | 6 | ⚠️ LOW RISK |
| AUTH | 6 | 6 | 0 | ✅ SECURE |
| **TOTAL** | **107** | **8** | **99+** | **92% VULNERABLE** |

---

## 🔍 ROOT CAUSE ANALYSIS

### **Vulnerable Pattern (94+ routes)**

```typescript
// ❌ CRITICAL SECURITY FLAW
import { getTenantIdFromHeaders, createClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  // 1. Get tenant from header (set by middleware from COOKIE)
  const tenantId = getTenantIdFromHeaders(request.headers);
  
  // 2. Create SERVICE ROLE client (bypasses RLS!)
  const supabase = createClient(); // Uses SUPABASE_SERVICE_ROLE_KEY
  
  // 3. Manual tenant filter (easily bypassed by modifying cookie)
  const { data } = await supabase
    .from('vendors')
    .select('*')
    .eq('tenant_id', tenantId); // ← User controls this value!
    
  return NextResponse.json({ data });
}
```

**Attack Vector:**
1. User logs in → receives session cookie with `{ tenantId: 'abc-123', userId: 'user-1' }`
2. User modifies cookie: `{ tenantId: 'VICTIM-TENANT-ID', userId: 'user-1' }`
3. Middleware reads modified cookie → sets `x-tenant-id: VICTIM-TENANT-ID`
4. API route trusts header → queries with VICTIM tenant ID
5. Service role bypasses RLS → **returns victim's data**

---

## ✅ SECURE PATTERNS

### **Pattern 1: JWT + RLS (User-Driven Routes)**

```typescript
// ✅ SECURE - Used in /api/auth/session-check
import { createAuthenticatedClient } from '@/lib/secure-server-client';

export async function GET(request: NextRequest) {
  // 1. Validate JWT from Authorization header
  const auth = await createAuthenticatedClient(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const { client: supabase, context } = auth;
  // context.tenantId from JWT app_metadata (cryptographically signed)
  // context.userId from JWT sub claim
  // client uses ANON key + JWT (not service role)
  
  // 2. Query with RLS enforcement (no manual tenant filter needed)
  const { data } = await supabase
    .from('vendors')
    .select('*');
    // RLS policy: WHERE tenant_id = auth.jwt() ->> 'app_metadata' ->> 'tenant_id'
    
  return NextResponse.json({ data });
}
```

**Why Secure:**
- JWT validated by Supabase Auth server
- `tenantId` from **signed JWT claims** (tamper-proof)
- Uses **anon key** (not service role)
- RLS enforces tenant isolation automatically
- No way to spoof tenant without forging JWT signature

---

### **Pattern 2: Verified Service Role (Machine/Webhook)**

```typescript
// ✅ SECURE - Used in /api/webhooks/core-events
import { createVerifiedServiceClient } from '@/lib/secure-server-client';
import { createHmac } from 'crypto';

export async function POST(req: NextRequest) {
  // 1. Verify webhook signature (HMAC-SHA256)
  const signature = req.headers.get('x-event-signature');
  const rawBody = await req.text();
  const hmac = createHmac('sha256', process.env.WEBHOOK_SECRET!);
  const expectedSignature = 'sha256=' + hmac.update(rawBody).digest('hex');
  
  if (signature !== expectedSignature) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  
  // 2. Extract tenant_id from VERIFIED payload (after signature check)
  const body = JSON.parse(rawBody);
  const tenantId = body.payload?.tenant_id;
  
  // 3. Create service client with cryptographically verified tenant
  const { client: supabase } = createVerifiedServiceClient(tenantId);
  
  // Service role OK because tenant_id verified via HMAC signature
  await supabase.from('events').insert({ tenant_id: tenantId, ... });
}
```

**Why Secure:**
- Tenant ID derived from **cryptographically verified payload**
- Service role acceptable because identity verified via HMAC/signature
- No client-controlled headers used for tenant derivation

---

## 🔧 REMEDIATION PLAN

### **Phase 1: Refactor User-Driven Routes**

**Routes to Fix (95+):**
- `/api/inventory/vendors` (GET, POST, PUT, DELETE)
- `/api/inventory/items` (GET, POST, PUT, DELETE)
- `/api/inventory/locations` (GET, POST, PUT, DELETE)
- `/api/inventory/assets` (GET, POST, PUT, DELETE)
- `/api/inventory/transfers` (GET, POST, PUT, DELETE)
- `/api/inventory/reservations` (GET, POST, PUT, DELETE)
- `/api/inventory/cycle-counts` (GET, POST, PUT, DELETE)
- `/api/inventory/purchasing` (GET, POST, PUT, DELETE)
- `/api/inventory/receiving` (GET, POST, PUT, DELETE)
- `/api/inventory/rfid/tags` (GET, POST)
- `/api/supply-chain/purchase-orders` (GET, POST, PUT, DELETE)
- `/api/supply-chain/receipts` (GET, POST, PUT, DELETE)
- `/api/widgets` (GET, POST)
- `/api/settings/tenant` (GET, PUT)

**Changes:**
1. Replace `import { createClient } from '@/lib/db-middleware'`  
   With: `import { createAuthenticatedClient } from '@/lib/secure-server-client'`

2. Replace `getTenantIdFromHeaders(request.headers)`  
   With: `const auth = await createAuthenticatedClient(request); context.tenantId`

3. Remove manual `.eq('tenant_id', tenantId)` filters  
   (RLS handles this automatically)

4. Use `context.userId` for audit trails instead of `getUserIdFromHeaders`

---

### **Phase 2: Fix Device/RFID Routes**

**Current Flow (INSECURE):**
```
Device → POST /api/rfid/devices/authenticate
         Headers: { x-tenant-id: "TENANT-ID" } ← Spoofable!
         Body: { device_code, api_key }
```

**New Flow (SECURE):**
```
1. Device → POST /api/rfid/devices/authenticate
            Headers: None (or device MAC address for rate limiting)
            Body: { device_code, api_key }
            
2. Server → Lookup device credentials in DB
            → Find associated tenant_id (server-side, not from header!)
            → Generate JWT with { tenant_id, device_id } in claims
            → Return JWT to device

3. Device → Subsequent requests
            Headers: { Authorization: "Bearer <JWT>" }
            
4. Server → Validate JWT → extract tenant_id from claims
            → Use createAuthenticatedClient or custom device JWT validator
```

**Routes to Fix:**
- `/api/rfid/devices/authenticate` - Return JWT after credential validation
- `/api/rfid/devices/heartbeat` - Validate JWT
- `/api/rfid/devices/sync` - Validate JWT
- `/api/rfid/tags/capture` - Validate JWT
- `/api/rfid/tags/assign` - Validate JWT
- `/api/rfid/cycle-counts/submit` - Validate JWT
- `/api/rfid/bulk-assignment/*` - Validate JWT

---

### **Phase 3: RLS Policy Verification**

**Required RLS Policies:**

```sql
-- Vendors (supply_chain.vendors)
CREATE POLICY "tenant_isolation" ON supply_chain.vendors
  FOR ALL USING (
    tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid
  );

-- Catalog Items (inventory.catalog_items)
CREATE POLICY "tenant_isolation" ON inventory.catalog_items
  FOR ALL USING (
    tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid
  );

-- Purchase Orders (supply_chain.purchase_orders)
CREATE POLICY "tenant_isolation" ON supply_chain.purchase_orders
  FOR ALL USING (
    tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid
  );

-- Assets (inventory.assets)
CREATE POLICY "tenant_isolation" ON inventory.assets
  FOR ALL USING (
    tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid
  );

-- (Repeat for ALL tenant-scoped tables)
```

**Verification:**
```sql
-- Check which tables are missing RLS
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname IN ('inventory', 'supply_chain', 'public')
  AND rowsecurity = false;

-- Check which tables have RLS but no policies
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname IN ('inventory', 'supply_chain', 'public')
  AND rowsecurity = true
  AND tablename NOT IN (
    SELECT tablename FROM pg_policies
    WHERE policyname LIKE '%tenant%'
  );
```

---

### **Phase 4: Integration Tests**

**Test 1: Cross-Tenant Access Blocked**
```typescript
// tests/security/cross-tenant-access.test.ts
describe('Cross-Tenant Security', () => {
  it('should block cross-tenant vendor access', async () => {
    // Setup: Create two tenants with vendors
    const tenant1JWT = await createTestJWT({ tenant_id: 'tenant-1' });
    const tenant2JWT = await createTestJWT({ tenant_id: 'tenant-2' });
    
    await createVendor({ tenant_id: 'tenant-1', name: 'Vendor A' });
    await createVendor({ tenant_id: 'tenant-2', name: 'Vendor B' });
    
    // Test: Tenant 1 requests with their JWT
    const response = await fetch('/api/inventory/vendors', {
      headers: { Authorization: `Bearer ${tenant1JWT}` }
    });
    const data = await response.json();
    
    // Assert: Only sees their own vendor
    expect(data.data).toHaveLength(1);
    expect(data.data[0].name).toBe('Vendor A');
    expect(data.data[0].tenant_id).toBe('tenant-1');
  });
  
  it('should reject modified JWT claims', async () => {
    // Setup: User tries to forge tenant_id in JWT
    const validJWT = await createTestJWT({ tenant_id: 'tenant-1' });
    const tampered = validJWT.replace('tenant-1', 'tenant-2'); // Invalid!
    
    // Test: Request with tampered JWT
    const response = await fetch('/api/inventory/vendors', {
      headers: { Authorization: `Bearer ${tampered}` }
    });
    
    // Assert: Rejected (JWT signature invalid)
    expect(response.status).toBe(401);
  });
});
```

**Test 2: Same-Tenant Access Allowed**
```typescript
it('should allow same-tenant access', async () => {
  const jwt = await createTestJWT({ tenant_id: 'tenant-1', user_id: 'user-1' });
  
  await createVendor({ tenant_id: 'tenant-1', name: 'Test Vendor' });
  
  const response = await fetch('/api/inventory/vendors', {
    headers: { Authorization: `Bearer ${jwt}` }
  });
  
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.data).toHaveLength(1);
});
```

---

## 📋 DETAILED ROUTE INVENTORY

### **User-Driven Routes (JWT + RLS Required)**

| Route | Method | Current Auth | Fix Status |
|-------|--------|--------------|------------|
| `/api/inventory/vendors` | GET, POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/vendors/[id]` | GET, PUT, DELETE | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/vendors/[id]/items` | GET | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/items` | GET, POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/items/[id]` | GET, PUT, DELETE | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/locations` | GET, POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/locations/[id]` | GET, PUT, DELETE | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/locations/[id]/items` | GET | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/assets` | GET, POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/assets/[id]` | GET, PUT, DELETE | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/assets/[id]/history` | GET | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/assets/[id]/return` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/assets/available` | GET | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/transfers` | GET, POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/transfers/[id]` | GET, PUT, DELETE | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/transfers/[id]/ship` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/transfers/[id]/receive` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/transfers/[id]/cancel` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/transfers/[id]/reverse` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/transfers/[id]/undo-ship` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/transfers/[id]/reverse-receipt` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/transfers/[id]/undo-cancel` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/reservations` | GET, POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/reservations/[id]` | GET, DELETE | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/reservations/[id]/fulfill` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/reservations/[id]/release` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/reservations/[id]/undo-fulfill` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/reservations/[id]/undo-release` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/cycle-counts` | GET, POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/cycle-counts/[id]` | GET | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/cycle-counts/[id]/start` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/cycle-counts/[id]/submit` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/cycle-counts/[id]/approve` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/cycle-counts/[id]/lines` | GET, POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/cycle-counts/[id]/lines/[line_id]` | PUT, DELETE | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/cycle-counts/[id]/lines/[line_id]/decide` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/cycle-counts/[id]/lines/[line_id]/assets` | GET, POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/purchasing` | GET, POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/purchasing/[id]` | GET, PUT, DELETE | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/vendor-items` | GET | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/vendor-items/[id]` | PUT | Service role + x-tenant-id | 🔄 Pending |
| `/api/inventory/vendor-performance` | GET | Service role + x-tenant-id | 🔄 Pending |
| `/api/supply-chain/purchase-orders` | GET, POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/supply-chain/purchase-orders/[id]` | GET, PUT | Service role + x-tenant-id | 🔄 Pending |
| `/api/supply-chain/purchase-orders/[id]/receiving` | GET | Service role + x-tenant-id | 🔄 Pending |
| `/api/supply-chain/purchase-orders/[id]/receipts` | GET | Service role + x-tenant-id | 🔄 Pending |
| `/api/supply-chain/purchase-orders/receiving` | GET | Service role + x-tenant-id | 🔄 Pending |
| `/api/supply-chain/receipts` | GET, POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/supply-chain/receipts/[id]` | GET, PUT, DELETE | Service role + x-tenant-id | 🔄 Pending |
| `/api/supply-chain/receipts/[id]/confirm` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/supply-chain/receipts/[id]/validate` | POST | Service role + x-tenant-id | 🔄 Pending |
| `/api/widgets` | GET | Service role + cookie session | 🔄 Pending |
| `/api/widgets/layout` | GET, POST | Service role + cookie session | 🔄 Pending |
| `/api/widgets/data` | GET | Service role + cookie session | 🔄 Pending |
| `/api/settings/tenant` | GET, PUT | Service role + x-tenant-id | 🔄 Pending |
| `/api/tenant` | GET | Service role + x-tenant-id | 🔄 Pending |

**Total User-Driven Routes:** 95+

---

### **Machine/Device Routes (Needs Device JWT)**

| Route | Current Auth | Fix Required |
|-------|--------------|--------------|
| `/api/inventory/rfid/devices/authenticate` | Service role + x-tenant-id | Return device JWT |
| `/api/inventory/rfid/devices/heartbeat` | Service role + x-tenant-id | Validate device JWT |
| `/api/inventory/rfid/devices/sync` | Service role + x-tenant-id | Validate device JWT |
| `/api/inventory/rfid/devices` | Service role + x-tenant-id | Validate device JWT |
| `/api/inventory/rfid/tags` | Service role + x-tenant-id | Validate device JWT |
| `/api/inventory/rfid/tags/capture` | Service role + x-tenant-id | Validate device JWT |
| `/api/inventory/rfid/tags/assign` | Service role + x-tenant-id | Validate device JWT |
| `/api/inventory/rfid/bulk-assignment/start` | Service role + x-tenant-id | Validate device JWT |
| `/api/inventory/rfid/bulk-assignment/[id]/add-tag` | Service role + x-tenant-id | Validate device JWT |
| `/api/inventory/rfid/bulk-assignment/[id]/complete` | Service role + x-tenant-id | Validate device JWT |
| `/api/inventory/rfid/cycle-counts/submit` | Service role + x-tenant-id | Validate device JWT |

**Total Device Routes:** 11

---

### **Webhook Routes (Already Secure)**

| Route | Auth Method | Status |
|-------|-------------|--------|
| `/api/webhooks/core-events` | HMAC signature verification | ✅ SECURE |

---

### **Debug/Admin Routes**

| Route | Current Auth | Recommendation |
|-------|--------------|----------------|
| `/api/debug/events` | None | Add admin JWT check or remove |
| `/api/debug/event-catalog` | Service role, no auth | Add admin JWT check or remove |
| `/api/events/catalog` | Service role, no auth | Add admin JWT check or make public |
| `/api/test-events` | None | Remove from production |
| `/api/auth/create-session` | Dev mode only | Keep dev-only check |
| `/api/auth/dev-login` | Dev mode only | Keep dev-only check |

---

## 🛡️ IMPLEMENTATION CHECKLIST

### **Phase 1: Infrastructure**
- [x] Review `secure-server-client.ts` helper
- [ ] Add `createAuthenticatedClientOrThrow` helper (auto-returns 401)
- [ ] Add device JWT generation/validation utilities
- [ ] Document security patterns in SECURITY_PATTERNS.md

### **Phase 2: User Routes (Priority: CRITICAL)**
- [ ] Refactor `/api/inventory/vendors/**` (7 endpoints)
- [ ] Refactor `/api/inventory/items/**` (6 endpoints)
- [ ] Refactor `/api/inventory/locations/**` (6 endpoints)
- [ ] Refactor `/api/inventory/assets/**` (8 endpoints)
- [ ] Refactor `/api/inventory/transfers/**` (12 endpoints)
- [ ] Refactor `/api/inventory/reservations/**` (8 endpoints)
- [ ] Refactor `/api/inventory/cycle-counts/**` (12 endpoints)
- [ ] Refactor `/api/inventory/purchasing/**` (3 endpoints)
- [ ] Refactor `/api/supply-chain/**` (15 endpoints)
- [ ] Refactor `/api/widgets/**` (3 endpoints)
- [ ] Refactor `/api/settings/**` (2 endpoints)
- [ ] Refactor `/api/tenant` (1 endpoint)

### **Phase 3: Device Routes (Priority: HIGH)**
- [ ] Implement device JWT generation in `/api/rfid/devices/authenticate`
- [ ] Add device JWT validator utility
- [ ] Refactor 10+ RFID endpoints to validate device JWT

### **Phase 4: RLS Verification**
- [ ] Audit all tables for RLS enablement
- [ ] Add missing RLS policies
- [ ] Test RLS with JWT claims

### **Phase 5: Testing**
- [ ] Create cross-tenant access test suite
- [ ] Test JWT tampering protection
- [ ] Test device authentication flow
- [ ] Load test with JWT + RLS

### **Phase 6: Cleanup**
- [ ] Remove `getTenantIdFromHeaders` function (no longer needed)
- [ ] Remove `createClient` from db-middleware (service role helper)
- [ ] Update middleware.ts to not set x-tenant-id header
- [ ] Add deprecation notices to old helpers

---

## 📝 TESTING STRATEGY

### **Unit Tests**
- `createAuthenticatedClient` with valid/invalid JWTs
- `createVerifiedServiceClient` with/without tenant_id
- Device JWT generation and validation

### **Integration Tests**
```typescript
// Cross-tenant access blocked
- User A cannot see User B's vendors
- User A cannot update User B's items
- User A cannot access User B's POs

// Same-tenant access allowed
- User A can see their own vendors
- User A can update their own items
- User A can access their own POs

// JWT tampering rejected
- Modified JWT claims → 401
- Expired JWT → 401
- Missing JWT → 401

// Device authentication
- Valid device credentials → JWT returned
- Invalid device credentials → 401
- Device JWT used for subsequent requests
```

### **Load Tests**
- Benchmark JWT validation overhead vs service role
- Ensure RLS policies are optimized (indexed properly)

---

## 🎯 SUCCESS CRITERIA

- [ ] **0% service role usage** in user-driven routes
- [ ] **0% x-tenant-id header usage** for tenant derivation
- [ ] **100% JWT validation** for user requests
- [ ] **All RLS policies** in place and tested
- [ ] **Cross-tenant access blocked** in integration tests
- [ ] **Same-tenant access allowed** in integration tests
- [ ] **Device authentication** uses JWT flow
- [ ] **Documentation** updated with security patterns

---

## 📚 REFERENCE IMPLEMENTATION

**File:** `src/app/api/auth/session-check/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClient } from '@/lib/secure-server-client';

export async function GET(request: NextRequest) {
  const auth = await createAuthenticatedClient(request);
  
  if (!auth) {
    return NextResponse.json({ 
      authenticated: false 
    }, { status: 401 });
  }
  
  const { context } = auth;
  
  return NextResponse.json({
    authenticated: true,
    user: {
      id: context.userId,
      email: context.email,
      tenant_id: context.tenantId,
      role: context.role
    }
  });
}
```

**This is the ONLY correct pattern for user-driven API routes.**

---

## 🔐 DEPLOYMENT CHECKLIST

- [ ] All user routes refactored to JWT + RLS
- [ ] All device routes use device JWT
- [ ] RLS policies verified on all tables
- [ ] Integration tests passing (cross-tenant blocked)
- [ ] Load tests passing (performance acceptable)
- [ ] Security audit document reviewed
- [ ] Staging deployment tested
- [ ] Production deployment approved
- [ ] Monitoring alerts configured
- [ ] Incident response plan updated

---

## 📞 SUPPORT

**Security Questions:** Summit Inventory Microservice Engineer  
**Documentation:** `SECURITY_PATTERNS.md` (to be created)  
**Reference Implementation:** `src/app/api/auth/session-check/route.ts`

---

**Status:** 🔄 IN PROGRESS  
**Next Steps:** Begin Phase 1 refactoring
