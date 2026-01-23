# CRITICAL PRODUCTION FIXES REQUIRED

**Date:** January 22, 2026
**Status:** 🔴 CRITICAL - Multiple Production Issues

## Issues Reported

1. ❌ **Cannot add items** - 500 error on POST /api/inventory/items
2. ❌ **Cannot add assets** - Button doesn't work
3. ❌ **Cannot create vendors**
4. ❌ **Cannot create transfers** - "events_outbox_scope_check" constraint violation
5. ⚠️ **UX Issues** - UUID input fields instead of dropdowns for:
   - Reservations (location, catalog item)
   - Purchase Orders (vendor, items)
   - Receiving (location, items)
   - Cycle Counts (location)

## Root Causes

### 1. Events Outbox Scope Constraint

**Problem:** The `events_outbox` table has a CHECK constraint:
```sql
CHECK (scope IN ('tenant', 'profile', 'global'))
```

But some triggers/RPCs are trying to insert with `scope = 'user'` or other invalid values.

**Evidence:** Transfer creation fails with "events_outbox_scope_check" violation

**Files to Check:**
- `supabase/migrations/*transfer*.sql` - RPC functions
- `supabase/migrations/*emit*.sql` - Event trigger functions
- Search for any INSERT INTO events_outbox with scope != ('tenant', 'profile', 'global')

### 2. Items POST 500 Error

**Likely Causes:**
- Schema qualification issue (should be fixed)
- Missing required fields
- Trigger failure (possibly event emission)
- Database constraint violation

**Need:** Production error logs from Vercel to see exact error

### 3. Formatter Changed widgets/data/route.ts

**Problem:** PowerShell replace joined `.schema('inventory').from('table')` on one line:
```typescript
.schema('inventory').from('stock_movements')  // ❌ May break query builder
```

Should be:
```typescript
.schema('inventory')
.from('stock_movements')
```

**Fix:** Manually update widgets/data/route.ts with proper formatting

### 4. UX - UUID Input Fields

**Problem:** Forms require manual UUID entry instead of dropdowns

**Files to Fix:**
- `src/app/reservations/page.tsx` - Add location & item dropdowns
- `src/app/purchasing/page.tsx` - Add vendor & item dropdowns  
- `src/app/receiving/page.tsx` - Add location & item dropdowns
- `src/app/cycle-counts/page.tsx` - Add location dropdown

**Pattern:**
```typescript
// Instead of:
<input type="text" placeholder="Enter location UUID" />

// Use:
<select>
  {locations.map(loc => (
    <option key={loc.id} value={loc.id}>{loc.name}</option>
  ))}
</select>
```

## Immediate Action Plan

### Priority 1: Fix Events Outbox Constraint (BLOCKING)

```sql
-- Find all invalid scope values being inserted
SELECT DISTINCT 
    tgname,
    pg_get_functiondef(tgfoid)
FROM pg_trigger
JOIN pg_proc ON tgfoid = pg_proc.oid
WHERE tgrelid::regclass::text LIKE '%inventory%'
  AND pg_get_functiondef(tgfoid) LIKE '%events_outbox%';
```

**Fix:** Update all event emission functions to use only 'tenant', 'profile', or 'global'

### Priority 2: Debug Items POST Error

**Steps:**
1. Check Vercel deployment logs
2. Test POST request with minimal payload:
   ```json
   {
     "name": "Test Item",
     "sku": "TEST-001",
     "unit_of_measure": "EA"
   }
   ```
3. Check Supabase logs for database errors
4. Verify all triggers on `inventory.catalog_items` table

### Priority 3: Fix widgets/data Formatting

Manually update to proper query chain formatting:
```typescript
const { data } = await supabase
  .schema('inventory')
  .from('stock_movements')
  .select(...)
```

### Priority 4: Add UX Dropdowns

1. Create reusable dropdown components
2. Fetch options on page load
3. Replace UUID text inputs with selects
4. Add proper error handling

## Migration Fix Required

Create `20260122000004_fix_event_scopes.sql`:

```sql
-- Fix any RPC functions using invalid scope values

-- Example: Fix transfer RPC
CREATE OR REPLACE FUNCTION inventory.rpc_inv_transfer_create(...)
RETURNS ...
AS $$
BEGIN
  -- Change scope from 'user' to 'tenant'
  PERFORM inventory.publish_event(
    p_tenant_id := p_tenant_id,
    p_scope := 'tenant',  -- ✓ Valid scope
    ...
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## Testing Checklist

After fixes:
- [ ] Create item via POST /api/inventory/items
- [ ] Create vendor via POST /api/inventory/vendors
- [ ] Create transfer via UI
- [ ] Create asset via UI
- [ ] Create reservation with dropdowns (not UUIDs)
- [ ] Create PO with vendor dropdown (not UUID)
- [ ] Process receipt with item dropdowns (not UUIDs)
- [ ] Start cycle count with location dropdown (not UUID)

## Next Steps

1. Get Vercel production logs for items POST error
2. Search codebase for invalid event scopes
3. Create migration to fix event emission functions
4. Update frontend forms with dropdowns
5. Deploy and test all CRUD operations

---

**Status:** Awaiting error logs and scope investigation
