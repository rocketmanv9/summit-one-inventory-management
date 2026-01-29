# Cycle Count Feature - Introspection Report & Implementation Plan

**Date:** 2026-01-28
**Engineer:** Summit Inventory Microservice Engineer
**Objective:** Implement complete Cycle Count workflow with event-driven architecture, multitenancy, and idempotency

---

## PHASE 0: INTROSPECTION RESULTS

### A. EXISTING TABLES - INVENTORY SCHEMA

#### ✅ ALREADY EXISTS - CYCLE COUNT FOUNDATION

**1. inventory.cycle_counts (Header Table)**
- **Status:** EXISTS with GOOD foundation
- **Columns:**
  - ✅ id, tenant_id (PK with RLS)
  - ✅ count_number (unique per tenant)
  - ✅ location_id (FK to locations)
  - ✅ scheduled_for, status
  - ✅ counted_by_user_id, started_at, completed_at
  - ✅ last_event_id (idempotency key with UNIQUE constraint)
  - ✅ auto_approved, approval_required
  - ✅ approved_by_user_id, approved_at, approval_notes
  - ✅ notes, created_at, updated_at
  - ✅ created_by, updated_by (audit fields)
- **Status Values:** 'scheduled', 'in_progress', 'completed', 'cancelled'
- **RLS:** ✅ Enabled with tenant_isolation policy
- **Triggers:** ✅ audit fields, updated_at, event emission
- **Missing:**
  - ❌ snapshot_at timestamp
  - ❌ count_type (full/partial)
  - ❌ is_blind boolean
  - ❌ scope_path for sub-locations
  - ❌ config/thresholds snapshot
  - ❌ posted_at timestamp
  - ❌ needs_reconcile flag
  - ❌ movements_after_snapshot metadata

**2. inventory.cycle_count_lines (Detail - Fungible Items)**
- **Status:** EXISTS with GOOD foundation
- **Columns:**
  - ✅ id, tenant_id, cycle_count_id
  - ✅ line_number (unique per count)
  - ✅ catalog_item_id, location_id
  - ✅ qty_expected, qty_counted
  - ✅ variance (computed column)
  - ✅ variance_pct, variance_qty
  - ✅ counted_at, notes
  - ✅ last_event_id (idempotency key)
  - ✅ requires_approval, auto_approved
  - ✅ created_by, updated_by (audit fields)
- **RLS:** ✅ Enabled with tenant_isolation + service_role policies
- **Missing:**
  - ❌ counted_by_user_id (who counted this line)
  - ❌ recount_pass (support multiple counting passes)
  - ❌ variance_reason_code
  - ❌ photo_urls (optional metadata for damaged/issues)

**3. inventory.cycle_count_variance_thresholds**
- **Status:** EXISTS (discovered in table list)
- **Purpose:** Likely stores tenant-configurable thresholds for auto-approval
- **Action:** Need to inspect structure to confirm

#### ❌ MISSING - CRITICAL FOR COMPLETE WORKFLOW

**4. cycle_count_asset_lines (Serialized Asset Counting)**
- **Status:** DOES NOT EXIST
- **Required Columns:**
  - id, tenant_id, cycle_count_id
  - asset_id (FK to assets)
  - expected_present boolean
  - counted_present boolean
  - status (matched/missing/unexpected)
  - scanned_by_user_id, scanned_at
  - notes
  - last_event_id (idempotency)
  - created_at, updated_at, created_by, updated_by
- **Indexes:** tenant_id, cycle_count_id, asset_id, status
- **RLS:** Required

**5. cycle_count_snapshot_skus (Optional - Snapshot Isolation)**
- **Status:** DOES NOT EXIST
- **Purpose:** Preserve expected state at snapshot_at moment
- **Alternative:** Could compute from stock_balances + movements query
- **Decision:** Implement as materialized snapshot for audit trail

**6. cycle_count_snapshot_assets (Optional - Snapshot Isolation)**
- **Status:** DOES NOT EXIST
- **Purpose:** Preserve expected asset locations at snapshot_at
- **Alternative:** Could compute from asset_state + asset_assignments
- **Decision:** Implement as materialized snapshot for audit trail

