# Production Inventory Database - Implementation Guide

## 📋 Migration Applied
**File:** `20260116000000_production_inventory_hardening.sql`

---

## 🔄 Data Flow Architecture

### High-Level Flow
```
Frontend → RPC Functions → Movements Ledger → Stock Read Model → Events Outbox → Core
```

### Detailed Flow by Operation

#### 1. **Receiving Inventory (Purchase Order)**
```
User Action: "Receive 50 units of Item X from PO-123"
    ↓
Frontend calls: rpc_inventory_receive_po(...)
    ↓
RPC validates:
    - Tenant scope
    - Item exists
    - Location exists
    ↓
Insert into inventory_movements:
    - movement_type: 'purchase_receive'
    - quantity_delta: +50
    - to_location_id: warehouse
    - idempotency: last_event_id
    ↓
Trigger: update_stock_on_movement()
    - Updates inventory_stock.on_hand_quantity
    - Sets last_movement_at
    ↓
Trigger: publish_movement_event()
    - Inserts into events_outbox
    - Event: 'inventory.movement.created'
    ↓
Events poller publishes to Core/other services
    ↓
Frontend receives: { success, movement_id, quantity, location_id }
```

#### 2. **Issuing to Job**
```
User Action: "Issue 10 units to Job-456"
    ↓
Frontend calls: rpc_inventory_issue_to_job(...)
    ↓
RPC checks availability:
    - Query inventory_stock.available_quantity
    - Fail if insufficient
    ↓
Insert into inventory_movements:
    - movement_type: 'issue_to_job'
    - quantity_delta: -10
    - from_location_id: warehouse
    - job_id: Job-456
    ↓
Trigger updates stock (decreases on_hand)
    ↓
Trigger publishes event
    ↓
Frontend receives: { success, movement_id, remaining_available }
```

#### 3. **Creating Reservation**
```
User Action: "Reserve 20 units for Job-789"
    ↓
Frontend calls: rpc_inventory_reserve(...)
    ↓
RPC checks availability across all locations
    ↓
Insert into inventory_reservations:
    - status: 'active'
    - quantity: 20
    - job_id: Job-789
    ↓
Trigger: update_reserved_on_reservation()
    - Updates inventory_stock.reserved_quantity
    - available_quantity auto-decreases (computed column)
    ↓
Trigger publishes reservation event
    ↓
Frontend receives: { success, reservation_id }
```

#### 4. **AI Suggestion Flow**
```
AI Agent analyzes inventory data:
    - Queries v_inventory_low_stock_alerts
    - Detects Item Y below min_quantity
    ↓
AI inserts into inventory_ai_suggestions:
    - suggestion_type: 'reorder_item'
    - payload: { item_id, current_qty, min_qty, vendor_id }
    - reasoning: "Stock below minimum threshold"
    - status: 'new'
    ↓
Frontend displays suggestion to user
    ↓
User reviews and accepts/rejects:
    - Update status to 'accepted' or 'rejected'
    - Set resolved_by, resolved_at
    ↓
If accepted, trigger actual reorder process
    ↓
Insert into inventory_decision_traces:
    - decision_type: 'reorder_triggered'
    - reasoning: { rule: 'ai_suggestion', suggestion_id }
    - decision_maker: 'ai_agent'
```

---

## 🧪 Testing Checklist

### Phase 1: Schema Validation

**Run in Supabase SQL Editor:**

```sql
-- ✓ Verify all tables created
SELECT schemaname, tablename, rowsecurity
FROM pg_tables 
WHERE schemaname = 'inventory'
  AND tablename IN (
    'inventory_movements',
    'inventory_stock',
    'inventory_reservations',
    'inventory_item_aliases',
    'inventory_reason_codes',
    'inventory_ai_suggestions',
    'inventory_decision_traces',
    'inventory_reorder_rules'
  )
ORDER BY tablename;

-- Expected: 8 rows, all with rowsecurity = true
```

```sql
-- ✓ Verify RLS policies exist
SELECT tablename, policyname, cmd
FROM pg_policies 
WHERE schemaname = 'inventory'
ORDER BY tablename, policyname;

-- Expected: At least 2 policies per table (tenant_isolation + service_role)
```

```sql
-- ✓ Verify views created
SELECT viewname 
FROM pg_views 
WHERE schemaname = 'inventory'
ORDER BY viewname;

-- Expected: 
--   v_inventory_active_reservations
--   v_inventory_availability_by_location
--   v_inventory_item_movement_history
--   v_inventory_items
--   v_inventory_low_stock_alerts
```

