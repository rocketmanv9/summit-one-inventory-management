# Transfer Corrections Implementation

## Overview
Refactored transfer workflow to properly distinguish between **corrections** (fixing mistakes) and **returns** (physical movements back).

## Core Principles

### Correction vs Physical Move
- **Correction**: The recorded event was wrong (accounting fix, no real-world movement)
- **Physical Move**: Inventory actually moved, then moved back (requires new transfer)

## Actions Implemented

### 1. Cancel/Void
- **Status**: Draft only
- **Meaning**: "This transfer never happened and never impacted inventory"
- **Implementation**: Already existed
- **Effect**: Deletes draft transfer safely

### 2. Undo Shipment (Correction)
- **Status**: In Transit
- **Meaning**: "We accidentally clicked Ship, but nothing physically moved"
- **Implementation**: New RPC `rpc_inv_transfer_undo_shipment`
- **Effect**: Reverts `in_transit` → `draft`, preserves history
- **Database**: Tracks `ship_undone_at`, `ship_undone_by_user_id`, `ship_undone_reason`
- **Events**: Publishes `transfer.shipment_undone`
- **Requires**: Reason selection (dropdown of common mistakes)

### 3. Reverse Receipt (Correction)
- **Status**: Completed or Partially Received
- **Meaning**: "We received it in the system, but it was wrong (qty/location/item/duplicate)"
- **Implementation**: New RPC `rpc_inv_transfer_reverse_receipt`
- **Effect**: 
  - Creates corrective stock movements (negates original receive)
  - Resets `qty_received` to 0
  - Reverts to `in_transit`
- **Database**: Tracks `receipt_reversed_at`, `receipt_reversed_by_user_id`, `receipt_reversed_reason`
- **Events**: Publishes `transfer.receipt_reversed`
- **Requires**: Reason selection

### 4. Return Inventory (Physical Move)
- **Status**: Completed only
- **Meaning**: "Inventory physically went A → B, now need to physically return B → A"
- **Implementation**: Uses existing reversal RPC (renamed from "Reverse" to "Return")
- **Effect**: Creates new draft transfer in opposite direction
- **Workflow**: Must ship and receive the return transfer to complete

## Fix Mistake Button

Single "Fix Mistake" button shows modal with question:

**"Did the inventory physically move?"**

### No - Shows Correction Options:
- **Undo Shipment** (if in_transit)
  - ❌ Items were never physically shipped
  - Reverts to draft status
  - ⚠️ Accounting correction only

- **Reverse Receipt** (if completed/partially_received)
  - ❌ Items were never physically received
  - Wrong qty/location/item/duplicate
  - ⚠️ Creates corrective stock movements

### Yes - Physical Return:
- **Return Inventory** (if completed)
  - ✅ Items physically went A → B, now returning B → A
  - 📦 Creates new transfer for physical return

## UI Changes

### Button Changes
| Old | New | Status | Meaning |
|-----|-----|--------|---------|
| Cancel | Cancel | Draft | Delete draft |
| Ship | Ship | Draft | Mark as shipped |
| Receive / Partial | (unchanged) | In Transit | Mark as received |
| **Reverse** | **Return** | Completed | Create physical return transfer |
| (new) | **Fix Mistake** | In Transit, Completed | Smart router for corrections vs returns |

### Reason Dropdowns

**Undo Shipment Reasons:**
- Accidentally clicked Ship
- Wrong transfer shipped
- Items not actually shipped
- Other

**Reverse Receipt Reasons:**
- Wrong quantity received
- Wrong location
- Wrong item
- Duplicate entry
- Items not actually received
- Other

## Database Schema

```sql
ALTER TABLE inventory.transfers ADD COLUMN:
- ship_undone_at TIMESTAMPTZ
- ship_undone_by_user_id UUID
- ship_undone_reason TEXT
- receipt_reversed_at TIMESTAMPTZ
- receipt_reversed_by_user_id UUID
- receipt_reversed_reason TEXT
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/inventory/transfers/:id/undo-ship` | POST | Undo shipment (correction) |
| `/api/inventory/transfers/:id/reverse-receipt` | POST | Reverse receipt (correction) |
| `/api/inventory/transfers/:id/reverse` | POST | Create return transfer (physical) |
| `/api/inventory/transfers/:id/cancel` | POST | Cancel draft transfer |

## Event Types

- `transfer.shipment_undone` - Shipment correction applied
- `transfer.receipt_reversed` - Receipt correction applied
- `transfer.reversal_created` - Return transfer created (physical)

## Safety Features

1. **Immutable History**: Never delete posted events, use corrective events
2. **Reason Required**: All corrections require selecting a reason
3. **Clear UI Copy**: Warnings about correction vs physical movement
4. **Status Validation**: Can only undo/reverse in valid statuses
5. **Double-Correction Prevention**: Checks if already undone/reversed
6. **Audit Trail**: Tracks who, when, why for all corrections

## Workflow Examples

### Example 1: Fat-Finger Ship
1. Create transfer: 10 units A → B (draft)
2. Accidentally click "Ship" (status: in_transit)
3. Click "Fix Mistake"
4. Select "No - Undo Shipment"
5. Reason: "Accidentally clicked Ship"
6. Result: Transfer back to draft, can edit or cancel

### Example 2: Wrong Quantity Received
1. Ship 50 tons A → B (in_transit)
2. Receive (completed)
3. Realize should have been 30 tons
4. Click "Fix Mistake"
5. Select "No - Reverse Receipt"
6. Reason: "Wrong quantity received"
7. Result: Stock corrected, transfer back to in_transit
8. Edit transfer to 30 tons
9. Ship and receive again correctly

### Example 3: Physical Return
1. Ship 20 units A → B, receive (completed)
2. Customer returns items (actual physical movement)
3. Click "Fix Mistake"
4. Select "Yes - Return Inventory"
5. Result: New transfer created B → A in draft
6. Ship and receive the return to complete

## Migration Applied
- `20260127000010_add_transfer_corrections.sql`

## Files Modified
- `src/app/(dashboard)/inventory/transfers/page.tsx`
- `src/app/api/inventory/transfers/[id]/undo-ship/route.ts` (new)
- `src/app/api/inventory/transfers/[id]/reverse-receipt/route.ts` (new)

## Testing Checklist
- [x] Database migrations applied
- [ ] Undo shipment on in_transit transfer
- [ ] Reverse receipt on completed transfer
- [ ] Return (physical) creates new transfer
- [ ] Reason required for all corrections
- [ ] Audit trail preserved
- [ ] Stock movements correct after reversals
- [ ] Cannot double-undo/reverse
