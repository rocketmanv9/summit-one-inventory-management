# DELIVERABLE 0: DB Gap Analysis & Migration Plan

**Date:** January 19, 2026  
**Project:** Summit One Inventory Management Microservice  
**Scope:** Epic Inventory + Supply Chain Implementation

---

## 📋 CURRENT STATE INVENTORY

### Existing Tables (Inventory Schema)
✅ Already implemented and verified:

| Table | Purpose | Has tenant_id | Has RLS | Has Idempotency |
|-------|---------|---------------|---------|-----------------|
| `inventory.item_categories` | Item groupings | ✅ | ✅ | N/A |
| `inventory.catalog_items` | SKU master | ✅ | ✅ | N/A |
| `inventory.locations` | Universal location container | ✅ | ✅ | N/A |
| `inventory.assets` | Serialized/VIN items | ✅ | ✅ | N/A |
| `inventory.inventory_events` | Event ledger | ✅ | ✅ | ✅ (last_event_id) |
| `inventory.asset_events` | Asset event ledger | ✅ | ✅ | ✅ (last_event_id) |
| `inventory.procurement_events` | PO event ledger | ✅ | ✅ | ✅ (last_event_id) |
| `inventory.stock_balances` | Read model: on_hand/reserved/available | ✅ | ✅ | N/A |
| `inventory.reservations` | Stock reservations/allocations | ✅ | ✅ | ✅ (last_event_id) |
| `inventory.asset_state` | Current asset status read model | ✅ | ✅ | N/A |
| `inventory.daily_item_activity` | Analytics aggregates | ✅ | ✅ | N/A |
| `inventory.daily_asset_metrics` | Asset analytics | ✅ | ✅ | N/A |
| `inventory.purchase_orders` | PO header | ✅ | ✅ | ⚠️ (has field, needs verification) |
| `inventory.purchase_order_lines` | PO lines | ✅ | ✅ | ❌ MISSING |
| `inventory.receipts` | Receipt header | ✅ | ✅ | ✅ (last_event_id) |
| `inventory.receipt_lines` | Receipt line items | ✅ | ✅ | ❌ MISSING |
| `inventory.cycle_counts` | Cycle count header | ✅ | ✅ | ❌ MISSING |
| `inventory.cycle_count_lines` | Count line items | ✅ | ✅ | ❌ MISSING |
| `inventory.vendors` | Vendor master | ✅ | ✅ | N/A |
| `inventory.vendor_items` | Vendor catalog mapping | ✅ | ✅ | N/A |
| `inventory.stock_movements` | **LEDGER - Source of Truth** | ✅ | ✅ | ✅ (last_event_id) |

### Existing RPCs (23 Functions)
✅ Core functions already implemented:
- `insert_inventory_event()` - Idempotent event insert
- `insert_asset_event()` - Idempotent asset event insert
- `insert_stock_movement()` - Idempotent ledger write
- `process_stock_receipt()` - Receipt processing
- `generate_reorder_pos()` - Auto-ordering logic
- `verify_quantity_integrity()` - Data validation
- `publish_event()` - Outbox pattern (2 overloads)
- `poll_pending_events()` - Event poller support
- `get_outbox_stats()` - Monitoring
- `get_failed_events()` - Error handling
- `retry_failed_event()` - Retry logic
- `move_to_dead_letter()` - DLQ support
- Triggers: `emit_stock_movement_event`, `emit_po_status_event`, `emit_receipt_event`, `emit_cycle_count_event`, `update_po_status`, `update_po_line_status`

### Events Outbox Infrastructure
✅ Fully implemented:
- `inventory.events_outbox` table with `last_event_id`, `retry_count`, `status`
- `public.events_outbox` view (for poller)
- `public.processed_events` table with RLS
- `public.events_dead_letter` table with RLS  
- Edge Function: `events-poller` (exists, not scheduled)
- Event catalog/definitions system

### Existing Naming Conventions
- **Tables:** `snake_case`, inventory schema
- **Columns:** `snake_case`, `tenant_id` always first
- **Timestamps:** `created_at`, `updated_at` pattern
- **Status fields:** TEXT with CHECK constraints
- **Idempotency:** `last_event_id TEXT NOT NULL` + `UNIQUE (tenant_id, last_event_id)`
- **FK naming:** Descriptive (e.g., `catalog_item_id`, `location_id`)