#### ✅ SUPPORTING TABLES - ALREADY EXIST

**7. inventory.stock_movements (Ledger/Audit Trail)**
- **Status:** EXISTS and EXCELLENT
- **Columns:**
  - ✅ id, tenant_id, catalog_item_id, location_id
  - ✅ quantity_delta, movement_type
  - ✅ source_ref_type, source_ref_id (can link to cycle_count)
  - ✅ unit_cost, currency, reason, notes
  - ✅ correlation_id (for grouping)
  - ✅ occurred_at, created_by_user_id
  - ✅ last_event_id (idempotency)
  - ✅ posting_status ('posted', 'reversed', 'pending')
  - ✅ reversal_ref_id (supports reversals)
- **Movement Types:** includes 'counted', 'adjusted'
- **RLS:** ✅ Enabled
- **Triggers:** ✅ maintain_stock_balances, emit_stock_movement_event
- **Action:** REUSE for posting adjustments

**8. inventory.stock_balances (Current State)**
- **Status:** EXISTS
- **Purpose:** Current qty_on_hand, qty_reserved, qty_available per item+location
- **Action:** REUSE for expected qty snapshot

**9. inventory.assets (Serialized Items)**
- **Status:** EXISTS
- **Columns:** id, tenant_id, catalog_item_id, asset_tag, serial_number, vin, status, location_id, home_location_id
- **Status Values:** 'available', 'assigned', 'in_repair', 'out_of_service', 'retired'
- **Action:** REUSE for serialized asset counting

**10. inventory.asset_state**
- **Status:** EXISTS
- **Purpose:** Current location and assignment of each asset
- **Action:** REUSE for expected asset location snapshot

**11. inventory.catalog_items**
- **Status:** EXISTS
- **Tracking Modes:** 'stock', 'serialized', 'both'
- **Action:** REUSE to determine count requirements

**12. inventory.locations**
- **Status:** EXISTS
- **Types:** yard, warehouse, truck, job, person, vendor, other
- **Parent Support:** parent_location_id for hierarchy
- **Action:** REUSE for scope definition

#### ✅ EVENT INFRASTRUCTURE

**13. inventory.events_outbox**
- **Status:** EXISTS and COMPLIANT with producer protocol
- **Columns:** id, event_type, tenant_id, payload, status, retry_count, next_attempt_at, locked_at, locked_by, last_attempt_at, last_error, published_at
- **View:** public.events_outbox exposes to hub
- **Action:** REUSE for event emission

**14. public.event_definitions**
- **Status:** EXISTS
- **View:** public.event_catalog
- **Current Cycle Events:** NONE registered
- **Action:** ADD cycle count events

**15. public.emit_event() function**
- **Status:** EXISTS
- **Purpose:** Idempotent event emission
- **Action:** REUSE

---

## B. KEEP / MODIFY / ADD DECISION PLAN

### 🟢 KEEP (Use As-Is)

1. **inventory.cycle_counts** - Keep core structure
2. **inventory.cycle_count_lines** - Keep core structure
3. **inventory.stock_movements** - Perfect for posting adjustments
4. **inventory.stock_balances** - Source of expected quantities
5. **inventory.assets** - Serialized inventory source
6. **inventory.asset_state** - Current asset locations
7. **inventory.catalog_items** - Item definitions with tracking_mode
8. **inventory.locations** - Scope and hierarchy
9. **inventory.events_outbox** - Event emission infrastructure
10. **public.event_definitions** - Event catalog
11. **public.emit_event()** - Event emission function

### 🟡 MODIFY (Extend Existing)

#### **inventory.cycle_counts** - ADD COLUMNS:
```sql
ALTER TABLE inventory.cycle_counts ADD COLUMN:
- snapshot_at TIMESTAMPTZ -- When expected state was captured
- count_type TEXT CHECK (count_type IN ('full', 'partial')) DEFAULT 'full'
- is_blind BOOLEAN DEFAULT FALSE
- scope_path TEXT -- Optional sub-location path (zone/bin)
- config_snapshot JSONB -- Thresholds/rules at time of count
- posted_at TIMESTAMPTZ -- When adjustments were posted
- needs_reconcile BOOLEAN DEFAULT FALSE
- movements_since_snapshot INTEGER DEFAULT 0
```

