# COMPREHENSIVE INVENTORY SYSTEM AUDIT

**Generated:** January 2025  
**Scope:** Full system audit against detailed requirements  
**Database:** PostgreSQL via Supabase, multi-tenant with RLS  
**Status:** Post stock_balances fix, systematic gap analysis

---

## EXECUTIVE SUMMARY

This audit maps the current inventory management system against comprehensive requirements covering purchase order lifecycle, item lifecycle, stock movements, reservations, accounting integration, and location snapshots. The system demonstrates **strong event-sourced architecture** with good RLS coverage but has **critical gaps in state machine enforcement, frontend UX consistency, and accounting reconciliation**.

**Top 5 Highest-Risk Gaps:**
1. ❌ **No trigger-enforced state machine transitions** - PO/reservation status changes can skip states or violate business rules
2. ❌ **Missing accounting_expenses matching automation** - No trigger to auto-match expenses to POs on receipt
3. ❌ **No reservation fulfillment mechanism** - Frontend exists but no backend API endpoint to fulfill/issue stock
4. ❌ **Incomplete frontend state machines** - Purchasing page doesn't enforce status transitions or show proper action buttons per state
5. ⚠️ **No posted/reversed pattern on stock_movements** - Cannot reverse erroneous movements, only add compensating entries

---

## A. PURCHASE ORDER LIFECYCLE

### Requirements vs Implementation

| Requirement | DB Coverage | Where in DB | Frontend Coverage | Where in FE | Gaps/Risks | Recommendation |
|------------|-------------|-------------|-------------------|-------------|------------|----------------|
| **PO Status Enum**: draft, submitted, approved, in_transit, partially_received, received, cancelled, closed | ✅ Full | `migrations/20260102000005` line 9-11: `status TEXT CHECK (status IN ('draft', 'submitted', 'approved', 'in_transit', 'partially_received', 'received', 'cancelled', 'closed'))` | ⚠️ Partial | `src/app/(dashboard)/inventory/purchasing/page.tsx`: Shows status chips, calculates progress bar | ❌ No state machine enforcement in DB triggers. Frontend shows status but doesn't enforce valid transitions (e.g., draft→approved without submitted) | **Add PO state machine trigger** to validate transitions. Frontend should only show valid action buttons per current status |
| **PO Line Status**: pending, partially_received, received, cancelled | ✅ Full | `migrations/20260102000005` line 45: `status TEXT CHECK (status IN ('pending', 'partially_received', 'received', 'cancelled'))` | ⚠️ Partial | Purchasing page shows line items with qty_ordered/qty_received | ❌ No automatic line status update when qty_received changes. Must be manually updated | **Add trigger** on receipt_lines INSERT to auto-update purchase_order_lines.status and qty_received |
| **Auto-calculate partially_received status** when ANY line is partially received | ❌ Missing | None | ❌ Missing | None | High risk of drift between line status and header status | **Critical:** Add trigger on purchase_order_lines UPDATE to recalculate PO header status based on aggregated line statuses |
| **Auto-transition to 'received' when ALL lines fully received** | ❌ Missing | None | ❌ Missing | None | POs stay stuck in partially_received even when complete | **Add trigger** to auto-set purchase_orders.status = 'received' when all lines have status='received' |
| **Idempotency on PO events** | ✅ Full | `migrations/20260106000010` line 180: `last_event_id TEXT NOT NULL` with `UNIQUE (tenant_id, last_event_id)` | N/A | Backend API handles | ✅ Properly implemented | None |
| **PO expected_delivery_date tracking** | ✅ Full | `purchase_orders.expected_delivery_date DATE` | ✅ Full | Shows date, highlights if late (red text) | ⚠️ No automated alerting or notification system | Low priority: Add background job to flag/notify late POs |

### State Machine Validation

**Expected PO State Machine:**
```
draft → submitted → approved → in_transit → partially_received → received → closed
                                                               ↓
                                                          cancelled (terminal)
```

**Current Implementation:**
- ✅ CHECK constraint prevents invalid status values
- ❌ NO trigger to enforce transition rules (can jump from draft→received directly)
- ❌ NO validation that 'received' status requires all lines received
- ❌ NO automatic status derivation from line statuses

**Recommendation:** Create `validate_po_status_transition()` trigger function.

---

## B. ITEM LIFECYCLE STATUSES

### Requirements vs Implementation