```sql
-- ✓ Verify RPCs exist
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'inventory'
  AND routine_type = 'FUNCTION'
  AND routine_name LIKE 'rpc_%'
ORDER BY routine_name;

-- Expected:
--   rpc_inventory_adjust
--   rpc_inventory_bootstrap_tenant
--   rpc_inventory_issue_to_job
--   rpc_inventory_receive_po
--   rpc_inventory_release_reservation
--   rpc_inventory_reserve
--   rpc_inventory_return_from_job
--   rpc_inventory_transfer
```

---

### Phase 2: Bootstrap Test

```sql
-- Get your tenant_id and user_id
SELECT 
    (auth.jwt() ->> 'tenant_id')::uuid AS tenant_id,
    auth.uid() AS user_id;

-- Bootstrap tenant (creates default location, unit, reason codes)
SELECT inventory.rpc_inventory_bootstrap_tenant(
    'YOUR_TENANT_ID'::uuid,
    'YOUR_USER_ID'::uuid
);

-- Expected output:
-- {
--   "success": true,
--   "default_location_id": "...",
--   "default_unit_id": "...",
--   "reason_codes_seeded": true
-- }
```

```sql
-- ✓ Verify default location created
SELECT id, name, location_type, is_default
FROM inventory.locations
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid;

-- Expected: 'Default Yard', type 'yard', is_default true
```

```sql
-- ✓ Verify reason codes seeded
SELECT code, description, category
FROM inventory.inventory_reason_codes
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid
ORDER BY sort_order;

-- Expected: 10 codes (LOSS_UNKNOWN, LOSS_THEFT, SCRAP_DAMAGED, etc.)
```

---

### Phase 3: Basic Operations Test

**Setup Test Data:**

```sql
-- Create test item
INSERT INTO inventory.items (tenant_id, name, sku, unit_id, category_id, created_by)
VALUES (
    'YOUR_TENANT_ID'::uuid,
    'Test Widget',
    'TEST-001',
    (SELECT id FROM inventory.units WHERE tenant_id = 'YOUR_TENANT_ID'::uuid LIMIT 1),
    (SELECT id FROM inventory.categories WHERE tenant_id = 'YOUR_TENANT_ID'::uuid LIMIT 1),
    'YOUR_USER_ID'::uuid
)
RETURNING id;

-- Save the returned ID as TEST_ITEM_ID
```

**Test 1: Receive Inventory**

```sql
SELECT inventory.rpc_inventory_receive_po(
    p_tenant_id := 'YOUR_TENANT_ID'::uuid,
    p_user_id := 'YOUR_USER_ID'::uuid,
    p_po_id := gen_random_uuid(), -- Mock PO ID
    p_po_line_id := gen_random_uuid(),
    p_item_id := 'TEST_ITEM_ID'::uuid,
    p_quantity := 100.0,
    p_unit_id := (SELECT id FROM inventory.units WHERE tenant_id = 'YOUR_TENANT_ID'::uuid LIMIT 1),
    p_to_location_id := (SELECT id FROM inventory.locations WHERE tenant_id = 'YOUR_TENANT_ID'::uuid LIMIT 1),
    p_notes := 'Initial stock receipt'
);

-- ✓ Check movement created
SELECT * FROM inventory.inventory_movements
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid
ORDER BY created_at DESC LIMIT 1;

-- ✓ Check stock updated
SELECT * FROM inventory.inventory_stock
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid
  AND item_id = 'TEST_ITEM_ID'::uuid;

-- Expected: on_hand_quantity = 100, available_quantity = 100

-- ✓ Check event published
SELECT * FROM public.events_outbox
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid
ORDER BY created_at DESC LIMIT 1;

-- Expected: event_type = 'inventory.movement.created'
```

**Test 2: Idempotency**

```sql
-- Try to receive again with same event_id
SELECT inventory.rpc_inventory_receive_po(
    p_tenant_id := 'YOUR_TENANT_ID'::uuid,
    p_user_id := 'YOUR_USER_ID'::uuid,
    p_po_id := gen_random_uuid(),
    p_po_line_id := gen_random_uuid(),
    p_item_id := 'TEST_ITEM_ID'::uuid,
    p_quantity := 50.0,
    p_unit_id := (SELECT id FROM inventory.units WHERE tenant_id = 'YOUR_TENANT_ID'::uuid LIMIT 1),
    p_to_location_id := (SELECT id FROM inventory.locations WHERE tenant_id = 'YOUR_TENANT_ID'::uuid LIMIT 1),
    p_event_id := 'DUPLICATE_EVENT_ID'::uuid
);

-- Run twice with same p_event_id

-- ✓ Second call should return success=false (already processed)
-- ✓ Stock should NOT increase twice
```

**Test 3: Create Reservation**