### Existing RLS Patterns
```sql
-- Standard tenant isolation
CREATE POLICY {table}_tenant_isolation ON {schema}.{table}
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- Service role bypass (where needed)
CREATE POLICY {table}_service_role ON {schema}.{table}
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);
```

### Jobs/Properties Link Patterns
- Uses JSONB columns: `external_ref`, `job_ref`, `assigned_to_ref`
- Example: `locations.external_ref` → `{"type": "job", "job_id": "uuid"}`
- Example: `reservations.job_ref` → `{"job_id": "uuid", "project_code": "ABC"}`

---

## 🔍 GAP ANALYSIS

### Critical Gaps (Prevent Production)

#### 1. ❌ Missing Idempotency Keys
**Impact:** Risk of duplicate writes on retry
- `inventory.purchase_order_lines` - NO `last_event_id`
- `inventory.cycle_counts` - NO `last_event_id`  
- `inventory.cycle_count_lines` - NO `last_event_id`

#### 2. ❌ Missing Core Tables
**Epic inventory requires:**
- **Item Substitutions** - Not implemented
- **Item Location Par Levels** - Not implemented
- **Transfers** (inter-location movement) - Not implemented
- **Transfer Lines** - Not implemented
- **Asset Assignments** (custody tracking) - Not implemented

#### 3. ⚠️ Incomplete Features
**Partial implementations need completion:**
- **Catalog Items:** Missing `base_uom`, `purch_uom`, `issue_uom`, `barcode`, `hazard_flags`
- **Locations:** Missing hierarchical `parent_location_id` support (column exists, no logic)
- **Cycle Counts:** Missing variance approval workflow fields
- **Reservations:** Has basic table, needs full dispatch-safe RPCs
- **Receipts:** Basic structure exists, needs damage/discrepancy/substitution support

#### 4. ❌ Missing RPCs (Business Logic)
**Required for epic inventory:**
- `rpc_inv_reserve()` - Create reservation
- `rpc_inv_release_reservation()` - Cancel reservation
- `rpc_inv_fulfill_reservation_issue()` - Convert to issue
- `rpc_inv_transfer()` - Inter-location transfer
- `rpc_inv_asset_assign()` - Assign asset to employee/job
- `rpc_inv_asset_return()` - Return asset to pool
- `rpc_inv_po_create()` - Create PO (currently manual SQL)
- `rpc_inv_po_receive()` - Process receipt (exists as `process_stock_receipt`, needs review)
- `rpc_inv_po_close_or_backorder()` - Close PO workflow
- `rpc_inv_count_create_batch()` - Create cycle count
- `rpc_inv_count_submit()` - Submit count results
- `rpc_inv_count_approve_variance()` - Approve adjustment

#### 5. ❌ Missing Events
**Outbound events not fully mapped:**
- `inventory.item.created` - ✅ Exists
- `inventory.item.updated` - ✅ Exists
- `inventory.stock.received` - ✅ Exists
- `inventory.stock.issued` - ⚠️ Partial (needs explicit event)
- `inventory.transfer.completed` - ❌ Missing
- `inventory.reservation.created` - ❌ Missing
- `inventory.reservation.fulfilled` - ❌ Missing
- `inventory.reservation.cancelled` - ❌ Missing
- `procurement.po.created` - ✅ Exists
- `procurement.po.received_partial` - ⚠️ Needs refinement
- `procurement.po.closed` - ❌ Missing
- `asset.assigned` - ❌ Missing
- `asset.returned` - ❌ Missing
- `inventory.count.variance_approved` - ❌ Missing

---

## 🎯 WHAT'S MISSING FOR EPIC INVENTORY

### Missing Tables (7)
1. **inv_item_substitutions** - Alternative items
2. **inv_item_location_par_levels** - Min/max by location
3. **inv_transfers** - Transfer header
4. **inv_transfer_lines** - Transfer line items
5. **inv_asset_assignments** - Custody ledger
6. **inv_reorder_suggestions** - Auto-ordering queue (optional)
7. **inv_variance_approvals** - Cycle count approval workflow

### Missing Columns (Enhancement of Existing Tables)
**catalog_items needs:**
- `base_uom` TEXT
- `purch_uom` TEXT
- `issue_uom` TEXT
- `barcode` TEXT
- `hazard_flags` JSONB

**cycle_counts needs:**
- `approved_by_user_id` UUID
- `approved_at` TIMESTAMPTZ
- `variance_reason` TEXT