| Requirement | DB Coverage | Where in DB | Frontend Coverage | Where in FE | Gaps/Risks | Recommendation |
|------------|-------------|-------------|-------------------|-------------|------------|----------------|
| **Active flag** (item can be used) | ✅ Full | `migrations/20260106000011` line 21: `ALTER TABLE inventory.catalog_items ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true` | ⚠️ Partial | Items page likely filters active=true but not verified | ⚠️ No validation preventing use of inactive items in POs/reservations | **Add CHECK constraint** on purchase_order_lines and reservations FK to catalog_items that item must be active |
| **Deprecated flag** (item replaced but historical) | ✅ Full | `migrations/20260106000011` line 22: `ADD COLUMN IF NOT EXISTS deprecated BOOLEAN NOT NULL DEFAULT false` | ❌ Unknown | Not visible in audit scope | ❌ Deprecated items could still be ordered | **Add business rule:** Warn when adding deprecated item to PO. Show replacement suggestion |
| **Seasonal flag** (item only stocked seasonally) | ✅ Full | `migrations/20260106000011` line 23: `ADD COLUMN IF NOT EXISTS seasonal BOOLEAN NOT NULL DEFAULT false` | ❌ Unknown | Not visible in audit scope | ⚠️ No seasonal availability enforcement | Low priority: Add UX hint showing seasonal availability window |
| **Lifecycle state machine** (active→deprecated→inactive) | ⚠️ Partial | Columns exist but no state enforcement | ❌ Missing | None | ❌ Can have active=true AND deprecated=true (contradictory) | **Add CHECK constraint:** `CHECK (NOT (active = false AND deprecated = false))` to ensure items are either active, deprecated, or inactive but not contradictory states |

---

## C. STOCK MOVEMENTS LEDGER

### Requirements vs Implementation

| Requirement | DB Coverage | Where in DB | Frontend Coverage | Where in FE | Gaps/Risks | Recommendation |
|------------|-------------|-------------|-------------------|-------------|------------|----------------|
| **Immutable ledger** (no UPDATEs/DELETEs) | ✅ Enforced | `migrations/20260106000010` line 127-151: `stock_movements` table, immutable by design | ✅ Implicit | Backend API only allows INSERT | ✅ Properly implemented | None |
| **Movement types**: received, issued, adjusted, transferred_in, transferred_out, damaged, returned, counted, reserved, unreserved, consumed | ✅ Full | Line 133: `CHECK (movement_type IN ('received', 'issued', 'adjusted', 'transferred_in', 'transferred_out', 'damaged', 'returned', 'counted', 'reserved', 'unreserved', 'consumed'))` | ⚠️ Partial | Stock page shows balances but not movement history | ⚠️ No frontend to view movement ledger for audit trail | **Add movements history page** showing ledger entries per item/location |
| **Source reference linking** (po, receipt, reservation, transfer, cycle_count, manual) | ✅ Full | Line 138-139: `source_ref_type TEXT, source_ref_id UUID` | ❌ Missing | Not visible in frontend | ❌ Cannot trace movement back to originating transaction | **Add drill-down** from stock balance to movements to source PO/receipt |
| **Correlation ID for transfers** (link debit+credit pair) | ✅ Full | Line 143: `correlation_id UUID` with index | ❌ Missing | Transfer page exists but correlation not visible | ⚠️ Cannot easily verify transfer pairs balance | **Add validation:** Show linked pair on transfer detail page |
| **Idempotency via last_event_id** | ✅ Full | Line 146: `last_event_id TEXT NOT NULL` + UNIQUE constraint | N/A | Backend only | ✅ Properly implemented | None |
| **Posted/Reversed status** for error correction | ❌ Missing | No status column on stock_movements | ❌ Missing | None | ❌ **HIGH RISK:** Cannot reverse erroneous movements, only add compensating entries that clutter ledger | **CRITICAL:** Add `posted_status TEXT CHECK (posted_status IN ('posted', 'reversed'))` column + reversal_ref_id to link corrections |
| **Automatic stock_balances projection** | ✅ Fixed | `migrations/20260120000071`: Trigger `maintain_stock_balances()` on stock_movements INSERT | ✅ Works | Stock page now shows correct balances | ⚠️ Trigger not yet in migration history (applied manually) | **Apply migration 20260120000071** via `supabase db reset` or push |

---

## D. RESERVATIONS WORKFLOW

### Requirements vs Implementation

