# Purchase Order & Receiving Implementation Fixes

## Current State Analysis

### ✅ What's Already Working
1. **Database Schema**: Perfect - PO workflow states defined, receipts table exists, `rpc_post_receipt_to_inventory()` exists
2. **Receiving UI**: `/inventory/receiving` page exists with modal for receiving items
3. **PO Creation**: Fixed (vendor filtering, proper field names)
4. **Edit PO**: Full modal with vendor, location, line items

### ❌ Critical Issues Found

#### 1. Receiving API Not Using Atomic RPC
**File**: `src/app/api/inventory/receiving/route.ts`

**Problem**: Manually creating stock_movements instead of using `rpc_post_receipt_to_inventory()`
```typescript
// ❌ WRONG - Manual approach with multiple round-trips
await supabase.rpc('insert_stock_movement', { ... });
```

**Should Be**:
```typescript
// ✅ CORRECT - One atomic RPC call
const result = await supabase.rpc('rpc_post_receipt_to_inventory', {
  p_receipt_id: receipt.id,
  p_actor_user_id: userId
});
```

**Why This Matters**:
- Bypasses proper event emission
- No idempotency protection
- Multiple database round-trips (slow)
- Doesn't create inventory_events properly
- Skips vendor performance tracking

#### 2. No Receipt History on PO Detail
**File**: `src/app/(dashboard)/inventory/purchasing/page.tsx`

**Missing**: Receipt list on PO detail panel showing:
- Receipt number
- Date received
- Location
- Items & quantities received
- Who received it

#### 3. PO Status Workflow Too Complex
**Database**: 9 status states
```sql
draft, awaiting_approval, approved, placed, acknowledged, 
partially_received, fully_received, cancelled, closed
```

**UI**: Should simplify to user-friendly actions:
- Draft → Submit for Approval
- Awaiting Approval → Approve/Reject
- Approved → Place Order (send to vendor)
- Placed → (automatic when receiving)
- Receiving → (automatic partial/full)
- Closed → Close PO

#### 4. Missing "Place Order" Action
Currently no button to transition `approved → placed`

#### 5. Receiving Modal Missing Location Dropdown
**File**: `src/app/(dashboard)/inventory/receiving/page.tsx` line 385

Uses plain text input instead of location dropdown:
```tsx
{/* ❌ WRONG */}
<input type="text" value={form.location_id} placeholder="Location UUID" />

{/* ✅ SHOULD BE */}
<select value={form.location_id}>
  {locations.map(loc => <option value={loc.id}>{loc.name}</option>)}
</select>
```

---

## Implementation Plan

### Phase 1: Fix Receiving API (Critical)
**Priority**: HIGHEST - This is the core inventory update mechanism

1. Refactor `/api/inventory/receiving` POST to:
   - Create receipt header with lines in ONE transaction
   - Call `rpc_post_receipt_to_inventory(receipt_id, user_id)`
   - Return result with posted line counts

2. Update PO line status after receipt:
   - Check if `qty_received >= qty_ordered` → `fully_received`
   - Check if `qty_received > 0 && qty_received < qty_ordered` → `partially_received`
   - Update PO header status based on all lines

**File**: `src/app/api/inventory/receiving/route.ts`

### Phase 2: Add Receipt History to PO Detail
**Priority**: HIGH - Visibility into what was received

1. Fetch receipts linked to PO:
   ```typescript
   const { data: receipts } = await supabase
     .from('receipts')
     .select('*, receipt_lines(*)')
     .eq('po_id', poId);
   ```

2. Display in PO detail panel:
   - Receipt number (clickable)
   - Date received
   - Location name
   - Total items/quantities
   - Received by (user name)

**File**: `src/app/(dashboard)/inventory/purchasing/page.tsx`

### Phase 3: Simplify PO Workflow UI
**Priority**: MEDIUM - Better UX

1. Add status-specific action buttons:
   - `draft` → "Submit for Approval"
   - `awaiting_approval` → "Approve" / "Reject"
   - `approved` → "Place Order" (→ `placed`)
   - `placed` → "Receive Items" (links to receiving page)
   - `partially_received` → "Receive More" / "Close PO"
   - `fully_received` → "Close PO"

2. Update status labels/chips to be user-friendly

**File**: `src/app/(dashboard)/inventory/purchasing/page.tsx`