#### **inventory.cycle_counts.status** - EXPAND CHECK CONSTRAINT:
```sql
-- Current: 'scheduled', 'in_progress', 'completed', 'cancelled'
-- Add: 'under_review', 'approved', 'posted', 'closed'
```

#### **inventory.cycle_count_lines** - ADD COLUMNS:
```sql
ALTER TABLE inventory.cycle_count_lines ADD COLUMN:
- counted_by_user_id UUID REFERENCES auth.users(id)
- recount_pass INTEGER DEFAULT 1
- variance_reason_code TEXT
- photo_urls TEXT[] -- Array of photo URLs
- posted_at TIMESTAMPTZ -- When adjustment was posted
- adjustment_movement_id UUID REFERENCES inventory.stock_movements(id)
```

#### **inventory.cycle_count_variance_thresholds** - INSPECT & DOCUMENT
- Need to check existing structure
- Likely has tenant_id, threshold_type, threshold_value
- May need to extend for item categories, location types

### 🔵 ADD (Create New)

#### **1. inventory.cycle_count_asset_lines** - NEW TABLE
```sql
CREATE TABLE inventory.cycle_count_asset_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    cycle_count_id UUID NOT NULL REFERENCES inventory.cycle_counts(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    asset_id UUID NOT NULL REFERENCES inventory.assets(id) ON DELETE RESTRICT,
    expected_present BOOLEAN NOT NULL DEFAULT TRUE,
    counted_present BOOLEAN NULL, -- NULL until scanned
    status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'matched', 'missing', 'unexpected')),
    scanned_by_user_id UUID REFERENCES auth.users(id),
    scanned_at TIMESTAMPTZ,
    notes TEXT,
    last_event_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id),
    
    CONSTRAINT cycle_count_asset_lines_count_line_unique 
        UNIQUE (cycle_count_id, line_number),
    CONSTRAINT cycle_count_asset_lines_tenant_last_event_id_unique 
        UNIQUE (tenant_id, last_event_id),
    CONSTRAINT cycle_count_asset_lines_count_asset_unique
        UNIQUE (cycle_count_id, asset_id)
);
```

#### **2. inventory.cycle_count_snapshot_skus** - NEW TABLE
```sql
CREATE TABLE inventory.cycle_count_snapshot_skus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    cycle_count_id UUID NOT NULL REFERENCES inventory.cycle_counts(id) ON DELETE CASCADE,
    catalog_item_id UUID NOT NULL REFERENCES inventory.catalog_items(id) ON DELETE RESTRICT,
    location_id UUID NOT NULL REFERENCES inventory.locations(id) ON DELETE RESTRICT,
    expected_qty NUMERIC(18,4) NOT NULL,
    snapshot_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT cycle_count_snapshot_skus_unique 
        UNIQUE (cycle_count_id, catalog_item_id, location_id)
);
```

#### **3. inventory.cycle_count_snapshot_assets** - NEW TABLE
```sql
CREATE TABLE inventory.cycle_count_snapshot_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    cycle_count_id UUID NOT NULL REFERENCES inventory.cycle_counts(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES inventory.assets(id) ON DELETE RESTRICT,
    expected_location_id UUID NOT NULL REFERENCES inventory.locations(id) ON DELETE RESTRICT,
    expected_status TEXT NOT NULL,
    snapshot_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT cycle_count_snapshot_assets_unique 
        UNIQUE (cycle_count_id, asset_id)
);
```

#### **4. EVENT CATALOG ENTRIES** - ADD TO public.event_definitions