| Requirement | DB Coverage | Where in DB | Frontend Coverage | Where in FE | Gaps/Risks | Recommendation |
|------------|-------------|-------------|-------------------|-------------|------------|----------------|
| **Reservation status**: active, fulfilled, cancelled, expired | ✅ Full | `migrations/20260102000004` line 42: `status TEXT CHECK (status IN ('active', 'fulfilled', 'cancelled', 'expired'))` | ✅ Full | `src/app/(dashboard)/inventory/reservations/page.tsx`: Shows status chips and filter | ✅ Properly implemented | None |
| **Allocation types**: soft, hard, kit | ⚠️ Partial | `reservations.allocation_type TEXT` column exists (verified via frontend code) but **no CHECK constraint** | ✅ Full | Line 15: TypeScript type `'soft' \| 'hard' \| 'kit'` | ❌ Database allows any string value for allocation_type | **Add CHECK constraint:** `CHECK (allocation_type IN ('soft', 'hard', 'kit'))` |
| **qty_reserved impacts stock_balances.qty_reserved** | ✅ Full | `migrations/20260120000071`: Trigger `maintain_stock_reserved()` on reservations INSERT/UPDATE/DELETE | ✅ Works | Stock page shows reserved qty | ⚠️ Trigger manually applied, not in migration | **Apply migration 20260120000071** |
| **Fulfillment transitions**: active → fulfilled | ⚠️ Partial | Status exists but no enforcement | ❌ **CRITICAL GAP** | Frontend has "Fulfill" button (line 59-63) but **no API endpoint exists** | ❌ **HIGHEST RISK:** Cannot actually fulfill reservations. Button calls `/api/inventory/reservations/{id}/fulfill` which doesn't exist | **URGENT:** Create API endpoint + trigger to: 1) Set status=fulfilled 2) Create stock_movement type=issued 3) Reduce qty_on_hand |
| **Release/cancel transitions**: active → cancelled | ⚠️ Partial | Status exists but no enforcement | ❌ **CRITICAL GAP** | Frontend has "Release" button (line 65-74) but **no API endpoint exists** | ❌ **HIGHEST RISK:** Cannot release reservations. Button calls `/api/inventory/reservations/{id}/release` which doesn't exist | **URGENT:** Create API endpoint + trigger to: 1) Set status=cancelled 2) Reduce stock_balances.qty_reserved |
| **Expiration automation** | ⚠️ Partial | `reservations.expiration_date TIMESTAMPTZ` column exists (frontend line 19) | ❌ Missing | Shows expiration date but no automation | ❌ Expired reservations never auto-transition to 'expired' status | **Add background job** (edge function or cron) to auto-expire reservations past expiration_date |
| **needed_by date tracking** | ✅ Full | `reservations.needed_by DATE` | ✅ Full | Shows date, highlights overdue in red (line 141-148) | ✅ Properly implemented | None |
| **job_ref linking** | ✅ Full | `reservations.job_ref JSONB` | ✅ Full | Parses job_ref JSON to display job_name/job_id (line 110-125) | ✅ Properly implemented | None |
| **Idempotency** | ✅ Full | `reservations.last_event_id` + UNIQUE constraint | N/A | Backend only | ✅ Properly implemented | None |

### State Machine Validation

**Expected Reservation State Machine:**
```
active → fulfilled (stock issued)
       ↓
       cancelled (released without issuing)
       ↓
       expired (auto-transition when expiration_date passed)
```

**Current Implementation:**
- ✅ Status enum correct
- ❌ NO trigger to enforce transitions
- ❌ **NO API ENDPOINTS for fulfill/release operations**
- ❌ NO auto-expiration job

---

## E. PURCHASE ORDER LINES

### Requirements vs Implementation

| Requirement | DB Coverage | Where in DB | Frontend Coverage | Where in FE | Gaps/Risks | Recommendation |
|------------|-------------|-------------|-------------------|-------------|------------|----------------|
| **qty_ordered tracking** | ✅ Full | `purchase_order_lines.qty_ordered NUMERIC(18,4)` | ✅ Full | Purchasing page shows qty_ordered (line 26) | ✅ Properly implemented | None |
| **qty_received tracking** | ✅ Full | `purchase_order_lines.qty_received NUMERIC(18,4)` | ✅ Full | Purchasing page shows progress bar based on qty_received (line 97-121) | ✅ Properly implemented | None |
| **Auto-update qty_received on receipt** | ❌ **CRITICAL GAP** | No trigger exists | ❌ Missing | Receiving page exists but mechanism unknown | ❌ **HIGHEST RISK:** qty_received must be manually updated. High drift risk | **URGENT:** Create trigger on receipt_lines INSERT to auto-increment purchase_order_lines.qty_received |
| **Auto-update line status** (pending→partially_received→received) | ❌ **CRITICAL GAP** | No trigger exists | ❌ Missing | None | ❌ Line status drifts from actual qty_received | **URGENT:** Create trigger to auto-update line status based on qty_received |
| **unit_cost tracking** | ✅ Full | `purchase_order_lines.unit_cost NUMERIC(18,4)` | ✅ Full | Purchasing page calculates total $ value (line 59-61, 103-105) | ✅ Properly implemented | None |
| **Line status enum** | ✅ Full | `status TEXT CHECK (status IN ('pending', 'partially_received', 'received', 'cancelled'))` | ⚠️ Partial | Not explicitly shown in UI | ⚠️ Line status not visible to users | **Add column** to purchasing page table showing line status |
| **Prevent ordering inactive items** | ❌ Missing | No CHECK constraint or trigger | ❌ Missing | Item selection mechanism not visible | ❌ Can create PO lines for inactive/deprecated items | **Add trigger** to validate catalog_items.active=true on PO line INSERT |

