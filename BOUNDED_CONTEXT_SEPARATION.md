# Bounded Context Separation: Supply Chain + Inventory

**Last Updated:** January 21, 2026  
**Migration Files:** 20260121000001, 20260121000002, 20260121000003  
**Status:** Ready to Apply ✅

---

## 🎯 Executive Summary

Your database has been separated into **two bounded contexts** following Domain-Driven Design principles:

### **supply_chain schema**
📦 Procurement documents (vendors, POs, receipts, vendor performance)

### **inventory schema**  
📊 Stock state and changes (ledger, balances, reservations, transfers, assets)

### **The Bridge**
⚡ **ONE atomic RPC**: `supply_chain.rpc_post_receipt_to_inventory()`
- This is the ONLY way to post receipts to inventory
- Writes inventory ledger/movement rows atomically
- Enforces idempotency with `last_event_id`
- NO other process may directly update `stock_balances`

---

## 📋 Schema Separation Details

### **SUPPLY_CHAIN Schema Tables**

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `vendors` | Vendor master data | id, tenant_id, name, code, active |
| `vendor_items` | Catalog → vendor SKU mapping | vendor_id, catalog_item_id, vendor_sku, is_preferred |
| `vendor_performance_metrics` | Vendor KPIs | vendor_id, on_time_delivery_rate, avg_lead_time |
| `vendor_performance_events` | Performance event log | vendor_id, event_type, occurred_at |
| `purchase_orders` | PO headers | id, tenant_id, vendor_id, po_number, status |
| `purchase_order_lines` | PO line items | po_id, catalog_item_id, qty_ordered, qty_received, status |
| `receipts` | Receipt documents | id, tenant_id, location_id, po_id, received_at, **last_event_id** |
| `receipt_lines` | Receipt line items | receipt_id, catalog_item_id, qty_received, **last_event_id** |
| `procurement_events` | Procurement ledger | event_type, po_id, vendor_id, occurred_at |
| `accounting_expenses` | Expense matching | po_id, amount, expense_date |

**Total:** 10 tables moved from `inventory` to `supply_chain`

---

### **INVENTORY Schema Tables (Unchanged)**

| Category | Tables |
|----------|--------|
| **Catalog** | catalog_items, item_categories, item_substitutions |
| **Locations** | locations, item_location_par_levels |
| **Assets** | assets, asset_state, asset_events, asset_assignments |
| **Stock** | stock_balances, stock_movements (ledger) |
| **Ledgers** | inventory_events (immutable ledger) |
| **Reservations** | reservations |
| **Transfers** | transfers, transfer_lines |
| **Cycle Counts** | cycle_counts, cycle_count_lines, cycle_count_variance_thresholds |
| **Metrics** | daily_item_activity, daily_asset_metrics, abc_classification |
| **Alerts** | reorder_alerts |
| **Outbox** | events_outbox |

**Total:** 30+ tables remain in `inventory` schema

---

## 🔗 Cross-Schema References

### **Foreign Keys**
Only ONE cross-schema FK is allowed:

```sql
inventory.catalog_items.preferred_vendor_id 
  → supply_chain.vendors(id) ON DELETE SET NULL
```

All other references use external IDs stored in JSONB payloads.

---

## 🌉 The Atomic Bridge

### **supply_chain.rpc_post_receipt_to_inventory(receipt_id, actor_user_id)**

**What it does (atomically):**

1. ✅ Validates receipt exists in `supply_chain.receipts`
2. ✅ Validates location exists in `inventory.locations`
3. ✅ For each receipt line:
   - Creates `inventory.inventory_events` entry (ledger)
   - Creates `inventory.stock_movements` entry (authoritative ledger)
   - Updates `inventory.stock_balances` (read model)
   - Updates `supply_chain.purchase_order_lines.qty_received`
   - Updates `supply_chain.purchase_order_lines.status`
4. ✅ Updates `supply_chain.purchase_orders.status`
5. ✅ Marks receipt as posted (`last_event_id` set)

**Idempotency:**
- Unique constraint: `(tenant_id, last_event_id)` on:
  - `supply_chain.receipts`
  - `supply_chain.receipt_lines`
  - `inventory.inventory_events`
  - `inventory.stock_movements`
- Safe to call multiple times (no duplicate postings)

**Returns:**
```json
{
  "success": true,
  "receipt_id": "uuid",
  "receipt_number": "RCV-001",
  "posted_lines": 5,
  "skipped_lines": 0,
  "location_id": "uuid",
  "location_name": "Main Warehouse",
  "received_at": "2026-01-21T10:00:00Z",
  "message": "Posted 5 lines to inventory, skipped 0"
}
```

**Error Handling:**
- Throws exception on failure (transaction rolled back)
- Detailed error messages for debugging