```sql
SELECT inventory.rpc_inventory_reserve(
    p_tenant_id := 'YOUR_TENANT_ID'::uuid,
    p_user_id := 'YOUR_USER_ID'::uuid,
    p_item_id := 'TEST_ITEM_ID'::uuid,
    p_quantity := 25.0,
    p_unit_id := (SELECT id FROM inventory.units WHERE tenant_id = 'YOUR_TENANT_ID'::uuid LIMIT 1),
    p_location_id := (SELECT id FROM inventory.locations WHERE tenant_id = 'YOUR_TENANT_ID'::uuid LIMIT 1),
    p_reference_type := 'job',
    p_reference_id := gen_random_uuid()
);

-- ✓ Check reservation created
SELECT * FROM inventory.inventory_reservations
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid
ORDER BY created_at DESC LIMIT 1;

-- ✓ Check stock updated
SELECT on_hand_quantity, reserved_quantity, available_quantity
FROM inventory.inventory_stock
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid
  AND item_id = 'TEST_ITEM_ID'::uuid;

-- Expected: on_hand = 100, reserved = 25, available = 75
```

**Test 4: Issue to Job**

```sql
SELECT inventory.rpc_inventory_issue_to_job(
    p_tenant_id := 'YOUR_TENANT_ID'::uuid,
    p_user_id := 'YOUR_USER_ID'::uuid,
    p_item_id := 'TEST_ITEM_ID'::uuid,
    p_quantity := 20.0,
    p_unit_id := (SELECT id FROM inventory.units WHERE tenant_id = 'YOUR_TENANT_ID'::uuid LIMIT 1),
    p_from_location_id := (SELECT id FROM inventory.locations WHERE tenant_id = 'YOUR_TENANT_ID'::uuid LIMIT 1),
    p_job_id := gen_random_uuid(),
    p_reason_code := 'JOB_INSTALL'
);

-- ✓ Check stock decreased
SELECT on_hand_quantity, reserved_quantity, available_quantity
FROM inventory.inventory_stock
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid
  AND item_id = 'TEST_ITEM_ID'::uuid;

-- Expected: on_hand = 80, reserved = 25, available = 55
```

---

### Phase 4: AI Features Test

**Test 1: Item Aliases**

```sql
-- Add human alias
INSERT INTO inventory.inventory_item_aliases (
    tenant_id, item_id, alias_text, source, created_by
)
VALUES (
    'YOUR_TENANT_ID'::uuid,
    'TEST_ITEM_ID'::uuid,
    'Widget Type A',
    'human',
    'YOUR_USER_ID'::uuid
);

-- Add AI-suggested alias
INSERT INTO inventory.inventory_item_aliases (
    tenant_id, item_id, alias_text, source, confidence
)
VALUES (
    'YOUR_TENANT_ID'::uuid,
    'TEST_ITEM_ID'::uuid,
    'Wdgt-A',
    'ai_suggested',
    0.85
);

-- ✓ Query by normalized alias (case-insensitive)
SELECT i.name, a.alias_text, a.source, a.confidence
FROM inventory.inventory_item_aliases a
JOIN inventory.items i ON i.id = a.item_id
WHERE a.tenant_id = 'YOUR_TENANT_ID'::uuid
  AND a.normalized_alias = lower('widget type a');
```

**Test 2: AI Suggestions**

```sql
-- Create AI suggestion
INSERT INTO inventory.inventory_ai_suggestions (
    tenant_id, suggestion_type, payload, reasoning, confidence
)
VALUES (
    'YOUR_TENANT_ID'::uuid,
    'reorder_item',
    jsonb_build_object(
        'item_id', 'TEST_ITEM_ID'::uuid,
        'current_qty', 55,
        'min_qty', 50,
        'reorder_qty', 100
    ),
    'Item approaching minimum stock threshold',
    0.92
);

-- ✓ Query pending suggestions
SELECT id, suggestion_type, payload, reasoning, confidence, status
FROM inventory.inventory_ai_suggestions
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid
  AND status = 'new'
ORDER BY created_at DESC;
```

**Test 3: Decision Traces**

```sql
-- Record a decision
INSERT INTO inventory.inventory_decision_traces (
    tenant_id, decision_type, entity_type, entity_id,
    reasoning, decision_maker, decided_by, outcome
)
VALUES (
    'YOUR_TENANT_ID'::uuid,
    'reorder_triggered',
    'item',
    'TEST_ITEM_ID'::uuid,
    jsonb_build_object(
        'rule', 'min_qty_reached',
        'current_available', 55,
        'min_quantity', 50,
        'trigger_reason', 'approaching_threshold'
    ),
    'system_rule',
    'YOUR_USER_ID'::uuid,
    'success'
);

-- ✓ Query decision history
SELECT decision_type, entity_type, reasoning, decision_maker, outcome, created_at
FROM inventory.inventory_decision_traces
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid
ORDER BY created_at DESC;
```

