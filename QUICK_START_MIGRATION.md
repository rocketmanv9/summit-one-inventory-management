# Quick Start - Apply Production Migration

## ⚡ One-Command Deployment

```bash
# Stop current database (if running)
npx supabase stop

# Start fresh with new migration
npx supabase db reset

# Verify status
npx supabase status
```

---

## 📋 Step-by-Step Deployment

### 1. Backup Current Data (Production Only)
```bash
# Create timestamped backup
npx supabase db dump -f "backup_$(date +%Y%m%d_%H%M%S).sql"
```

### 2. Apply Migration
```bash
# Fresh start (dev/staging)
npx supabase db reset

# OR incremental (production)
npx supabase migration up
```

### 3. Verify Installation
```bash
# Open Supabase Studio
npx supabase studio

# Or check via SQL (copy to SQL Editor):
```

```sql
-- Quick verification query
SELECT 
    'Tables' AS type, COUNT(*) AS count
FROM pg_tables 
WHERE schemaname = 'inventory'
UNION ALL
SELECT 'Views', COUNT(*)
FROM pg_views 
WHERE schemaname = 'inventory'
UNION ALL
SELECT 'Functions', COUNT(*)
FROM information_schema.routines 
WHERE routine_schema = 'inventory' AND routine_name LIKE 'rpc_%'
UNION ALL
SELECT 'RLS Policies', COUNT(*)
FROM pg_policies 
WHERE schemaname = 'inventory';
```

**Expected Results:**
- Tables: 8
- Views: 5
- Functions: 8+
- RLS Policies: 16+

---

## 🧪 Quick Test

### Get Your IDs
```sql
-- Run in SQL Editor
SELECT 
    (auth.jwt() ->> 'tenant_id')::uuid AS my_tenant_id,
    auth.uid() AS my_user_id;
```

### Bootstrap Your Tenant
```sql
-- Replace with your IDs from above
SELECT inventory.rpc_inventory_bootstrap_tenant(
    'YOUR_TENANT_ID'::uuid,
    'YOUR_USER_ID'::uuid
);
```

**Expected Output:**
```json
{
  "success": true,
  "default_location_id": "...",
  "default_unit_id": "...",
  "reason_codes_seeded": true
}
```

### Test Stock Movement
```sql
-- Get default IDs
SELECT 
    l.id AS location_id,
    u.id AS unit_id,
    i.id AS item_id
FROM inventory.locations l,
     inventory.units u,
     inventory.items i
WHERE l.tenant_id = 'YOUR_TENANT_ID'::uuid
  AND u.tenant_id = 'YOUR_TENANT_ID'::uuid
  AND i.tenant_id = 'YOUR_TENANT_ID'::uuid
  AND l.is_default = true
LIMIT 1;

-- Receive 100 units (use IDs from above)
SELECT inventory.rpc_inventory_receive_po(
    p_tenant_id := 'YOUR_TENANT_ID'::uuid,
    p_user_id := 'YOUR_USER_ID'::uuid,
    p_po_id := gen_random_uuid(),
    p_po_line_id := gen_random_uuid(),
    p_item_id := 'ITEM_ID_FROM_ABOVE'::uuid,
    p_quantity := 100.0,
    p_unit_id := 'UNIT_ID_FROM_ABOVE'::uuid,
    p_to_location_id := 'LOCATION_ID_FROM_ABOVE'::uuid,
    p_notes := 'Test receipt'
);
```

**Expected Output:**
```json
{
  "success": true,
  "movement_id": "...",
  "item_name": "...",
  "quantity": 100,
  "location_id": "..."
}
```

### Verify Stock Updated
```sql
-- Check stock
SELECT 
    i.name AS item_name,
    s.on_hand_quantity,
    s.reserved_quantity,
    s.available_quantity
FROM inventory.inventory_stock s
JOIN inventory.items i ON i.id = s.item_id
WHERE s.tenant_id = 'YOUR_TENANT_ID'::uuid;
```