---

## F. ACCOUNTING EXPENSES EXPOSURE

### Requirements vs Implementation

| Requirement | DB Coverage | Where in DB | Frontend Coverage | Where in FE | Gaps/Risks | Recommendation |
|------------|-------------|-------------|-------------------|-------------|------------|----------------|
| **Expense status**: posted, matched, disputed, ignored | ✅ Full | `migrations/20260106000010` line 379: `status TEXT CHECK (status IN ('posted', 'matched', 'disputed', 'ignored'))` | ❌ Unknown | No accounting expenses page found | ❌ No UI to view/manage expenses | **Create expenses page** to view unmatched expenses and manually match to POs |
| **Auto-match expenses to POs** | ❌ **CRITICAL GAP** | No trigger or automation exists | ❌ Missing | None | ❌ **HIGH RISK:** Expenses never auto-transition to 'matched' even when PO received and invoice matches | **URGENT:** Create trigger on receipts to auto-match accounting_expenses by vendor_id + amount tolerance |
| **matched_at timestamp** | ✅ Full | `accounting_expenses.matched_at TIMESTAMPTZ` | N/A | Not visible | ⚠️ Field exists but never populated since no matching logic | **Auto-populate** in matching trigger |
| **vendor_id + po_id linking** | ✅ Full | FK columns exist (line 373-374) | ❌ Missing | None | ⚠️ Cannot manually link expenses to POs via UI | **Add manual match button** on expenses page |
| **Idempotency** | ✅ Full | `last_event_id` + UNIQUE constraint (line 382) | N/A | Backend only | ✅ Properly implemented | None |
| **receipt_url for invoice images** | ✅ Full | `receipt_url TEXT` (line 380) | ❌ Missing | None | ⚠️ Cannot upload/view invoices | **Add file upload** on expenses page |
| **Disputed expense workflow** | ⚠️ Partial | Status 'disputed' exists but no workflow | ❌ Missing | None | ❌ No mechanism to flag disputed expenses or track resolution | **Add comments/resolution tracking** to disputed expenses |

### Accounting Reconciliation Gap

**Expected Workflow:**
1. Accounting system POSTs expense (API call with idempotent last_event_id)
2. Expense created with status='posted'
3. When PO receipt created, **trigger auto-matches** expense by vendor + amount ±5% tolerance
4. Expense transitions to status='matched', matched_at populated, po_id linked
5. Mismatches stay 'posted' for manual review
6. User can mark as 'disputed' or 'ignored'

**Current Implementation:**
- ✅ Expense table exists with proper schema
- ❌ **NO auto-matching trigger**
- ❌ **NO frontend to manage expenses**
- ❌ **NO API to create expenses** (accounting system integration incomplete)

---

## G. LOCATION STOCK SNAPSHOTS

### Requirements vs Implementation