**cycle_count_lines needs:**
- `approved` BOOLEAN
- `approved_by_user_id` UUID
- `approved_at` TIMESTAMPTZ

**receipts needs:**
- `damage_qty` NUMERIC
- `discrepancy_qty` NUMERIC

**receipt_lines needs:**
- `damage_qty` NUMERIC
- `expected_qty` NUMERIC
- `variance_qty` GENERATED

### Missing Indexes
- Composite indexes for common queries (item + location + date ranges)
- GIN indexes for JSONB search patterns
- Partial indexes for active/pending status filters

---

## 📝 MIGRATION PLAN (Ordered)

### Phase 1: Critical Idempotency Fixes (MUST DO FIRST)
**Files:** `20260120000001` through `20260120000003`

These MUST be applied before any production use:

1. **20260120000001_add_idempotency_to_po_lines.sql**
   - Add `last_event_id` to `purchase_order_lines`
   - Add unique constraint `(tenant_id, last_event_id)`
   - Backfill existing rows with `'legacy_' || id`

2. **20260120000002_add_idempotency_to_cycle_counts.sql**
   - Add `last_event_id` to `cycle_counts` and `cycle_count_lines`
   - Add unique constraints
   - Backfill existing rows

3. **20260120000003_verify_idempotency_coverage.sql**
   - Verification query: confirm ALL tables with writes have idempotency
   - Creates monitoring view `v_idempotency_coverage`

### Phase 2: Catalog Enhancements
**Files:** `20260120000010` through `20260120000012`

4. **20260120000010_enhance_catalog_items_uom_hazards.sql**
   - Add `base_uom`, `purch_uom`, `issue_uom`, `barcode`, `hazard_flags`
   - Add indexes on barcode and hazard flags
   - RLS already exists, no changes needed

5. **20260120000011_create_item_substitutions.sql**
   - Create `inv_item_substitutions` table
   - Columns: `tenant_id`, `item_id`, `substitute_item_id`, `priority`, `active`
   - RLS policies
   - Unique constraint on `(tenant_id, item_id, substitute_item_id)`

6. **20260120000012_create_item_location_par_levels.sql**
   - Create `inv_item_location_par_levels` table
   - Columns: `tenant_id`, `item_id`, `location_id`, `min_qty`, `max_qty`, `reorder_point`, `safety_stock`
   - RLS policies
   - Unique constraint on `(tenant_id, item_id, location_id)`

### Phase 3: Transfers Infrastructure
**Files:** `20260120000020` through `20260120000022`

7. **20260120000020_create_transfers_tables.sql**
   - Create `inv_transfers` (header) and `inv_transfer_lines`
   - Statuses: draft, in_transit, completed, cancelled
   - Both tables have `last_event_id` for idempotency
   - RLS policies
   - Indexes

8. **20260120000021_create_transfer_rpcs.sql**
   - `rpc_inv_transfer_create()` - Draft transfer
   - `rpc_inv_transfer_execute()` - Write paired ledger entries (out + in)
   - `rpc_inv_transfer_cancel()` - Cancel draft
   - All enforce tenant + idempotency

9. **20260120000022_add_transfer_events.sql**
   - Register `inventory.transfer.created`
   - Register `inventory.transfer.completed`
   - Register `inventory.transfer.cancelled`
   - Update triggers to emit events

### Phase 4: Asset Assignments (Custody Tracking)
**Files:** `20260120000030` through `20260120000032`

10. **20260120000030_create_asset_assignments.sql**
    - Create `inv_asset_assignments` table
    - Columns: `tenant_id`, `asset_id`, `assigned_to_type` (employee/vehicle/job), `assigned_to_id`, `assigned_at`, `returned_at`, `last_event_id`
    - RLS policies
    - Unique constraint on active assignments

11. **20260120000031_create_asset_assignment_rpcs.sql**
    - `rpc_inv_asset_assign()` - Assign asset with idempotency
    - `rpc_inv_asset_return()` - Return asset with idempotency
    - Updates `asset_state` read model

12. **20260120000032_add_asset_assignment_events.sql**
    - Register `asset.assigned` and `asset.returned` events
    - Update triggers

### Phase 5: Reservation Enhancements (Dispatch-Safe)
**Files:** `20260120000040` through `20260120000042`

