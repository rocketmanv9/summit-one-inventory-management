# Security Refactor Progress Report

## Status: IN PROGRESS (Build Passing ✓)

---

## Executive Summary

The security audit found CRITICAL failures in tenant isolation, idempotency, and write consistency. We have established the security infrastructure and fixed several high-priority routes as proof-of-concept.

### Build Status
✅ `npm run build` - **PASSING**
✅ TypeScript compilation - **PASSING**
✅ No runtime errors in refactored routes

---

## Infrastructure Completed (PHASE 1-2)

### ✅ New Security Helpers Created

#### `createUserClient(request)` - JWT-Based Authentication
- **Location**: `/src/lib/db-middleware.ts:63-142`
- **Purpose**: Secure authentication for USER routes
- **Security**: 
  - Validates Supabase session from cookies
  - Falls back to `inventory_session` cookie (backward compat)
  - Returns JWT-bound client (NO service role)
  - RLS automatically enforces tenant isolation
- **Usage**:
  ```typescript
  const { supabase, tenantId, userId } = await createUserClient(request);
  // No manual tenant_id filtering needed - RLS handles it
  ```

#### `getIdempotencyKey(request, method)` - Idempotency Enforcement
- **Location**: `/src/lib/db-middleware.ts:146-174`
- **Purpose**: Extract and validate idempotency keys
- **Contract**:
  - Checks `Idempotency-Key` header (preferred)
  - Falls back to `last_event_id` in body
  - **THROWS ERROR** if missing on write operations
- **Usage**:
  ```typescript
  const idempotencyKey = await getIdempotencyKey(request, 'POST');
  // Use in RPC: p_last_event_id: idempotencyKey
  ```

#### `createServiceClientVerified(tenantId)` - Service Role (Restricted)
- **Location**: `/src/lib/db-middleware.ts:183-199`
- **Purpose**: Service role ONLY for verified webhooks/machines
- **Security**: Requires verified tenant_id parameter
- **Usage**: ONLY in webhook/poller/machine routes after verification

### ⚠️ Legacy Functions Deprecated
- `createClient()` - Marked deprecated with warning (line 21)
- `getTenantIdFromHeaders()` - Marked deprecated (line 251)
- `getUserIdFromHeaders()` - Marked deprecated (line 262)
- All emit security warnings in development mode

---

## Routes Fixed (Proof of Concept)

### 1. ✅ `/api/inventory/stock` (GET)
- **Changes**: Converted from service role to JWT auth
- **Security**: Uses `createUserClient()`, RLS enforces tenant isolation
- **No manual `.eq('tenant_id')` needed**
- **File**: `src/app/api/inventory/stock/route.ts`

### 2. ✅ `/api/inventory/reservations` (GET/POST)
- **Changes**:
  - JWT authentication via `createUserClient()`
  - **Idempotency ENFORCED**: Returns 400 if missing
  - Server-generated random keys **REMOVED**
  - Client must provide `Idempotency-Key` header