| Requirement | DB Coverage | Where in DB | Frontend Coverage | Where in FE | Gaps/Risks | Recommendation |
|------------|-------------|-------------|-------------------|-------------|------------|----------------|
| **qty_on_hand derivation** from stock_movements ledger | ✅ Full | `migrations/20260120000071`: `maintain_stock_balances()` trigger aggregates SUM(quantity_delta) | ✅ Full | `src/app/(dashboard)/inventory/stock/page.tsx` shows on_hand_qty | ✅ Properly implemented (after recent fix) | None |
| **qty_reserved derivation** from active reservations | ✅ Full | `migrations/20260120000071`: `maintain_stock_reserved()` trigger sums active reservations | ✅ Full | Stock page shows reserved_qty | ✅ Properly implemented (after recent fix) | None |
| **qty_available calculation** (on_hand - reserved) | ✅ Full | Trigger calculates: `qty_available = qty_on_hand - qty_reserved` | ✅ Full | Stock page shows available_qty | ✅ Properly implemented | None |
| **qty_on_order derivation** from open PO lines | ✅ Full | `migrations/20260106000010` line 280-295: VIEW `v_on_order_by_item_location` aggregates `SUM(qty_ordered - qty_received)` from open POs | ❌ **CRITICAL GAP** | Stock page does NOT show qty_on_order | ❌ **HIGH RISK:** Users cannot see incoming stock in transit. May over-order | **URGENT:** Add qty_on_order column to stock page. JOIN to v_on_order_by_item_location view |
| **Inventory position** (on_hand - reserved + on_order) | ✅ Full | `migrations/20260106000010` line 297-316: VIEW `v_inventory_position` calculates comprehensive position | ❌ **CRITICAL GAP** | Stock page does NOT show inventory position | ❌ **HIGHEST RISK:** Cannot make informed reorder decisions without knowing total position | **URGENT:** Add inventory_position column to stock page. Essential for purchasing decisions |
| **Real-time consistency** (triggers maintain balances automatically) | ✅ Full | Triggers fire on INSERT to stock_movements and reservations tables | ✅ Full | Stock page shows live data | ✅ Properly implemented | None |
| **RLS enforcement** (tenant isolation) | ✅ Full | `migrations/20260106000010` line 171: `CREATE POLICY stock_movements_tenant_isolation` + similar for all related tables | ✅ Full | All queries filtered by tenant_id via RLS | ✅ Properly implemented | None |

### Location Snapshot Completeness

**Expected Fields on Stock Page:**
- ✅ Item name/SKU
- ✅ Location name
- ✅ qty_on_hand
- ✅ qty_reserved
- ✅ qty_available
- ❌ **qty_on_order** (missing from UI)
- ❌ **inventory_position** (missing from UI)

**Database Support:**
- ✅ Views exist for all quantities
- ✅ Triggers maintain stock_balances in real-time
- ❌ API endpoint doesn't JOIN to v_on_order_by_item_location

---

## H. CROSS-CUTTING CONCERNS

### H1. Row-Level Security (RLS)

| Table | RLS Enabled | Policy Name | Coverage | Gaps |
|-------|-------------|-------------|----------|------|
| `purchase_orders` | ✅ | `purchase_orders_tenant_isolation` | Full tenant isolation | None |
| `purchase_order_lines` | ✅ | `purchase_order_lines_tenant_isolation` | Full tenant isolation | None |
| `stock_movements` | ✅ | `stock_movements_tenant_isolation` | Full tenant isolation | None |
| `stock_balances` | ✅ | `stock_balances_tenant_isolation` | Full tenant isolation | None |
| `reservations` | ✅ | `reservations_tenant_isolation` | Full tenant isolation | None |
| `accounting_expenses` | ✅ | `accounting_expenses_tenant_isolation` | Full tenant isolation | None |
| `catalog_items` | ✅ | `catalog_items_tenant_isolation` | Full tenant isolation | None |
| `locations` | ✅ | `locations_tenant_isolation` | Full tenant isolation | None |
| `vendors` | ✅ | `vendors_tenant_isolation` | Full tenant isolation | None |
| `receipts` | ✅ | `receipts_tenant_isolation` | Full tenant isolation | None |
| `receipt_lines` | ✅ | `receipt_lines_tenant_isolation` | Full tenant isolation | None |
| `events_outbox` | ✅ | `events_outbox_tenant_isolation` | Scope-based (tenant/profile/global) | None |

**RLS Coverage:** ✅ **100% - Excellent**

All inventory tables have proper RLS policies enforcing `tenant_id = (auth.jwt() ->> 'tenant_id')::UUID`. No data leakage risk between tenants.

### H2. Idempotency Pattern

| Table | last_event_id Column | UNIQUE Constraint | Events Trigger | Coverage |
|-------|---------------------|-------------------|----------------|----------|
| `purchase_orders` | ✅ | ✅ `(tenant_id, last_event_id)` | ❌ Missing | Partial - no event emission |
| `stock_movements` | ✅ | ✅ `(tenant_id, last_event_id)` | ❌ Missing | Partial - no event emission |
| `reservations` | ✅ | ✅ `(tenant_id, last_event_id)` | ❌ Missing | Partial - no event emission |
| `accounting_expenses` | ✅ | ✅ `(tenant_id, last_event_id)` | ❌ Missing | Partial - no event emission |
| `inventory_events` | ✅ (event_id is PK) | N/A | ✅ | Full - emits to outbox |
| `asset_events` | ✅ (event_id is PK) | N/A | ✅ | Full - emits to outbox |
| `procurement_events` | ✅ (event_id is PK) | N/A | ✅ | Full - emits to outbox |