**Expected:**
- on_hand_quantity: 100
- reserved_quantity: 0
- available_quantity: 100

### Verify Event Published
```sql
-- Check outbox
SELECT 
    event_type,
    aggregate_type,
    payload,
    status,
    created_at
FROM public.events_outbox
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid
ORDER BY created_at DESC
LIMIT 5;
```

**Expected:**
- event_type: `inventory.movement.created`
- status: `pending`

---

## ✅ Success Criteria

Migration successful when:
- [ ] All verification queries return expected counts
- [ ] Bootstrap creates default location/unit/codes
- [ ] Test receipt creates movement and updates stock
- [ ] Event publishes to outbox
- [ ] Views return data (test any view from `inventory.v_*`)

---

## 🚨 Troubleshooting

### Migration Fails
```bash
# Check error in terminal output
# Common issues:
# - Missing dependency (ensure all previous migrations applied)
# - Syntax error (check migration file line number in error)
# - Permission issue (ensure running as proper role)

# To fix:
npx supabase db reset  # Nuclear option, starts fresh
```

### Tables Not Found
```sql
-- Check if schema exists
SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'inventory';

-- Check table ownership
SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'inventory';
```

### RLS Blocking Queries
```sql
-- Check current JWT
SELECT auth.jwt();

-- Ensure tenant_id in JWT matches your data
SELECT (auth.jwt() ->> 'tenant_id')::uuid;

-- Bypass RLS temporarily (service_role only)
SET ROLE service_role;
SELECT * FROM inventory.inventory_movements;
RESET ROLE;
```

### Functions Not Working
```sql
-- Check function exists
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_schema = 'inventory';

-- Test function signature
\df inventory.rpc_inventory_receive_po

-- Grant execute permission
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA inventory TO authenticated;
```

---

## 🔄 Rollback (if needed)

### Option 1: Revert Migration
```bash
# Delete migration file
rm supabase/migrations/20260116000000_production_inventory_hardening.sql

# Reset database
npx supabase db reset
```

### Option 2: Restore Backup
```bash
# Restore from backup file
psql -h localhost -p 54322 -U postgres -d postgres < backup_YYYYMMDD_HHMMSS.sql
```

---

## 📚 Full Documentation

- **Implementation Guide:** `PRODUCTION_INVENTORY_IMPLEMENTATION.md`
- **AI Integration:** `AI_AGENT_QUICK_REFERENCE.md`
- **Deployment Details:** `DEPLOYMENT_SUMMARY.md`
- **Microservice Setup:** `MICROSERVICE_SETUP.md`

---

## 🎯 Next Steps After Successful Deployment

1. **Frontend Integration:**
   ```typescript
   // In Next.js API route
   const { data, error } = await supabase.rpc('rpc_inventory_issue_to_job', {
     p_tenant_id: tenantId,
     p_user_id: userId,
     p_item_id: itemId,
     p_quantity: 10,
     p_unit_id: unitId,
     p_from_location_id: locationId,
     p_job_id: jobId
   });
   ```

2. **Test AI Features:**
   ```sql
   -- Create test suggestion
   INSERT INTO inventory.inventory_ai_suggestions (
     tenant_id, suggestion_type, payload, reasoning, confidence
   ) VALUES (
     'your-tenant-id'::uuid,
     'reorder_item',
     '{"item_id": "...", "qty": 100}'::jsonb,
     'Stock below threshold',
     0.9
   );
   ```

3. **Monitor Performance:**
   - Check API response times
   - Monitor event publishing
   - Track RPC execution duration

4. **Train Team:**
   - Share documentation
   - Run through test scenarios
   - Document tenant-specific workflows

---

**Migration File:** `supabase/migrations/20260116000000_production_inventory_hardening.sql`  
**Status:** ✅ Ready to Deploy  
**Estimated Time:** 2-5 minutes
