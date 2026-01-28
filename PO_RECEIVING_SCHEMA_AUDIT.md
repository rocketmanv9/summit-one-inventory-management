# Purchase Order Receiving Workflow - Schema Audit & Implementation

## Date: January 28, 2026

## Executive Summary
**Good News:** The receiving workflow infrastructure is **90% complete**. The core tables (`receipts`, `receipt_lines`), atomic posting RPC (`rpc_post_receipt_to_inventory`), and event infrastructure already exist and are well-designed with proper multitenancy, RLS, and idempotency.

**What's Missing:** 
1. Additional metadata columns for real-world receiving scenarios (vendor info, packing slips, condition tracking)
2. Status tracking for receipts (draft vs. confirmed)
3. Query/fetch RPCs for the receiving UI
4. Support for damaged/rejected items
5. Enhanced event types
6. Edge Function wrappers for frontend

---

## 1. SCHEMA AUDIT - EXISTING INFRASTRUCTURE

### ✅ Existing Tables (Supply Chain Schema)

#### `supply_chain.receipts`
- **Purpose:** Receipt header record
- **Key Columns:**
  - `id` (UUID, PK)
  - `tenant_id` (UUID, NOT NULL) ✅ Multitenancy
  - `po_id` (UUID, NULLABLE) ✅ Supports quick receive
  - `receipt_number` (TEXT, UNIQUE per tenant) ✅
  - `received_at` (TIMESTAMPTZ)
  - `received_by_user_id` (UUID)
  - `location_id` (UUID, NOT NULL) ✅ Destination location
  - `last_event_id` (TEXT, UNIQUE per tenant) ✅ Idempotency
  - `notes` (TEXT)
  - Audit fields: `created_at`, `updated_at`, `created_by`, `updated_by`
- **Indexes:** Comprehensive (tenant, PO, location, received_at)
- **RLS:** ✅ Tenant isolation policy in place
- **Triggers:** 
  - Event emission (`trigger_receipt_events`)
  - Vendor performance tracking
  - Expense matching

**Missing Columns:**
- `status` (draft/confirmed/cancelled)
- `vendor_id` (denormalized from PO for quick receives)
- `packing_slip_no` (vendor reference)
- `vendor_invoice_no` (for matching expenses)
- `source_type` ('delivery' | 'pickup')

#### `supply_chain.receipt_lines`
- **Purpose:** Individual items received
- **Key Columns:**
  - `id` (UUID, PK)
  - `tenant_id` (UUID) ✅
  - `receipt_id` (UUID, FK to receipts, CASCADE)
  - `po_line_id` (UUID, NULLABLE) ✅ Supports substitutions
  - `line_number` (INT, UNIQUE per receipt)
  - `catalog_item_id` (UUID, NOT NULL)
  - `qty_received` (NUMERIC, > 0)
  - `last_event_id` (TEXT, UNIQUE per tenant) ✅ Line-level idempotency
  - Audit fields
- **Constraints:** `qty_received > 0` (enforces positive)
- **RLS:** ✅ Tenant isolation

**Missing Columns:**
- `condition_status` ('accepted' | 'damaged' | 'quarantine' | 'rejected')
- `destination_location_id` (for line-level splitting to multiple locations)
- `unit_cost_actual` (NUMERIC, actual cost vs PO estimate)
- `uom` (unit of measure, denormalized)
- `notes` (line-level notes)

#### `supply_chain.purchase_orders`
- **Status Values:** draft, awaiting_approval, approved, placed, acknowledged, partially_received, fully_received, cancelled, closed
- **Key Columns:**
  - `qty_received` tracking at line level ✅
  - `delivery_location_id` and `pickup_location_id` ✅
  - `delivery_method` ('ship' | 'pickup') ✅
  - Comprehensive cost/job tracking
- **Triggers:** Auto-update status based on line receipts ✅

#### `supply_chain.purchase_order_lines`
- **Key Columns:**
  - `qty_ordered`, `qty_received` ✅
  - `status` (open, partially_received, fully_received, cancelled)
