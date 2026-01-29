# API Route Refactoring Progress

**Goal:** Convert all 95+ user-driven routes from service role + x-tenant-id to JWT + RLS

## ✅ COMPLETED (4 routes)

- `/api/inventory/vendors` (GET, POST) - ✅ SECURE
- `/api/inventory/vendors/[id]` (GET, PUT, DELETE) - ✅ SECURE
- `/api/auth/session-check` - ✅ SECURE (was already secure)

## 🔄 IN PROGRESS

### Inventory Routes
- [ ] `/api/inventory/items` (GET, POST)
- [ ] `/api/inventory/items/[id]` (GET, PUT, DELETE)
- [ ] `/api/inventory/locations` (GET, POST)
- [ ] `/api/inventory/locations/[id]` (GET, PUT, DELETE)
- [ ] `/api/inventory/locations/[id]/items` (GET)
- [ ] `/api/inventory/assets` (GET, POST)
- [ ] `/api/inventory/assets/[id]` (GET, PUT, DELETE)
- [ ] `/api/inventory/assets/[id]/history` (GET)
- [ ] `/api/inventory/assets/[id]/return` (POST)
- [ ] `/api/inventory/assets/available` (GET)
- [ ] `/api/inventory/transfers` (GET, POST)
- [ ] `/api/inventory/transfers/[id]` (GET, PUT, DELETE)
- [ ] `/api/inventory/transfers/[id]/ship` (POST)
- [ ] `/api/inventory/transfers/[id]/receive` (POST)
- [ ] `/api/inventory/transfers/[id]/cancel` (POST)
- [ ] `/api/inventory/transfers/[id]/reverse` (POST)
- [ ] `/api/inventory/transfers/[id]/undo-ship` (POST)
- [ ] `/api/inventory/transfers/[id]/reverse-receipt` (POST)
- [ ] `/api/inventory/transfers/[id]/undo-cancel` (POST)
- [ ] `/api/inventory/reservations` (GET, POST)
- [ ] `/api/inventory/reservations/[id]` (GET, DELETE)
- [ ] `/api/inventory/reservations/[id]/fulfill` (POST)
- [ ] `/api/inventory/reservations/[id]/release` (POST)
- [ ] `/api/inventory/reservations/[id]/undo-fulfill` (POST)
- [ ] `/api/inventory/reservations/[id]/undo-release` (POST)
- [ ] `/api/inventory/cycle-counts` (GET, POST)
- [ ] `/api/inventory/cycle-counts/[id]` (GET)
- [ ] `/api/inventory/cycle-counts/[id]/start` (POST)
- [ ] `/api/inventory/cycle-counts/[id]/submit` (POST)
- [ ] `/api/inventory/cycle-counts/[id]/approve` (POST)
- [ ] `/api/inventory/cycle-counts/[id]/lines` (GET, POST)
- [ ] `/api/inventory/cycle-counts/[id]/lines/[line_id]` (PUT, DELETE)
- [ ] `/api/inventory/cycle-counts/[id]/lines/[line_id]/decide` (POST)
- [ ] `/api/inventory/cycle-counts/[id]/lines/[line_id]/assets` (GET, POST)
- [ ] `/api/inventory/purchasing` (GET, POST)
- [ ] `/api/inventory/purchasing/[id]` (GET, PUT, DELETE)
- [ ] `/api/inventory/vendor-items` (GET)
- [ ] `/api/inventory/vendor-items/[id]` (PUT)
- [ ] `/api/inventory/vendor-performance` (GET)
- [ ] `/api/inventory/vendors/[id]/items` (GET)
- [ ] `/api/inventory/movements` (GET)

### Supply Chain Routes
- [ ] `/api/supply-chain/purchase-orders` (GET, POST)
- [ ] `/api/supply-chain/purchase-orders/[id]` (GET, PUT)
- [ ] `/api/supply-chain/purchase-orders/[id]/receiving` (GET)
- [ ] `/api/supply-chain/purchase-orders/[id]/receipts` (GET)
- [ ] `/api/supply-chain/purchase-orders/receiving` (GET)
- [ ] `/api/supply-chain/receipts` (GET, POST)
- [ ] `/api/supply-chain/receipts/[id]` (GET, PUT, DELETE)
- [ ] `/api/supply-chain/receipts/[id]/confirm` (POST)
- [ ] `/api/supply-chain/receipts/[id]/validate` (POST)

### Widget & Settings Routes
- [ ] `/api/widgets` (GET)
- [ ] `/api/widgets/layout` (GET, POST)
- [ ] `/api/widgets/data` (GET)
- [ ] `/api/settings/tenant` (GET, PUT)
- [ ] `/api/tenant` (GET)

## REFACTORING PATTERN

### Before (INSECURE):
```typescript
import { getTenantIdFromHeaders, createClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers); // ❌ From cookie
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  
  const supabase = createClient(); // ❌ Service role
  
  const { data } = await supabase
    .from('vendors')
    .select('*')
    .eq('tenant_id', tenantId); // ❌ Manual filter (bypassable)
    
  return NextResponse.json({ data });
}
```

### After (SECURE):
```typescript
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';

export async function GET(request: NextRequest) {
  const auth = await createAuthenticatedClientOrThrow(request); // ✅ JWT validation
  if (auth instanceof NextResponse) return auth; // Auto 401
  
  const { client: supabase, context } = auth; // ✅ Anon key + JWT
  
  const { data } = await supabase
    .from('vendors')
    .select('*');
    // ✅ RLS enforces tenant_id automatically - no manual filter needed
    
  return NextResponse.json({ data, meta: { tenantId: context.tenantId } });
}
```

## CHANGES NEEDED PER ROUTE

1. **Import change:**
   - Remove: `import { getTenantIdFromHeaders, createClient } from '@/lib/db-middleware'`
   - Add: `import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client'`

2. **Auth validation:**
   - Remove:
     ```typescript
     const tenantId = getTenantIdFromHeaders(request.headers);
     if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
     const supabase = createClient();
     ```
   - Add:
     ```typescript
     const auth = await createAuthenticatedClientOrThrow(request);
     if (auth instanceof NextResponse) return auth;
     const { client: supabase, context } = auth;
     ```

3. **Remove manual tenant filters:**
   - Remove all `.eq('tenant_id', tenantId)` calls
   - RLS policies handle tenant isolation automatically

4. **Use context for inserts:**
   - Change: `tenant_id: tenantId`
   - To: `tenant_id: context.tenantId` (from JWT claims)

## ESTIMATED TIME

- Each simple route (GET/POST): ~2 minutes
- Each complex route (with business logic): ~5 minutes
- Total routes: 95+
- **Estimated total time:** 3-5 hours

## PRIORITY ORDER

1. ✅ **High-traffic user routes:** vendors, items, locations, assets
2. **Financial routes:** purchase orders, receipts, purchasing
3. **Operational routes:** transfers, reservations, cycle counts
4. **Low-traffic routes:** widgets, settings, tenant info