---

### Phase 5: Read Models Test

**Test Views:**

```sql
-- ✓ Comprehensive items view
SELECT * FROM inventory.v_inventory_items
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid
  AND needs_reorder = true;

-- ✓ Availability by location
SELECT * FROM inventory.v_inventory_availability_by_location
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid;

-- ✓ Movement history
SELECT * FROM inventory.v_inventory_item_movement_history
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid
  AND item_id = 'TEST_ITEM_ID'::uuid
ORDER BY created_at DESC
LIMIT 10;

-- ✓ Low stock alerts
SELECT * FROM inventory.v_inventory_low_stock_alerts
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid;

-- ✓ Active reservations
SELECT * FROM inventory.v_inventory_active_reservations
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid;
```

---

### Phase 6: Disaster Recovery Test

**Test Ledger Rebuild:**

```sql
-- Corrupt stock data (simulated)
UPDATE inventory.inventory_stock
SET on_hand_quantity = 999999
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid;

-- ✓ Stock is now incorrect
SELECT * FROM inventory.inventory_stock
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid;

-- Rebuild from ledger
SELECT inventory.rebuild_stock_from_ledger('YOUR_TENANT_ID'::uuid);

-- ✓ Stock should be correct again
SELECT * FROM inventory.inventory_stock
WHERE tenant_id = 'YOUR_TENANT_ID'::uuid
  AND item_id = 'TEST_ITEM_ID'::uuid;

-- Expected: on_hand = 80 (from movements history)
```

---

### Phase 7: RLS Security Test

**Test Tenant Isolation:**

```sql
-- As Tenant A user (YOUR_TENANT_ID)
SELECT COUNT(*) FROM inventory.inventory_movements;
-- Should see only Tenant A movements

-- Try to query Tenant B data (should fail or return 0)
SELECT COUNT(*) FROM inventory.inventory_movements
WHERE tenant_id = 'DIFFERENT_TENANT_ID'::uuid;
-- Should return 0 (RLS blocks)

-- Try to insert for different tenant (should fail)
INSERT INTO inventory.inventory_movements (
    tenant_id, movement_type, quantity_delta, unit_id, item_id,
    to_location_id, created_by
)
VALUES (
    'DIFFERENT_TENANT_ID'::uuid,
    'adjust',
    10,
    (SELECT id FROM inventory.units WHERE tenant_id = 'YOUR_TENANT_ID'::uuid LIMIT 1),
    'TEST_ITEM_ID'::uuid,
    (SELECT id FROM inventory.locations WHERE tenant_id = 'YOUR_TENANT_ID'::uuid LIMIT 1),
    'YOUR_USER_ID'::uuid
);
-- Should fail: RLS policy violation
```

---

## ✅ Success Criteria

Your database is production-ready when:

- [ ] All 8 core tables exist with RLS enabled
- [ ] All 5 views return data correctly
- [ ] All 8 RPCs execute without errors
- [ ] Bootstrap function creates default data
- [ ] Movements are append-only (update/delete triggers work)
- [ ] Stock auto-updates on movement insert
- [ ] Reservations update reserved_quantity correctly
- [ ] Idempotency prevents duplicate movements
- [ ] Events publish to outbox automatically
- [ ] RLS policies block cross-tenant access
- [ ] Ledger rebuild restores correct stock values
- [ ] AI suggestions can be created and resolved
- [ ] Decision traces capture reasoning

---

## 🎯 Next Steps

1. **Frontend Integration:**
   - Call RPCs from Next.js API routes
   - Display views in React components
   - Implement AI suggestion UI

2. **Automation:**
   - Create scheduled job to check `v_inventory_low_stock_alerts`
   - Auto-create AI suggestions for reorders
   - Expire old reservations

3. **Monitoring:**
   - Track events_outbox publish rate
   - Alert on stock rebuild usage (indicates data issues)
   - Monitor RPC execution times

4. **AI Assistant:**
   - Train on decision_traces for pattern learning
   - Use item_aliases for fuzzy search
   - Generate suggestions based on historical data

---

## 📞 Support

If any test fails, check:
1. Migration applied successfully (no rollback)
2. Tenant ID and User ID are correct UUIDs
3. RLS policies allow your user role
4. Foreign key constraints are satisfied (units, locations, categories exist)

Run diagnostics:
```sql
-- Check for errors in migration
SELECT * FROM supabase_migrations.schema_migrations 
ORDER BY version DESC LIMIT 5;

-- Check table ownership
SELECT tablename, tableowner 
FROM pg_tables 
WHERE schemaname = 'inventory';

-- Check for missing indexes
SELECT tablename, indexname 
FROM pg_indexes 
WHERE schemaname = 'inventory' 
ORDER BY tablename;
```