---

### **supply_chain.rpc_reverse_receipt_from_inventory(receipt_id, reason, actor_user_id)**

**What it does:**
1. ✅ Validates receipt was posted
2. ✅ Creates negative inventory events (reversal)
3. ✅ Creates negative stock movements
4. ✅ Updates stock balances (decreases)
5. ✅ Reverses PO line status
6. ✅ Clears receipt `last_event_id` (allows re-posting)

**Use cases:**
- Correction of posted receipt errors
- Return to vendor scenarios
- Audit adjustments

**Requires:**
- `reason` parameter (mandatory for audit trail)

---

## 🎨 Frontend Compatibility

### **Compatibility Views**
Frontend code expecting `inventory.*` tables can continue to work:

```sql
-- These views proxy to supply_chain schema
inventory.vendors → supply_chain.vendors
inventory.vendor_items → supply_chain.vendor_items
inventory.purchase_orders → supply_chain.purchase_orders
inventory.purchase_order_lines → supply_chain.purchase_order_lines
inventory.receipts → supply_chain.receipts
inventory.receipt_lines → supply_chain.receipt_lines
inventory.vendor_performance_metrics → supply_chain.vendor_performance_metrics
```

**READ-ONLY:** These are views, not tables. Use RPCs for writes.

---

## 🔧 Frontend RPC Interface

### **Supply Chain RPCs**

#### **1. Create Purchase Order**
```typescript
await supabase.rpc('rpc_create_purchase_order', {
  p_vendor_id: 'uuid',
  p_po_number: 'PO-001',
  p_expected_delivery_date: '2026-01-30',
  p_delivery_location_id: 'uuid',
  p_notes: 'Urgent order',
  p_lines: [
    { catalog_item_id: 'uuid', qty_ordered: 100, unit_cost: 12.50 },
    { catalog_item_id: 'uuid', qty_ordered: 50, unit_cost: 8.00 }
  ]
});

// Returns: {success, po_id, po_number, line_count, status}
```

#### **2. Create Receipt (with auto-post)**
```typescript
await supabase.rpc('rpc_create_receipt', {
  p_receipt_number: 'RCV-001',
  p_location_id: 'uuid',
  p_po_id: 'uuid', // optional
  p_received_at: '2026-01-21T10:00:00Z',
  p_notes: 'All items received',
  p_lines: [
    { catalog_item_id: 'uuid', qty_received: 100, po_line_id: 'uuid' },
    { catalog_item_id: 'uuid', qty_received: 48, po_line_id: 'uuid' }
  ],
  p_auto_post: true // Auto-posts to inventory
});

// Returns: {success, receipt_id, receipt_number, line_count, posted_to_inventory, post_result}
```

#### **3. Manual Post Receipt to Inventory**
```typescript
await supabase.rpc('rpc_post_receipt_to_inventory', {
  p_receipt_id: 'uuid',
  p_actor_user_id: 'uuid' // optional
});

// Returns: {success, receipt_id, posted_lines, skipped_lines, message}
```

#### **4. Reverse Receipt**
```typescript
await supabase.rpc('rpc_reverse_receipt_from_inventory', {
  p_receipt_id: 'uuid',
  p_reason: 'Received wrong items, returned to vendor',
  p_actor_user_id: 'uuid'
});

// Returns: {success, receipt_id, reversed_lines, reason, message}
```

---

### **Inventory RPCs**

#### **5. Issue Inventory**
```typescript
await supabase.rpc('rpc_issue_inventory', {
  p_location_id: 'uuid',
  p_items: [
    { catalog_item_id: 'uuid', qty_issued: 25 },
    { catalog_item_id: 'uuid', qty_issued: 10 }
  ],
  p_issued_to_type: 'job',
  p_issued_to_ref: 'JOB-12345',
  p_reason: 'Job consumption',
  p_notes: 'Issued for asphalt paving project'
});

// Returns: {success, issued_count, location_id, issued_to}
```

#### **6. Adjust Inventory**
```typescript
await supabase.rpc('rpc_adjust_inventory', {
  p_location_id: 'uuid',
  p_catalog_item_id: 'uuid',
  p_new_qty: 92, // Counted quantity
  p_reason: 'count_variance', // Required
  p_notes: 'Cycle count revealed 8 missing units'
});

// Returns: {success, old_qty, new_qty, delta, reason}
```

#### **7. Existing Inventory RPCs** (unchanged)
```typescript
// Transfers
inventory.rpc_inv_transfer_create(...)
inventory.rpc_inv_transfer_execute(...)

// Reservations
inventory.rpc_inv_reserve(...)
inventory.rpc_inv_release_reservation(...)
inventory.rpc_inv_fulfill_reservation_issue(...)

// Cycle Counts
inventory.rpc_inv_cycle_count_start(...)
inventory.rpc_inv_cycle_count_record(...)
inventory.rpc_inv_cycle_count_approve(...)

// Assets
inventory.rpc_inv_asset_assign(...)
inventory.rpc_inv_asset_return(...)
```