- **Before**: `p_last_event_id: `reserve-asset-${Date.now()}-${Math.random()}`
- **After**: `p_last_event_id: idempotencyKey` (from client)
- **File**: `src/app/api/inventory/reservations/route.ts`

### 3. ✅ `/api/inventory/cycle-counts/[id]/approve` (POST) **CRITICAL FIX**
- **Changes**:
  - JWT authentication via `createAuthenticatedClientOrThrow()`
  - **ELIMINATED 150+ lines of direct `stock_balances` writes**
  - Now uses `post_cycle_count_adjustments` RPC
  - Writes to `stock_movements` (source of truth) ONLY
  - Triggers/materialization update `stock_balances`
  - Idempotency enforced via `Idempotency-Key` header
- **Before**:
  ```typescript
  // UNSAFE: Direct write to read model
  await supabase.from('stock_balances').update({ 
    qty_on_hand: newQtyOnHand 
  })
  ```
- **After**:
  ```typescript
  // SAFE: RPC writes to source of truth
  await supabase.rpc('post_cycle_count_adjustments', {
    p_cycle_count_id, p_tenant_id, p_posted_by_user_id
  })
  ```
- **File**: `src/app/api/inventory/cycle-counts/[id]/approve/route.ts`

### 4. ✅ `/api/inventory/items` (already secure)
- **Status**: Already using `createAuthenticatedClient()` from secure-server-client
- **File**: `src/app/api/inventory/items/route.ts`

### 5. ✅ `/api/inventory/vendors` (already secure)
- **Status**: Already using `createAuthenticatedClientOrThrow()`
- **File**: `src/app/api/inventory/vendors/route.ts`

### 6. ✅ `/api/webhooks/core-events` (already secure)
- **Status**: Already uses HMAC verification + `createVerifiedServiceClient()`
- **File**: `src/app/api/webhooks/core-events/route.ts`

---

## Remaining Work (90 User Routes)

### High Priority Routes (Direct Writes / Broken Idempotency)

#### Critical Direct Writes (Need RPC Conversion)
1. `/api/inventory/purchasing/[id]` (PUT/PATCH) - Direct PO line deletes/inserts
2. `/api/inventory/cycle-counts/[id]/start` - Direct cycle_count_lines inserts
3. `/api/inventory/cycle-counts/[id]/lines/[line_id]/assets` - Direct asset updates
4. `/api/inventory/transfers/[id]` (PUT) - Direct transfer_lines updates
5. `/api/inventory/transfers/[id]/ship` - Direct transfer_lines updates
6. `/api/inventory/dashboards` (POST) - Direct dashboard inserts
7. `/api/dashboards/[id]/widgets` - Direct widget inserts/deletes
8. `/api/inventory/reservations/[id]` (PATCH/DELETE) - Direct reservation updates

#### Broken Idempotency (Server-Generated Keys)
1. `/api/inventory/transfers` (POST) - Uses `Date.now() + Math.random()`
2. `/api/inventory/transfers/[id]/receive` - Uses `Date.now()`
3. `/api/inventory/transfers/[id]/reverse` - Uses `Date.now()`
4. `/api/inventory/transfers/[id]/undo-ship` - Uses `Date.now()`
5. `/api/inventory/purchasing/[id]` (PUT) - Uses `Date.now() + Math.random()`
6. `/api/inventory/cycle-counts/[id]/start` - Uses template literals

### Medium Priority (Service Role + Missing Idempotency)
- 60+ routes using `getTenantIdFromHeaders()` + `createClient()`
- Need conversion to `createUserClient()` or `createAuthenticatedClientOrThrow()`
- Read-only routes are lower risk but still non-compliant

---

## Pattern Library for Batch Refactoring

### Pattern 1: Simple GET Route (Read-Only)
```typescript
// BEFORE
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  
  const supabase = createClient();
  const { data } = await supabase.from('table').select('*').eq('tenant_id', tenantId);
  return NextResponse.json({ data });
}