- **Constraints:** `qty_received <= qty_ordered` ⚠️ **This prevents over-delivery**
- **Triggers:** Auto-update line status and PO header status

**Issue:** The constraint `chk_po_line_quantities CHECK (qty_received <= qty_ordered)` will **block over-deliveries**. Need to relax this or add an `allow_over_delivery` flag.

### ✅ Existing Inventory Tables

#### `inventory.stock_balances`
- **Purpose:** Read model for current inventory state
- **Columns:** `qty_on_hand`, `qty_reserved`, `qty_available` (computed)
- **Unique:** `(tenant_id, catalog_item_id, location_id)`
- **Triggers:** Auto-updated by stock_movements ✅

#### `inventory.stock_movements`
- **Purpose:** Authoritative ledger of all inventory transactions
- **Movement Types:** received, issued, adjusted, transferred_in, transferred_out, damaged, returned, counted, reserved, unreserved, consumed
- **Key:** `last_event_id` for idempotency ✅
- **Trigger:** Maintains `stock_balances` automatically ✅

**Gap:** No specific handling for 'rejected' items (received but not accepted). 'damaged' exists but may need refinement.

### ✅ Existing Event Infrastructure

#### `inventory.events_outbox`
- **Purpose:** Outbox pattern for async event publishing
- **Columns:** event_type, aggregate_type, aggregate_id, payload, status, retry_count
- **Idempotency:** NOT enforced at outbox level (events can duplicate if retried)
- **Status:** pending, processing, published, failed, dead

#### Existing Event Types (from `events_outbox`):
- `supply_chain.purchase_order.created`
- `supply_chain.purchase_order.approved`
- `supply_chain.purchase_order.cancelled`
- `supply_chain.receipt.created`
- `supply_chain.receipt.line_added`

**Missing Events:**
- `supply_chain.receipt.confirmed`
- `supply_chain.receipt.cancelled`
- `inventory.stock.received` (distinct from receipt created)
- `purchase_order.status.partially_received`
- `purchase_order.status.fully_received`

### ✅ Existing RPCs

#### `supply_chain.rpc_create_receipt()`
- **Purpose:** Create receipt header + lines
- **Parameters:**
  - `p_receipt_number` (TEXT)
  - `p_location_id` (UUID)
  - `p_lines` (JSONB array)
  - `p_po_id` (UUID, optional) ✅ Supports quick receive
  - `p_received_at` (TIMESTAMPTZ)
  - `p_notes` (TEXT)
  - `p_auto_post` (BOOLEAN, default true)
- **Features:**
  - Creates receipt + lines atomically
  - Optionally auto-posts to inventory
  - Returns `receipt_id`, `line_count`, `posted_to_inventory`
- **Idempotency:** Relies on unique `receipt_number` per tenant

**Missing:** Vendor info, packing slip, status control

#### `supply_chain.rpc_post_receipt_to_inventory()`
- **Purpose:** ATOMIC bridge from supply_chain → inventory
- **Process:**
  1. Creates `inventory.inventory_events` (ledger entry)
  2. Creates `inventory.stock_movements` (authoritative ledger)
  3. Updates `inventory.stock_balances` (read model)
  4. Updates `purchase_order_lines.qty_received` and status
  5. Updates `purchase_orders.status`
- **Idempotency:** ✅ Uses `last_event_id` at receipt, line, event, and movement levels
- **Failure Handling:** ✅ Entire transaction rolls back on error

**Excellent Design:** This RPC is the gold standard for atomic, idempotent operations.

#### `supply_chain.rpc_reverse_receipt_from_inventory()`
- **Purpose:** Undo a posted receipt
- **Use Case:** Return to vendor, data entry error

---

## 2. GAPS & MISSING FUNCTIONALITY

### Critical Gaps

1. **Receipt Status Workflow**
   - No `status` column on `receipts` table
   - Cannot distinguish draft vs. confirmed receipts
   - Solution: Add `status` column with values: `draft`, `confirmed`, `cancelled`