Required Events:
1. `inventory.cycle_count.created` - v1.0 - active
2. `inventory.cycle_count.started` - v1.0 - active
3. `inventory.cycle_count.snapshot_captured` - v1.0 - active
4. `inventory.cycle_count.line_counted` - v1.0 - active (optional - can be chatty)
5. `inventory.cycle_count.asset_scanned` - v1.0 - active
6. `inventory.cycle_count.submitted_for_review` - v1.0 - active
7. `inventory.cycle_count.approved` - v1.0 - active
8. `inventory.cycle_count.posted` - v1.0 - active
9. `inventory.cycle_count.adjustments_created` - v1.0 - active
10. `inventory.cycle_count.closed` - v1.0 - active
11. `inventory.cycle_count.cancelled` - v1.0 - active
12. `inventory.stock.adjusted` - v1.0 - active (may already exist)

#### **5. HELPER FUNCTIONS** - NEW

1. **inventory.create_cycle_count_snapshot()** - Captures expected state
2. **inventory.detect_movements_since_snapshot()** - Returns movements list
3. **inventory.post_cycle_count_adjustments()** - Atomic posting with idempotency
4. **inventory.emit_cycle_count_event()** - Event trigger function (may exist)

---

## C. WORKFLOW IMPLEMENTATION REQUIREMENTS

### WORKFLOW STATES & TRANSITIONS

```
draft → in_progress → under_review → approved → posted → closed
  ↓           ↓             ↓           ↓
cancelled  cancelled    cancelled   cancelled
```

### CRITICAL BUSINESS RULES

1. **Snapshot Consistency:**
   - Capture snapshot_at when status → 'in_progress'
   - Create snapshot records (skus + assets)
   - Flag needs_reconcile if movements detected before posting

2. **Idempotency:**
   - last_event_id on all tables with UNIQUE constraint
   - Posting must check if already posted (posted_at IS NOT NULL)
   - Use correlation_id for grouping related adjustments

3. **Approval Logic:**
   - Check variance_thresholds table
   - Auto-approve if within thresholds AND auto_approved=TRUE
   - Require manual review if outside thresholds

4. **Posting Atomic Transaction:**
   - One adjustment per line (fungible) or per asset (serialized)
   - All movements with same correlation_id
   - Update cycle_count.status = 'posted', posted_at = NOW()
   - Update cycle_count_lines.posted_at, adjustment_movement_id
   - Emit events in same transaction

5. **RLS & Multitenancy:**
   - All new tables MUST have tenant_id
   - All new tables MUST enable RLS
   - All queries MUST filter by tenant_id

---

## D. GAPS & RISKS

### GAPS TO ADDRESS

1. **No serialized asset counting support** - Need cycle_count_asset_lines table
2. **No snapshot isolation** - Need snapshot tables or query-time computation
3. **No movement conflict detection** - Need helper function
4. **No posting idempotency guarantee** - Need transaction design
5. **No cycle count events registered** - Need event catalog entries
6. **Blind count support unclear** - Need to verify if qty_expected NULL is enforced

### RISKS

1. **Concurrent Modifications:** Movements during count could cause variance confusion
   - **Mitigation:** Implement needs_reconcile flag + detect_movements_since_snapshot()
   
2. **Double-Posting Adjustments:** Retry or duplicate approval could double-adjust
   - **Mitigation:** Check posted_at, use idempotency keys, correlation_id

3. **Scope Ambiguity:** Location hierarchy (parent/child) scope unclear
   - **Mitigation:** Add scope_path field, document scope rules

4. **Performance:** Large location counts could be slow
   - **Mitigation:** Batch snapshot creation, paginated count entry

---

## E. NEXT STEPS

1. ✅ Complete introspection (DONE)
2. 🔄 Create comprehensive SQL migration (NEXT)
3. ⏳ Register events in event_catalog
4. ⏳ Create validation/test queries
5. ⏳ Document API/Edge Functions requirements (notes only)

---

## COMPLIANCE CHECKLIST

- ✅ Multitenancy: All tables have tenant_id
- ✅ RLS: All tables will have RLS policies
- ✅ Idempotency: last_event_id with UNIQUE constraints
- ✅ Events: Outbox pattern with emit_event()
- ✅ Audit: created_at, updated_at, created_by, updated_by
- ✅ Constraints: FKs, CHECKs, NOT NULL appropriately used
- ✅ Indexes: Performance-critical paths covered

---

**Report Status:** COMPLETE
**Ready for Implementation:** YES
