# Purchase Order Soft Delete Implementation

## Summary
Implemented soft delete functionality for purchase orders by marking them as "cancelled" instead of removing them from the database.

## Changes Made

### 1. DELETE Endpoint
**File**: `src/app/api/inventory/purchasing/[id]/route.ts`

**Added**: `DELETE /api/inventory/purchasing/:id`

**Functionality**:
- Only allows deleting POs with status `draft` or `awaiting_approval`
- Soft deletes by setting status to `cancelled`
- Appends deletion timestamp to notes field
- Returns error if trying to delete POs in other statuses

**Example**:
```typescript
DELETE /api/inventory/purchasing/{po-id}

// Response:
{
  "success": true,
  "message": "Purchase order PO-12345 has been deleted (cancelled)"
}
```

**Validation**:
- ❌ Cannot delete `placed`, `acknowledged`, `partially_received`, `fully_received`, or `closed` POs
- ✅ Can delete `draft` or `awaiting_approval` POs

### 2. GET Filter Update
**File**: `src/app/api/inventory/purchasing/route.ts`

**Changed**: Added filter to exclude cancelled POs by default
```typescript
.neq('status', 'cancelled')
```

Now cancelled (soft-deleted) POs won't appear in the main PO list, keeping the UI clean.

### 3. UI Delete Button
**File**: `src/app/(dashboard)/inventory/purchasing/page.tsx`

**Added**:
- `deletePO()` function with confirmation dialog
- "Delete PO" button on PO detail panel for draft POs
- "Delete PO" button for awaiting_approval POs
- Confirmation prompt before deletion
- Auto-refresh after successful deletion

**Button Appearance**:
- Red border, red text
- Appears below primary action buttons
- Disabled during deletion operation
- Shows "Deleting..." when processing

## How It Works

### User Flow
1. User opens PO detail panel
2. If PO status is `draft` or `awaiting_approval`, "Delete PO" button appears
3. User clicks "Delete PO"
4. Confirmation dialog: "Are you sure you want to delete PO PO-12345? This will cancel the purchase order."
5. On confirm:
   - API call to `DELETE /api/inventory/purchasing/:id`
   - Status set to `cancelled`
   - Notes appended with `[DELETED: timestamp]`
   - Page refreshes, PO removed from list

### Why Soft Delete?

**Audit Trail**:
- Keeps record of deleted POs in database
- Can track who deleted and when
- Can query cancelled POs if needed

**Data Integrity**:
- No orphaned records
- Foreign key relationships preserved
- Can restore if needed (manually change status back)

**Compliance**:
- Some industries require keeping all records
- Soft delete maintains full history

## Testing

### ✅ Test Cases

**Test 1: Delete Draft PO**
1. Create new PO (status = draft)
2. Open PO detail
3. Click "Delete PO"
4. Confirm deletion
5. Verify: PO status = cancelled, no longer in list

**Test 2: Delete Awaiting Approval PO**
1. Create PO and submit for approval
2. Open PO detail
3. Click "Delete PO"
4. Confirm deletion
5. Verify: PO status = cancelled, no longer in list

**Test 3: Cannot Delete Placed PO**
1. Create PO, approve, and place order
2. Try to delete via API: `DELETE /api/inventory/purchasing/:id`
3. Verify: Error returned, PO unchanged

**Test 4: Cancelled POs Hidden**
1. Delete a PO
2. Refresh purchase order list page
3. Verify: Deleted PO doesn't appear
4. Check database directly
5. Verify: PO still exists with status = cancelled

## Database Query to View Deleted POs

```sql
SELECT 
  po_number,
  status,
  created_at,
  notes
FROM supply_chain.purchase_orders
WHERE tenant_id = 'YOUR_TENANT_ID'
AND status = 'cancelled'
AND notes LIKE '%[DELETED:%'
ORDER BY created_at DESC;
```

## Restoring a Deleted PO (Manual)

If you need to restore a soft-deleted PO:

```sql
UPDATE supply_chain.purchase_orders
SET 
  status = 'draft',
  notes = REPLACE(notes, '[DELETED: <timestamp>]', '[RESTORED: <timestamp>]'),
  updated_at = NOW()
WHERE id = 'PO_ID'
AND tenant_id = 'TENANT_ID';
```

## Files Modified

1. `src/app/api/inventory/purchasing/[id]/route.ts` - Added DELETE endpoint
2. `src/app/api/inventory/purchasing/route.ts` - Filter cancelled POs from GET
3. `src/app/(dashboard)/inventory/purchasing/page.tsx` - Added Delete button and function

## Status Workflow Updated

```
draft 
  ↓ [Submit for Approval] OR [Delete → cancelled]
awaiting_approval
  ↓ [Approve] OR [Reject → cancelled] OR [Delete → cancelled]
approved
  ↓ [Place Order]
placed
  ↓ [Receive Items]
partially_received
  ↓
fully_received
  ↓ [Close PO]
closed

cancelled (soft-deleted or rejected)
  └─ Hidden from main list
```

## Key Points

- ✅ Only `draft` and `awaiting_approval` POs can be deleted
- ✅ Deletion is reversible (soft delete)
- ✅ Deleted POs are hidden from main list
- ✅ Deletion timestamp tracked in notes
- ✅ Confirmation dialog prevents accidental deletion
- ✅ UI automatically refreshes after deletion