// AFTER
import { createUserClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await createUserClient(request);
    const { data } = await supabase.from('table').select('*'); // RLS filters tenant_id
    return NextResponse.json({ data });
  } catch (error: any) {
    if (error.message?.includes('authenticated')) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

### Pattern 2: POST/PATCH with RPC (Idempotency Required)
```typescript
// BEFORE
export async function POST(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  const supabase = createClient();
  const { data } = await supabase.rpc('some_rpc', {
    p_tenant_id: tenantId,
    p_last_event_id: `random-${Date.now()}-${Math.random()}` // ❌ BROKEN
  });
}

// AFTER
import { createUserClient, getIdempotencyKey } from '@/lib/db-middleware';

export async function POST(request: NextRequest) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
    const idempotencyKey = await getIdempotencyKey(request, 'POST'); // ✅ REQUIRED
    
    const { data } = await supabase.rpc('some_rpc', {
      p_tenant_id: tenantId,
      p_last_event_id: idempotencyKey // ✅ Client-provided
    });
    
    return NextResponse.json({ data }, { status: 201 });
  } catch (error: any) {
    if (error.message?.includes('Idempotency-Key')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error.message?.includes('authenticated')) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

### Pattern 3: Direct Write → RPC Conversion
```typescript
// BEFORE - Direct write bypassing validation
const { data } = await supabase.from('table').insert({ ...data, tenant_id: tenantId });

// AFTER - Use RPC
const { data } = await supabase.rpc('rpc_create_entity', {
  p_tenant_id: tenantId,
  p_data: data,
  p_last_event_id: idempotencyKey
});
```

---

## Next Steps (Recommended Approach)

### Step 1: Batch Refactor Read-Only Routes (Low Risk)
- Convert 40+ GET routes to `createUserClient()`
- Low risk: no writes, just auth change
- Can be done in batches of 10-15 routes

### Step 2: Fix Broken Idempotency (High Value)
- Convert 15 routes with server-generated keys
- Medium complexity: requires client-side changes to pass keys

### Step 3: Convert Direct Writes to RPCs (High Complexity)
- Audit each route for direct INSERT/UPDATE/DELETE
- Check if RPC exists, create if needed
- Convert route to use RPC only

### Step 4: RFID Machine Routes (Separate Pattern)
- Device authentication flow
- Verify device credentials before service role access

### Step 5: Final Verification
- Run grep checks for service role usage
- Test cross-tenant access with spoofed cookies
- Verify idempotency with duplicate requests

---

## Grep Invariant Checks (Run These)

```powershell
# Check 1: No service role in USER routes (should return 0 matches after refactor)
Select-String -Path "src\app\api\inventory\**\route.ts" -Pattern "createClient\(\)" | 
  Where-Object { $_.Path -notlike "*rfid*" -and $_.Path -notlike "*webhooks*" }

# Check 2: No getTenantIdFromHeaders in USER routes
Select-String -Path "src\app\api\inventory\**\route.ts" -Pattern "getTenantIdFromHeaders"

# Check 3: No server-generated idempotency keys
Select-String -Path "src\app\api\**\route.ts" -Pattern "Date\.now|Math\.random|crypto\.randomUUID" |
  Where-Object { $_.Line -like "*last_event_id*" }

# Check 4: No direct stock_balances writes
Select-String -Path "src\app\api\**\route.ts" -Pattern "\.from\('stock_balances'\)\.update"
```

---

## Success Criteria Checklist

- [x] Infrastructure created (JWT client, idempotency helper, service client)
- [x] Proof-of-concept routes fixed (3 critical routes)
- [x] Build passing
- [ ] All 90+ USER routes converted to JWT auth
- [ ] All write routes enforce idempotency
- [ ] No direct writes to read models (stock_balances)
- [ ] RFID machine routes use device auth
- [ ] Cross-tenant access tests pass
- [ ] Idempotency tests pass
- [ ] Grep checks pass

---

## Files Modified

### Core Infrastructure
- `src/lib/db-middleware.ts` (356 lines) - New secure auth helpers
- `SECURITY_REFACTOR_CHECKLIST.md` - Route inventory

### Routes Fixed
- `src/app/api/inventory/stock/route.ts`
- `src/app/api/inventory/reservations/route.ts`
- `src/app/api/inventory/cycle-counts/[id]/approve/route.ts`

### Already Secure (No Changes)
- `src/app/api/inventory/items/route.ts`
- `src/app/api/inventory/vendors/route.ts`
- `src/app/api/webhooks/core-events/route.ts`

---

## Estimated Remaining Effort

- **Simple GET routes (40)**: ~4-6 hours (batch refactoring)
- **POST/PATCH with idempotency (15)**: ~6-8 hours
- **Direct write conversions (10)**: ~10-15 hours (may need new RPCs)
- **RFID routes (11)**: ~4-6 hours
- **Testing & verification**: ~4-6 hours

**Total**: ~30-40 hours of focused development

---

## Recommendations for Completion

1. **Continue with batch approach**: Use patterns above to refactor routes in groups
2. **Prioritize high-risk routes**: Direct writes and broken idempotency first
3. **Test incrementally**: After each batch, run build + manual tests
4. **Client-side coordination**: Some routes will need frontend changes to pass idempotency keys
5. **Documentation**: Update API docs to reflect required `Idempotency-Key` header

---

*Report generated: 2026-01-29*
*Next update: After next batch of 10-15 routes*