**Idempotency Coverage:** ⚠️ **Partial**

- ✅ All transactional tables have `last_event_id` with UNIQUE constraints (prevents duplicate event processing)
- ❌ **GAP:** Transactional tables (POs, stock_movements, reservations) don't emit events to outbox
- ✅ Event ledger tables (inventory_events, asset_events, procurement_events) properly emit to outbox via triggers

**Recommendation:** Add triggers on transactional tables to emit domain events to outbox for external consumers.

### H3. Events Outbox & Event-Driven Architecture

**Outbox Table Schema:**
```sql
CREATE TABLE inventory.events_outbox (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    scope TEXT CHECK (scope IN ('tenant', 'profile', 'global')),
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    payload JSONB NOT NULL,
    status TEXT CHECK (status IN ('pending', 'published', 'failed'))
)
```

**Triggers Emitting to Outbox:**
- ✅ `inventory_events` → `emit_inventory_event_to_outbox` trigger
- ✅ `asset_events` → `emit_asset_event_to_outbox` trigger
- ✅ `procurement_events` → `emit_procurement_event_to_outbox` trigger
- ❌ `purchase_orders` - NO trigger
- ❌ `stock_movements` - NO trigger
- ❌ `reservations` - NO trigger

**Event Consumer (Poller):**
- ✅ Edge function exists: `supabase/functions/events-poller/` (from workspace structure)
- ⚠️ **Not audited** - functionality unknown

**Gap:** Most domain entities don't emit events. External systems cannot subscribe to PO status changes, stock movements, or reservation fulfillments.

### H4. Frontend State Machine Implementation

**Audit of Frontend Pages:**

| Page | Path | State Machine Enforcement | Action Buttons Per State | Validation | Gaps |
|------|------|---------------------------|-------------------------|-----------|------|
| **Purchasing** | `inventory/purchasing/page.tsx` | ❌ None | ❌ Generic "View/Edit/Delete" only (line 150+) | ❌ None | **CRITICAL:** Should show state-specific actions (Approve, Submit, Receive) based on PO status. Currently all POs show same buttons |
| **Reservations** | `inventory/reservations/page.tsx` | ❌ None | ⚠️ Has Fulfill/Release buttons but **APIs don't exist** (line 59-74) | ❌ None | **CRITICAL:** Buttons call non-existent endpoints. No validation preventing fulfillment of cancelled reservations |
| **Stock Balances** | `inventory/stock/page.tsx` | N/A | N/A | ✅ Read-only | None - properly implemented as read-only view |
| **Receiving** | `inventory/receiving/page.tsx` | ❌ Not audited | ❌ Not audited | ❌ Not audited | **Unknown** - requires separate audit |

**Frontend State Machine Gaps:**
1. ❌ Purchasing page doesn't enforce state transitions
2. ❌ No client-side validation preventing invalid status changes
3. ❌ Action buttons not dynamically shown/hidden based on current status
4. ❌ No optimistic UI updates (must refresh to see status changes)

---

## CONSOLIDATED GAP LIST

### 🔴 CRITICAL GAPS (Database/Backend)

1. **No state machine triggers**
   - Impact: Can skip states (draft→received), violate business rules
   - Affected: Purchase orders, reservations, catalog items
   - Fix: Create trigger functions to validate all state transitions

2. **Missing reservation fulfillment API**
   - Impact: Cannot fulfill reservations, stock stays reserved forever
   - Affected: Reservations page "Fulfill" button
   - Fix: Create POST `/api/inventory/reservations/{id}/fulfill` endpoint + trigger

3. **Missing reservation release API**
   - Impact: Cannot cancel/release reservations
   - Affected: Reservations page "Release" button
   - Fix: Create POST `/api/inventory/reservations/{id}/release` endpoint + trigger

4. **No auto-update of PO line qty_received**
   - Impact: Qty received must be manually updated, high drift risk
   - Affected: Purchase order receiving workflow
   - Fix: Create trigger on receipt_lines INSERT to increment qty_received