13. **20260120000040_enhance_reservations_workflow.sql**
    - Add `fulfilled_by_user_id`, `cancelled_by_user_id`, `expiration_date`
    - Add `allocation_type` (job/project/customer_order)
    - Indexes for expiration monitoring

14. **20260120000041_create_reservation_rpcs.sql**
    - `rpc_inv_reserve()` - Create reservation (idempotent)
    - `rpc_inv_release_reservation()` - Cancel (idempotent)
    - `rpc_inv_fulfill_reservation_issue()` - Convert to issue (idempotent)
    - All update `stock_balances.qty_reserved`

15. **20260120000042_add_reservation_events.sql**
    - Register `inventory.reservation.created`
    - Register `inventory.reservation.fulfilled`
    - Register `inventory.reservation.cancelled`
    - Update triggers

### Phase 6: Cycle Count Variance Approval
**Files:** `20260120000050` through `20260120000052`

16. **20260120000050_enhance_cycle_counts_approval.sql**
    - Add approval fields to `cycle_counts` and `cycle_count_lines`
    - Add `variance_threshold` to trigger approval workflow
    - Indexes

17. **20260120000051_create_cycle_count_rpcs.sql**
    - `rpc_inv_count_create_batch()` - Create count (idempotent)
    - `rpc_inv_count_submit()` - Submit results (idempotent)
    - `rpc_inv_count_approve_variance()` - Approve + write adjustment ledger entries

18. **20260120000052_add_cycle_count_events.sql**
    - Register `inventory.count.created`
    - Register `inventory.count.variance_approved`
    - Update triggers

### Phase 7: Purchase Order RPCs & Enhancement
**Files:** `20260120000060` through `20260120000063`

19. **20260120000060_enhance_receipts_damage_discrepancy.sql**
    - Add `damage_qty`, `discrepancy_qty` to `receipt_lines`
    - Add `expected_qty`, `variance_qty GENERATED` columns
    - Indexes

20. **20260120000061_create_po_rpcs.sql**
    - `rpc_inv_po_create()` - Create PO (idempotent)
    - `rpc_inv_po_approve()` - Approve (idempotent)
    - `rpc_inv_po_close_or_backorder()` - Close workflow

21. **20260120000062_enhance_receipt_processing.sql**
    - Update `process_stock_receipt()` to handle damage/discrepancy
    - Support substitution items
    - Idempotent processing

22. **20260120000063_add_po_events.sql**
    - Register `procurement.po.approved`
    - Register `procurement.po.closed`
    - Register `procurement.po.backordered`
    - Update triggers

### Phase 8: Verification & Testing
**Files:** `20260120000070` through `20260120000072`

23. **20260120000070_create_verification_views.sql**
    - `v_inventory_position` - on_hand + on_order - reserved
    - `v_items_below_reorder` - Trigger auto-ordering
    - `v_ledger_vs_balances` - Reconciliation check
    - `v_reservation_integrity` - Reserved <= on_hand

24. **20260120000071_create_test_data_helpers.sql**
    - `fn_test_create_sample_items()` - Generate test SKUs
    - `fn_test_simulate_receipt()` - Test receipt workflow
    - `fn_test_simulate_issue()` - Test issue workflow
    - `fn_test_simulate_transfer()` - Test transfer workflow

25. **20260120000072_verification_test_suite.sql**
    - SQL queries to verify:
      * Idempotency (duplicate last_event_id is rejected)
      * RLS (cross-tenant reads blocked)
      * Ledger integrity (movements balance = stock_balances)
      * Reservation integrity (reserved qty doesn't exceed on_hand)
      * Event emission (every write triggers outbox event)

---

## ✅ SUMMARY

**Current State:**
- 20+ tables implemented ✅
- 23 RPCs/functions ✅
- Event ledger pattern ✅
- Outbox infrastructure ✅
- RLS on all tables ✅
- Basic idempotency (60% coverage) ⚠️

**Gaps:**
- 3 critical idempotency gaps ❌
- 7 missing tables ❌
- 12 missing RPCs ❌
- 9 missing events ❌
- UOM/hazard enhancements needed ⚠️

**Migration Plan:**
- **25 migration files** (ordered by dependency)
- **8 phases** (idempotency → catalog → transfers → assets → reservations → cycle counts → POs → testing)
- **Estimated work:** 3-5 days for complete implementation
- **Priority:** Phase 1 (idempotency) is CRITICAL before production

---

**Next Step:** Proceed to generate full SQL for all 25 migrations?