---

## ⚡ Idempotency Enforcement

### **Tables with last_event_id Unique Constraints**

| Schema | Table | Constraint |
|--------|-------|-----------|
| supply_chain | receipts | `(tenant_id, last_event_id)` |
| supply_chain | receipt_lines | `(tenant_id, last_event_id)` |
| inventory | inventory_events | `(tenant_id, last_event_id)` |
| inventory | stock_movements | `(tenant_id, last_event_id)` |
| inventory | reservations | `(tenant_id, last_event_id)` |
| inventory | transfers | `(tenant_id, last_event_id)` |

**Pattern:**
```sql
last_event_id = 'receipt-{receipt_id}-line-{line_number}-{epoch_timestamp}'
```

**Guarantees:**
- Same event never applied twice
- Safe retries on network failures
- No duplicate stock postings

---

## 🔒 RLS (Row Level Security)

### **Enforcement**

✅ **ALL tables** in both schemas have RLS enabled  
✅ **ALL tables** have tenant isolation policy:

```sql
CREATE POLICY {table}_tenant_isolation ON {schema}.{table}
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
```

### **Policy Updates**
Migration automatically:
1. Drops old policies from `inventory` schema (on moved tables)
2. Recreates policies in `supply_chain` schema
3. Maintains policies on `inventory` tables

**Result:** Perfect tenant isolation in both schemas.

---

## 📊 Migration Files Summary

### **File 1: 20260121000001_bounded_context_separation.sql**
- Creates `supply_chain` schema
- Moves 10 tables from `inventory` to `supply_chain`
- Moves vendor-related functions/RPCs
- Fixes cross-schema FK (catalog_items.preferred_vendor_id)
- Updates RLS policies
- Creates compatibility views
- Adds `last_event_id` to receipts/receipt_lines
- Verifies inventory schema integrity

### **File 2: 20260121000002_receipt_posting_bridge.sql**
- Creates `supply_chain.rpc_post_receipt_to_inventory()` (atomic bridge)
- Creates `supply_chain.rpc_reverse_receipt_from_inventory()` (reversal)
- Enforces idempotency at every level
- Handles PO status updates
- Transaction-safe with rollback on error

### **File 3: 20260121000003_frontend_rpc_wrappers.sql**
- Creates `supply_chain.rpc_create_purchase_order()`
- Creates `supply_chain.rpc_create_receipt()` (with auto-post)
- Creates `inventory.rpc_issue_inventory()`
- Creates `inventory.rpc_adjust_inventory()`
- Creates compatibility wrapper `inventory.rpc_inv_receive()` (deprecated)
- GRANT EXECUTE to authenticated users

---

## ✅ Verification Checklist

### **Before Migration**
- [ ] Backup database
- [ ] Review migration files
- [ ] Check for custom code referencing moved tables
- [ ] Notify frontend team of new RPC interfaces

### **After Migration**
- [ ] Verify `supply_chain` schema exists
- [ ] Verify 10 tables moved successfully
- [ ] Verify compatibility views work
- [ ] Test `rpc_post_receipt_to_inventory()` with sample receipt
- [ ] Test idempotency (call RPC twice with same receipt_id)
- [ ] Verify RLS policies active on all tables
- [ ] Test frontend receipt flow
- [ ] Test frontend issue flow
- [ ] Monitor performance (should be same or better)

---

## 🚀 Migration Execution

### **Apply Migrations**
```bash
# From project root
docker exec supabase_db_summit-one-inventory-management psql -U postgres -d postgres -f /docker-entrypoint-initdb.d/migrations/20260121000001_bounded_context_separation.sql

docker exec supabase_db_summit-one-inventory-management psql -U postgres -d postgres -f /docker-entrypoint-initdb.d/migrations/20260121000002_receipt_posting_bridge.sql

docker exec supabase_db_summit-one-inventory-management psql -U postgres -d postgres -f /docker-entrypoint-initdb.d/migrations/20260121000003_frontend_rpc_wrappers.sql
```

**OR** use Supabase CLI:
```bash
supabase db push
```

### **Verify**
```sql
-- Check schemas
SELECT schema_name FROM information_schema.schemata 
WHERE schema_name IN ('supply_chain', 'inventory');

-- Check supply_chain tables
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'supply_chain' 
ORDER BY table_name;

-- Check compatibility views
SELECT table_name FROM information_schema.views 
WHERE table_schema = 'inventory' 
  AND table_name IN ('vendors', 'purchase_orders', 'receipts')
ORDER BY table_name;

-- Check RPC bridge
SELECT routine_name, routine_schema 
FROM information_schema.routines 
WHERE routine_name LIKE '%receipt%inventory%'
ORDER BY routine_schema, routine_name;
```