5. **No auto-update of PO line status**
   - Impact: Line status never changes from 'pending' even when received
   - Affected: Purchase order lines
   - Fix: Create trigger to auto-set line status based on qty_received

6. **No auto-calculation of PO header status**
   - Impact: PO stays 'in_transit' even when all lines received
   - Affected: Purchase orders
   - Fix: Create trigger to recalculate header status from line statuses

7. **Missing accounting expense auto-matching**
   - Impact: Expenses never auto-match to POs, requires manual reconciliation
   - Affected: Accounting integration
   - Fix: Create trigger on receipts to auto-match by vendor + amount tolerance

8. **No posted/reversed pattern on stock_movements**
   - Impact: Cannot reverse erroneous movements, ledger gets cluttered
   - Affected: Stock movements correction workflow
   - Fix: Add `posted_status` column + reversal_ref_id

### 🟡 HIGH-PRIORITY GAPS (Frontend UX)

9. **Stock page missing qty_on_order column**
   - Impact: Users cannot see incoming stock, may over-order
   - Affected: Inventory planning decisions
   - Fix: Add column to stock page, JOIN to v_on_order_by_item_location view

10. **Stock page missing inventory_position**
    - Impact: Cannot make informed reorder decisions
    - Affected: Purchasing workflow
    - Fix: Add inventory_position column (on_hand - reserved + on_order)

11. **Purchasing page no state-based action buttons**
    - Impact: Shows same actions for all PO statuses, confusing UX
    - Affected: Purchase order workflow
    - Fix: Dynamically show Approve/Submit/Receive buttons based on current status

12. **No accounting expenses UI**
    - Impact: Cannot view unmatched expenses, manual matching impossible
    - Affected: Accounting reconciliation
    - Fix: Create expenses page with match/dispute actions

13. **No stock movements history page**
    - Impact: Cannot audit individual movements or trace to source
    - Affected: Troubleshooting stock discrepancies
    - Fix: Create movements ledger page with drill-down to source

### 🟢 MEDIUM-PRIORITY GAPS (Automation & Validation)

14. **No auto-expiration of reservations**
    - Impact: Expired reservations stay 'active' and block stock
    - Affected: Reservation accuracy
    - Fix: Create edge function cron job to auto-expire

15. **No validation preventing inactive item orders**
    - Impact: Can create PO lines for inactive/deprecated items
    - Affected: Data integrity
    - Fix: Add trigger to CHECK catalog_items.active=true

16. **No allocation_type CHECK constraint**
    - Impact: Can insert invalid allocation types
    - Affected: Reservations
    - Fix: Add CHECK constraint limiting to soft/hard/kit

17. **No contradictory item lifecycle state validation**
    - Impact: Can have active=false AND deprecated=false (invalid state)
    - Affected: Catalog items
    - Fix: Add CHECK constraint preventing contradictory states

### 🔵 LOW-PRIORITY GAPS (Nice-to-Have)

18. **No late PO alerting**
    - Impact: Late POs only visible when viewing purchasing page
    - Affected: Proactive management
    - Fix: Add background job to flag/notify late deliveries

19. **No invoice image upload**
    - Impact: Cannot attach invoice PDFs to expenses
    - Affected: Expense verification
    - Fix: Add file upload widget to expenses page

20. **No disputed expense resolution tracking**
    - Impact: Disputed expenses have no comments/resolution workflow
    - Affected: Accounting disputes
    - Fix: Add comments/resolution_notes fields

---

## CANONICAL STATE MACHINES

### Purchase Order State Machine
```
[draft]
  ↓ (submit action)
[submitted]
  ↓ (approve action)
[approved]
  ↓ (ship notification)
[in_transit]
  ↓ (first receipt line)
[partially_received]
  ↓ (all lines fully received - AUTOMATIC)
[received]
  ↓ (close action - optional)
[closed]

From any state (except closed):
  ↓ (cancel action)
[cancelled] (terminal)

Validation Rules:
- draft → submitted: Requires vendor_id + at least 1 line
- submitted → approved: Requires approval permission
- approved → in_transit: Optional manual transition or auto on ship notification
- partially_received → received: AUTOMATIC when SUM(qty_received) = SUM(qty_ordered) across all lines
- Cannot transition backwards except via cancel
```

### Purchase Order Line State Machine
```
[pending]
  ↓ (first receipt > 0 - AUTOMATIC)
[partially_received]
  ↓ (qty_received >= qty_ordered - AUTOMATIC)
[received]

From any state:
  ↓ (cancel action)
[cancelled] (terminal)

Validation Rules:
- Auto-transition to partially_received when qty_received > 0 AND qty_received < qty_ordered
- Auto-transition to received when qty_received >= qty_ordered
- Parent PO status = partially_received if ANY line is partially_received
- Parent PO status = received if ALL lines are received or cancelled
```