2. **Over-Delivery Support**
   - Constraint `purchase_order_lines.qty_received <= qty_ordered` blocks over-delivery
   - Solution: Add `allow_over_delivery` boolean to PO or relax constraint with warning

3. **Damaged/Rejected Item Handling**
   - No `condition_status` on `receipt_lines`
   - Cannot track what was rejected vs. accepted
   - Solution: Add `condition_status` column and update inventory posting logic to handle rejected items (don't increase on-hand for rejected)

4. **Vendor Info on Quick Receives**
   - `receipts.po_id` is nullable (supports quick receive) ✅
   - But no `vendor_id` on receipts table
   - Solution: Add `vendor_id` to receipts (denormalized from PO or user-selected)

5. **Packing Slip / Invoice Tracking**
   - No columns for vendor references
   - Solution: Add `packing_slip_no`, `vendor_invoice_no`, `source_type`

6. **Line-Level Location Splitting**
   - Cannot split a single receipt line to multiple locations
   - Current: Receipt has one `location_id`, all lines go there
   - Solution: Add `destination_location_id` to `receipt_lines` (defaults to receipt.location_id)

7. **UI Query RPCs**
   - No RPC to fetch open POs with line details
   - No RPC to calculate "remaining qty" per PO line
   - Solution: Create `rpc_get_open_pos_for_receiving()`, `rpc_get_po_receiving_detail()`

### Nice-to-Have Enhancements

8. **Unit Cost Variance Tracking**
   - PO lines have `unit_cost`, but receipt lines don't track actual cost
   - Useful for variance analysis
   - Solution: Add `unit_cost_actual` to `receipt_lines`

9. **Multi-Receipt Visibility**
   - No easy way to see all receipts for a PO
   - Solution: Create view or RPC `rpc_get_po_receipt_history()`

10. **Receipt Approval Workflow**
    - Some orgs require supervisor approval before posting
    - Current: Auto-posts or manually calls `rpc_post_receipt_to_inventory()`
    - Solution: Add `requires_approval`, `approved_by`, `approved_at` columns

---

## 3. RECOMMENDED IMPLEMENTATION PLAN

### Phase 1: Essential Enhancements (Required for MVP)

#### Step 1: Schema Migration - Add Missing Columns
**File:** `supabase/migrations/20260128000000_enhance_receiving_workflow.sql`

```sql
-- Add status tracking to receipts
ALTER TABLE supply_chain.receipts 
  ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN vendor_id UUID REFERENCES supply_chain.vendors(id) ON DELETE SET NULL,
  ADD COLUMN packing_slip_no TEXT,
  ADD COLUMN vendor_invoice_no TEXT,
  ADD COLUMN source_type TEXT DEFAULT 'delivery',
  ADD CONSTRAINT receipts_status_check 
    CHECK (status IN ('draft', 'confirmed', 'cancelled')),
  ADD CONSTRAINT receipts_source_type_check 
    CHECK (source_type IN ('delivery', 'pickup', 'transfer'));

-- Add indexes
CREATE INDEX idx_receipts_vendor_id ON supply_chain.receipts(tenant_id, vendor_id) 
  WHERE vendor_id IS NOT NULL;
CREATE INDEX idx_receipts_status ON supply_chain.receipts(tenant_id, status);

-- Add condition tracking to receipt lines
ALTER TABLE supply_chain.receipt_lines
  ADD COLUMN condition_status TEXT NOT NULL DEFAULT 'accepted',
  ADD COLUMN destination_location_id UUID REFERENCES inventory.locations(id) ON DELETE RESTRICT,
  ADD COLUMN unit_cost_actual NUMERIC(18,4),
  ADD COLUMN uom TEXT,
  ADD COLUMN notes TEXT,
  ADD CONSTRAINT receipt_lines_condition_check 
    CHECK (condition_status IN ('accepted', 'damaged', 'quarantine', 'rejected'));

-- Add index
CREATE INDEX idx_receipt_lines_condition ON supply_chain.receipt_lines(tenant_id, condition_status)
  WHERE condition_status != 'accepted';

-- Relax over-delivery constraint (make it a warning, not hard block)
ALTER TABLE supply_chain.purchase_order_lines 
  DROP CONSTRAINT IF EXISTS purchase_order_lines_qty_received_not_exceed,
  DROP CONSTRAINT IF EXISTS chk_po_line_quantities;

-- Add soft constraint (can exceed but tracked)
ALTER TABLE supply_chain.purchase_order_lines
  ADD COLUMN allow_over_delivery BOOLEAN DEFAULT false,
  ADD CONSTRAINT chk_po_line_quantities_soft 
    CHECK (
      qty_received >= 0 
      AND (allow_over_delivery OR qty_received <= qty_ordered)
    );
```

#### Step 2: Update RLS Policies
Existing RLS on `receipts` and `receipt_lines` should cover new columns automatically since they filter on `tenant_id`.

#### Step 3: Update Receipt Creation RPC
Enhance `rpc_create_receipt()` to accept new parameters:

```sql
CREATE OR REPLACE FUNCTION supply_chain.rpc_create_receipt_v2(
  p_receipt_number TEXT,
  p_location_id UUID,
  p_lines JSONB,
  p_po_id UUID DEFAULT NULL,
  p_vendor_id UUID DEFAULT NULL,
  p_received_at TIMESTAMPTZ DEFAULT now(),
  p_notes TEXT DEFAULT NULL,
  p_packing_slip_no TEXT DEFAULT NULL,
  p_vendor_invoice_no TEXT DEFAULT NULL,
  p_source_type TEXT DEFAULT 'delivery',
  p_status TEXT DEFAULT 'confirmed',
  p_auto_post BOOLEAN DEFAULT true
) RETURNS JSONB
```

#### Step 4: Create UI Query RPCs

```sql
-- Fetch open POs with remaining quantities
CREATE FUNCTION supply_chain.rpc_get_open_pos_for_receiving(
  p_vendor_id UUID DEFAULT NULL
) RETURNS TABLE (
  po_id UUID,
  po_number TEXT,
  vendor_id UUID,
  vendor_name TEXT,
  order_date DATE,
  expected_delivery_date DATE,
  line_count INT,
  fully_received_line_count INT,
  status TEXT
);

-- Get PO detail with line-by-line remaining qty
CREATE FUNCTION supply_chain.rpc_get_po_receiving_detail(
  p_po_id UUID
) RETURNS JSONB;
-- Returns: PO header + lines with qty_ordered, qty_received, qty_remaining

-- Get receipt history for a PO
CREATE FUNCTION supply_chain.rpc_get_po_receipt_history(
  p_po_id UUID
) RETURNS TABLE (
  receipt_id UUID,
  receipt_number TEXT,
  received_at TIMESTAMPTZ,
  location_name TEXT,
  total_lines INT,
  status TEXT
);
```

#### Step 5: Update Inventory Posting Logic
Modify `rpc_post_receipt_to_inventory()` to handle condition_status:

```sql
-- Only post 'accepted' and 'damaged' items to inventory
-- 'rejected' items do NOT increase on_hand
-- 'quarantine' items increase on_hand but flagged

IF v_line.condition_status = 'rejected' THEN
  -- Log event but don't create stock movement
  INSERT INTO inventory.inventory_events (...) VALUES (..., 'rejected', ...);
  v_skipped_count := v_skipped_count + 1;
  CONTINUE;
END IF;

-- For accepted/damaged/quarantine, proceed with stock movement
INSERT INTO inventory.stock_movements (...);
```

#### Step 6: Add Event Definitions
Update event catalog or ensure events are emitted:

- `supply_chain.receipt.confirmed` (when status → confirmed)
- `supply_chain.receipt.cancelled`
- `supply_chain.receipt.line_rejected` (when condition = rejected)
- `inventory.stock.received` (distinct from receipt.created)

---

### Phase 2: Frontend Support (Next.js Edge Functions)

#### Create Edge Function: `/api/supply-chain/receipts`
**Methods:**
- `GET` - Fetch receipts (with filters)
- `POST` - Create receipt (calls `rpc_create_receipt_v2`)

#### Create Edge Function: `/api/supply-chain/receipts/[id]`
**Methods:**
- `GET` - Fetch receipt detail
- `PATCH` - Update receipt (status, notes)
- `DELETE` - Cancel receipt

#### Create Edge Function: `/api/supply-chain/receipts/[id]/confirm`
**Methods:**
- `POST` - Confirm receipt (set status = confirmed, optionally auto-post)

#### Create Edge Function: `/api/supply-chain/purchase-orders/receiving`
**Methods:**
- `GET` - Fetch open POs for receiving (calls `rpc_get_open_pos_for_receiving`)

#### Create Edge Function: `/api/supply-chain/purchase-orders/[id]/receiving`
**Methods:**
- `GET` - Get PO receiving detail (calls `rpc_get_po_receiving_detail`)

---

## 4. IDEMPOTENCY & FAILURE HANDLING

### Current Idempotency Mechanisms ✅

1. **Receipt Level:** `receipts.last_event_id` + unique constraint `(tenant_id, last_event_id)`
2. **Receipt Line Level:** `receipt_lines.last_event_id` + unique constraint
3. **Inventory Event Level:** `inventory_events.last_event_id` + unique constraint
4. **Stock Movement Level:** `stock_movements.last_event_id` + unique constraint
5. **Receipt Number:** Unique per tenant prevents duplicate receipts

### Retry Safety ✅
- All `INSERT` operations use `ON CONFLICT (tenant_id, last_event_id) DO NOTHING`
- If webhook retries, duplicate events are silently ignored
- `rpc_post_receipt_to_inventory()` checks if already posted and returns early

### Failure Scenarios

| Scenario | Handling |
|----------|----------|
| Network failure during receipt creation | Transaction rolls back, retry safe via unique receipt_number |
| Partial line insert failure | Transaction rolls back, all-or-nothing |
| Posting fails mid-way | Transaction rolls back, no partial updates |
| Duplicate event_id in outbox | Idempotent, second insert ignored |
| PO line constraint violation (over-delivery) | Will fail unless we relax constraint (see Phase 1) |

---

## 5. TEST PLAN

### Test Case 1: Basic Receipt with Full Delivery
```sql
-- Setup: Create PO with 2 lines
-- Action: Create receipt for full quantities
-- Expected: 
--   - PO lines status → fully_received
--   - PO status → fully_received
--   - Stock balances increased
--   - Events emitted
```

### Test Case 2: Partial Receipt
```sql
-- Setup: PO has 100 units ordered
-- Action: Receive 50 units
-- Expected:
--   - PO line status → partially_received
--   - qty_received = 50, qty_remaining = 50
--   - Second receipt can receive remaining 50
```

### Test Case 3: Over-Delivery
```sql
-- Setup: PO line has 100 units ordered
-- Action: Receive 110 units
-- Expected:
--   - If allow_over_delivery = true: Accept
--   - If false: Error (or warning in future)
--   - Stock balance = 110
```

### Test Case 4: Damaged Items
```sql
-- Action: Receive 100 units, mark 10 as damaged
-- Expected:
--   - 100 units added to on_hand (or 90 if damaged separate)
--   - Event emitted: inventory.stock.damaged
--   - Damaged items tracked (future: separate location/status)
```

### Test Case 5: Rejected Items
```sql
-- Action: Receive 100 units, mark 20 as rejected
-- Expected:
--   - Only 80 units added to on_hand
--   - Rejected items logged but not inventoried
--   - PO line qty_received = 80 (or 100 if tracking gross)
```

### Test Case 6: Quick Receive (No PO)
```sql
-- Action: Create receipt without po_id
-- Expected:
--   - Receipt created successfully
--   - Stock increased
--   - No PO line updates
--   - vendor_id captured for tracking
```

### Test Case 7: Idempotency - Duplicate Receipt
```sql
-- Action: Call rpc_create_receipt() twice with same receipt_number
-- Expected:
--   - Second call fails with unique constraint error
--   - No duplicate inventory changes
```

### Test Case 8: Idempotency - Duplicate Event
```sql
-- Action: Webhook retries, sends same event_id twice
-- Expected:
--   - Second event ignored (ON CONFLICT DO NOTHING)
--   - No duplicate stock movements
```

### Test Case 9: Line-Level Location Splitting
```sql
-- Action: Receipt line 1 → Location A (50 units), Line 2 → Location B (50 units)
-- Expected:
--   - Stock balance at Location A = 50
--   - Stock balance at Location B = 50
```

### Test Case 10: Receipt Reversal
```sql
-- Action: Post receipt, then reverse it
-- Expected:
--   - Stock movements reversed
--   - Balance decremented
--   - PO line qty_received decremented
```

---

## 6. SECURITY CONSIDERATIONS

### RLS Enforcement ✅
- All tables have tenant_id filtering
- RLS policies prevent cross-tenant data access
- RPCs use `auth.jwt() ->> 'tenant_id'` for tenant scoping

### Authorization
- `rpc_create_receipt()` uses `SECURITY DEFINER` but validates tenant_id from JWT ✅
- No elevation of privilege outside tenant boundary
- Consider adding role-based checks (e.g., only 'warehouse_manager' can confirm receipts)

### Audit Trail ✅
- `created_by`, `updated_by` fields capture user actions
- `inventory_events` and `stock_movements` provide complete audit log
- Events in `events_outbox` track all state changes

---

## 7. PERFORMANCE CONSIDERATIONS

### Indexes ✅
- All foreign keys indexed
- Composite indexes on `(tenant_id, po_id)`, `(tenant_id, status)`, etc.
- Covering indexes for common queries

### Query Optimization
- Use RPC pattern for complex joins (avoids client-side multiple queries)
- Stock balances are denormalized read model (fast lookups)
- Events outbox uses polling with `status = 'pending'` index

### Scalability
- Partitioning by tenant_id (future consideration for large tenants)
- Archive old events_outbox after processing (retention policy)

---

## 8. NEXT STEPS (PRIORITIZED)

### Immediate (Week 1)
1. ✅ Complete schema audit (this document)
2. Create migration: Add status, vendor_id, condition_status columns
3. Update `rpc_create_receipt()` to accept new parameters
4. Test receipt creation with new fields

### Week 2
5. Create UI query RPCs (get open POs, PO detail, receipt history)
6. Update `rpc_post_receipt_to_inventory()` to handle rejected items
7. Relax over-delivery constraint
8. Create Edge Functions for receiving UI

### Week 3
9. Build frontend receiving page (list open POs, create receipt, confirm)
10. Implement line-level location splitting
11. Add event definitions to catalog
12. Comprehensive testing (all 10 test cases)

### Week 4
13. Vendor performance metrics integration
14. Receipt approval workflow (if required)
15. Damaged item separate location/bucket handling
16. Documentation and training

---

## 9. CONCLUSION

**The existing infrastructure is solid and well-architected.** The multitenancy, RLS, idempotency, and atomic posting mechanisms are production-ready. The main gaps are business logic enhancements (status tracking, condition handling, vendor info) and UI support queries.

**Estimated Effort:**
- Schema migration: 2 hours
- RPC updates: 4 hours
- Edge Functions: 6 hours
- Testing: 8 hours
- **Total: 2.5 days**

**Risk Level:** Low. Changes are additive (new columns, new RPCs). Existing functionality remains intact.

**Recommendation:** Proceed with Phase 1 implementation immediately. The design is sound; execution is straightforward.