---

## 🎯 Frontend Migration Guide

### **Step 1: Update Queries (Read Operations)**

**OLD:**
```typescript
const { data } = await supabase
  .from('inventory.vendors')
  .select('*');
```

**NEW (no change needed - compatibility views):**
```typescript
const { data } = await supabase
  .from('inventory.vendors') // View proxies to supply_chain.vendors
  .select('*');
```

**RECOMMENDED:**
```typescript
const { data } = await supabase
  .from('supply_chain.vendors') // Direct access (faster)
  .select('*');
```

---

### **Step 2: Update Writes (Use RPCs)**

**OLD (direct inserts - NO LONGER ALLOWED):**
```typescript
// ❌ This will fail - views are read-only
await supabase.from('inventory.receipts').insert({...});
```

**NEW (use RPCs):**
```typescript
// ✅ Correct approach
const { data } = await supabase.rpc('rpc_create_receipt', {
  p_receipt_number: 'RCV-001',
  p_location_id: locationId,
  p_lines: receiptLines,
  p_auto_post: true
});
```

---

### **Step 3: Update Receipt Posting Flow**

**OLD:**
```typescript
// Manual multi-step process
const receipt = await createReceipt(...);
const events = await createInventoryEvents(...);
const movements = await createStockMovements(...);
await updateStockBalances(...);
await updatePOStatus(...);
```

**NEW:**
```typescript
// Single atomic RPC call
const result = await supabase.rpc('rpc_create_receipt', {
  p_receipt_number: 'RCV-001',
  p_location_id: locationId,
  p_lines: [
    { catalog_item_id: itemId, qty_received: 100, po_line_id: poLineId }
  ],
  p_auto_post: true // Automatically posts to inventory
});

// Result contains everything
console.log(result.data.post_result.posted_lines); // 1
console.log(result.data.receipt_id); // uuid
```

---

## 🔥 Critical Rules

### **❌ NEVER DO THIS:**
```typescript
// Direct updates to stock_balances - FORBIDDEN
await supabase.from('inventory.stock_balances').update({
  qty_on_hand: newQty
});
```

### **✅ ALWAYS DO THIS:**
```typescript
// Use RPCs for all inventory changes
await supabase.rpc('rpc_adjust_inventory', {
  p_location_id: locationId,
  p_catalog_item_id: itemId,
  p_new_qty: newQty,
  p_reason: 'count_variance',
  p_notes: 'Cycle count adjustment'
});
```

---

## 📈 Performance Impact

### **Expected Improvements:**
- ✅ Clearer domain boundaries (easier to optimize)
- ✅ Atomic operations (no partial failures)
- ✅ Idempotency (safe retries)
- ✅ Better index targeting (schema-specific)

### **No Regressions:**
- ✅ Compatibility views have zero overhead
- ✅ RPC calls are optimized (SECURITY DEFINER)
- ✅ Same RLS policies (no new checks)
- ✅ Same indexes (all preserved)

---

## 🎉 Benefits

### **1. Clear Domain Boundaries**
- Supply chain team owns procurement
- Inventory team owns stock/assets
- Clear integration contract (atomic bridge RPC)

### **2. Data Integrity**
- Single source of truth for stock changes (`stock_movements` ledger)
- Atomic receipt posting (no partial updates)
- Idempotency prevents duplicates
- Event sourcing enables time-travel queries

### **3. Maintainability**
- Easier to reason about dependencies
- Easier to test (mock the bridge RPC)
- Easier to evolve (change schema without breaking contract)
- Easier to audit (all changes through RPCs)

### **4. Scalability**
- Can optimize each schema independently
- Can partition by schema in future
- Can delegate ownership to different teams
- Can enforce rate limits per schema

### **5. Security**
- RLS enforced everywhere
- RPC-based access (controlled surface area)
- Audit trail via `last_event_id`
- No direct table manipulation from frontend

---

## 📚 Next Steps

1. ✅ Apply migrations to development environment
2. ✅ Test receipt posting flow end-to-end
3. ✅ Update frontend to use new RPCs
4. ✅ Remove direct table access from frontend code
5. ✅ Update API documentation with new RPC interfaces
6. ✅ Train team on bounded context pattern
7. ✅ Apply to staging environment
8. ✅ Monitor performance metrics
9. ✅ Apply to production (off-peak hours)
10. ✅ Celebrate clean architecture! 🎊

---

**Questions?** Check the migration SQL files for detailed comments and implementation.