### Reservation State Machine
```
[active]
  ↓ (fulfill action)
[fulfilled] (terminal)

[active]
  ↓ (release/cancel action)
[cancelled] (terminal)

[active]
  ↓ (expiration_date passed - AUTOMATIC via cron)
[expired] (terminal)

Validation Rules:
- Fulfill requires qty_available >= qty in stock_balances
- Fulfill creates stock_movement type='issued', reduces qty_on_hand
- Cancel reduces stock_balances.qty_reserved
- Expire reduces stock_balances.qty_reserved
```

### Stock Movement Posting State Machine
```
[posted]
  ↓ (reverse action)
[reversed]

Validation Rules:
- Reversed movements create offsetting entry with opposite quantity_delta
- Original movement.posted_status = 'reversed'
- Offsetting movement.reversal_ref_id = original movement.id
- Cannot reverse a reversed movement (prevent cascade)
```

### Accounting Expense State Machine
```
[posted]
  ↓ (auto-match on receipt - AUTOMATIC)
[matched] (terminal)

[posted]
  ↓ (mark disputed action)
[disputed]
  ↓ (resolve action)
[matched] or [ignored]

[posted]
  ↓ (mark ignored action)
[ignored] (terminal)

Validation Rules:
- Auto-match when: vendor_id matches + amount within ±5% tolerance + PO received
- Disputed requires dispute_reason
- Matched sets matched_at timestamp + po_id
```

### Catalog Item Lifecycle State Machine
```
[active=true, deprecated=false]
  ↓ (deprecate action, set replacement_item_id)
[active=false, deprecated=true]
  ↓ (deactivate after historical usage ends)
[active=false, deprecated=false]

Validation Rules:
- Cannot have active=false AND deprecated=false (must be one or the other)
- Deprecated items show warning when added to PO
- Inactive items cannot be added to POs
- seasonal=true items show availability hint
```

---

## RECOMMENDATIONS PRIORITY MATRIX

### 🔥 IMMEDIATE (Week 1)
1. Create reservation fulfill/release API endpoints (blocks user workflow)
2. Add qty_on_order + inventory_position to stock page (blocks purchasing decisions)
3. Create triggers to auto-update PO line qty_received and status (prevents data drift)

### ⚡ SHORT-TERM (Week 2-3)
4. Add state machine validation triggers (PO, reservations, items)
5. Create accounting expenses matching trigger
6. Create expenses management UI page
7. Add posted/reversed pattern to stock_movements

### 🎯 MEDIUM-TERM (Month 2)
8. Implement state-based action buttons on purchasing page
9. Create stock movements history/audit page
10. Add auto-expiration cron job for reservations
11. Add validation constraints (allocation_type, inactive items, etc.)

### 🌟 FUTURE ENHANCEMENTS
12. Invoice image upload for expenses
13. Late PO alerting system
14. Disputed expense resolution workflow
15. Event emission from transactional tables to outbox

---

## CONCLUSION

**Strengths:**
- ✅ Excellent event-sourced architecture with immutable ledgers
- ✅ 100% RLS coverage preventing tenant data leakage
- ✅ Proper idempotency pattern on all transactional tables
- ✅ Stock balances projection triggers now working (after recent fix)
- ✅ Good data modeling with proper referential integrity

**Critical Weaknesses:**
- ❌ No state machine enforcement in database triggers
- ❌ Missing critical API endpoints (reservation fulfill/release)
- ❌ No accounting automation (expense matching)
- ❌ Incomplete frontend state machines (generic buttons for all states)
- ❌ Missing key inventory metrics from stock page (qty_on_order, position)

**Risk Assessment:**
- **Data Integrity Risk:** MEDIUM - State transitions not enforced, can skip states
- **Accounting Risk:** HIGH - No automated expense matching, manual reconciliation required
- **Operational Risk:** MEDIUM - Missing qty_on_order visibility may cause over/under ordering
- **User Experience Risk:** MEDIUM - Non-functional buttons (fulfill/release) frustrate users

**Next Steps:**
1. Address 🔥 IMMEDIATE priorities (fulfill/release APIs, qty_on_order visibility)
2. Implement state machine triggers for PO lifecycle
3. Build accounting expenses matching automation
4. Refactor frontend to show state-specific actions

---

**End of Audit**