### Phase 4: Fix Receiving Modal
**Priority**: MEDIUM - UX improvement

1. Fetch locations from `/api/inventory/locations`
2. Replace text input with dropdown
3. Pre-select PO's delivery location if available

**File**: `src/app/(dashboard)/inventory/receiving/page.tsx`

### Phase 5: Testing
**Priority**: HIGH - Ensure everything works

1. Create PO for 10 items
2. Receive 6 items (first receipt)
   - Verify: stock_movements created
   - Verify: stock_balances updated
   - Verify: PO line `qty_received = 6`
   - Verify: PO line status = `partially_received`
   - Verify: PO status = `partially_received`
3. Receive 4 more (second receipt)
   - Verify: PO line `qty_received = 10`
   - Verify: PO line status = `fully_received`
   - Verify: PO status = `fully_received`
4. Close PO
   - Verify: PO status = `closed`

---

## Key Business Rules (Reminder)

### Purchase Order = Intent
- Creating a PO does NOT change inventory
- PO is a document: "We plan to buy this"
- Status workflow tracks approval and vendor communication

### Receipt = Reality
- Creating a receipt DOES change inventory
- Receipt is a fact: "We actually received this"
- One PO can have multiple receipts (partials, backorders)
- Receipts can exist without PO (walk-in purchases)

### Inventory Updates
- **ONLY** happens via `rpc_post_receipt_to_inventory()`
- This creates:
  1. `inventory_events` (audit log)
  2. `stock_movements` (ledger)
  3. `stock_balances` (computed totals)
- Maintains idempotency via `last_event_id`

---

## Technical Details

### Receipt Posting Flow
```
1. Frontend creates receipt header + lines
   └─ POST /api/inventory/receiving
      └─ INSERT INTO receipts (...)
      └─ INSERT INTO receipt_lines (...) FOR EACH line

2. Call atomic RPC
   └─ supabase.rpc('rpc_post_receipt_to_inventory', { p_receipt_id, p_actor_user_id })
      └─ FOR EACH receipt_line:
         ├─ INSERT INTO inventory_events (event_type='received')
         ├─ INSERT INTO stock_movements (movement_type='received', qty=+)
         └─ UPSERT stock_balances (qty_on_hand += qty)

3. Update PO line status
   └─ UPDATE purchase_order_lines SET qty_received += qty
   └─ IF qty_received >= qty_ordered THEN status='fully_received'
   └─ IF qty_received > 0 AND qty_received < qty_ordered THEN status='partially_received'

4. Update PO header status
   └─ IF ALL lines fully_received THEN status='fully_received'
   └─ IF ANY line partially_received THEN status='partially_received'
```

### Status Transition Rules

| Current Status | Allowed Actions | Next Status |
|----------------|----------------|-------------|
| draft | Submit, Edit, Delete | awaiting_approval |
| awaiting_approval | Approve, Reject, Edit | approved, cancelled |
| approved | Place Order, Cancel | placed, cancelled |
| placed | Receive Items | acknowledged, partially_received |
| acknowledged | Receive Items | partially_received |
| partially_received | Receive More, Close | fully_received, closed |
| fully_received | Close | closed |
| closed | (none) | - |
| cancelled | Reopen? | draft |

---

## Files to Modify

1. **src/app/api/inventory/receiving/route.ts** (CRITICAL)
   - Refactor POST to use `rpc_post_receipt_to_inventory()`
   - Update PO line and header status after receiving

2. **src/app/(dashboard)/inventory/purchasing/page.tsx**
   - Add receipt history section to PODetailPanel
   - Add status-specific action buttons
   - Simplify status labels

3. **src/app/(dashboard)/inventory/receiving/page.tsx**
   - Replace location text input with dropdown
   - Fetch and display locations

---

## Success Criteria

- [ ] Receiving creates stock_movements via atomic RPC
- [ ] PO detail shows all receipts linked to it
- [ ] Partial receiving works correctly (status updates)
- [ ] Multiple receipts can be created for one PO
- [ ] Stock balances update correctly after receiving
- [ ] PO status auto-updates based on received quantities
- [ ] "Place Order" button works for approved POs
- [ ] Location dropdown instead of UUID input in receiving modal

---

## Next Steps

Start with **Phase 1** (Receiving API) since that's the critical path for inventory accuracy.
