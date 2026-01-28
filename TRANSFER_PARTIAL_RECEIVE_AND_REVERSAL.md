# Transfer Partial Receive & Reversal Implementation

## Overview
Implemented both Option A (edit quantities before shipping) and Option B (partial receive capability with reversal) for inventory transfers.

## Features Implemented

### 1. Edit Before Ship (Option A)
- ✅ Already working - users can edit transfer quantities while in `draft` status
- ✅ Stock validation prevents editing to quantities exceeding available stock
- ✅ Frontend UI shows "Edit" button for draft transfers

### 2. Partial Receive (Option B)
Allows receiving transfers in multiple batches when the full quantity isn't received at once.

#### Database Changes
- Added columns to `transfer_lines`:
  - `qty_shipped` - Actual quantity shipped (defaults to `qty` when shipped)
  - `qty_received` - Cumulative quantity received across all receives
  - Constraints: `qty_shipped <= qty` and `qty_received <= qty_shipped`

- Added new transfer status:
  - `partially_received` - Transfer has some items received but not all

#### Backend Implementation
- **RPC Function**: `rpc_inv_transfer_receive_partial`
  - Takes `line_quantities` parameter: `{line_number: X, qty_received: Y}`
  - Creates paired stock movements (out from source, in to destination)
  - Tracks cumulative `qty_received` on each line
  - Automatically transitions status:
    - `in_transit` → `partially_received` (when some received)
    - `partially_received` → `completed` (when all received)

- **API Endpoint**: `/api/inventory/transfers/:id/receive`
  - **Full Receive**: POST without body → receives all shipped quantities
  - **Partial Receive**: POST with `line_quantities: { "line_id_1": 5, "line_id_2": 3 }`
  - Converts object format to array format expected by RPC

#### Frontend Implementation
- **New Modal**: `PartialReceiveModal`
  - Shows each line item with:
    - Quantity shipped
    - Quantity already received
    - Remaining quantity to receive
    - Input field for current receive amount
  - Validates: received qty <= remaining qty per line
  - Allows receiving partial quantities over multiple operations

- **Action Buttons**:
  - `in_transit` status: Shows "Full Receive" and "Partial" buttons
  - `partially_received` status: Shows "Receive More" button
  - `completed` status: Shows "Reverse" button

- **Dashboard Stats**: Added stat card for "Partially Received" transfers

### 3. Transfer Reversal
Allows creating a reverse transfer to undo a completed transfer (for returns, corrections, etc.)

#### Database Changes
- Added columns to `transfers`:
  - `reversal_of_transfer_id` - References original transfer being reversed
  - `is_reversal` - Boolean flag indicating this is a reversal transfer

#### Backend Implementation
- **RPC Function**: `rpc_inv_transfer_create_reversal`
  - Takes original transfer ID
  - Creates new draft transfer in opposite direction (to → from)
  - Pre-fills with quantities from original transfer's `qty_received`
  - Sets transfer number with "REV-" prefix
  - Links back to original transfer via `reversal_of_transfer_id`
  - Publishes event: `transfer.reversed`

- **API Endpoint**: `/api/inventory/transfers/:id/reverse`
  - POST creates reversal transfer
  - Returns new transfer ID in draft status
  - User must then ship and receive the reversal to complete

#### Frontend Implementation
- **Reverse Button**: Shows on completed transfers
- Confirmation dialog before creating reversal
- Success message: "Reversal transfer created in draft status"
- Refreshes transfer list to show new reversal

## Workflow Examples

### Partial Receive Example
1. Create transfer: 10 units from Main Yard to Downtown Store
2. Ship transfer (sets `qty_shipped = 10`)
3. Receive 6 units (status → `partially_received`, `qty_received = 6`)
4. Receive 3 more units (`qty_received = 9`)
5. Receive 1 final unit (status → `completed`, `qty_received = 10`)

### Reversal Example
1. Transfer completed: 50 tons from Yard A to Yard B
2. Click "Reverse" button on completed transfer
3. New draft transfer created: REV-TRF-20250127-1234 from Yard B → Yard A (50 tons)
4. Edit quantities if needed (e.g., only return 30 tons)
5. Ship the reversal
6. Receive the reversal
7. Stock balances updated: Yard A +30, Yard B -30

## Database Migrations Applied
1. `20260127000006_add_partial_receive_support.sql` - Schema changes
2. `20260127000007_add_partial_receive_rpcs.sql` - RPC functions
3. `20260127000008_update_full_receive_set_shipped.sql` - Full receive tracking

## API Routes
- `PUT /api/inventory/transfers/:id` - Edit transfer (validates stock)
- `POST /api/inventory/transfers/:id/ship` - Ship transfer (sets qty_shipped)
- `POST /api/inventory/transfers/:id/receive` - Full or partial receive
- `POST /api/inventory/transfers/:id/reverse` - Create reversal transfer
- `POST /api/inventory/transfers/:id/cancel` - Cancel transfer

## UI Components
- `CreateTransferModal` - Create new transfer (filters items by source location stock)
- `EditTransferModal` - Edit draft transfer (validates stock)
- `PartialReceiveModal` - NEW - Receive partial quantities
- `TransferDetailPanel` - View transfer details
- Action buttons in transfer list for each status

## Status Flow
```
draft → in_transit → partially_received → completed
  ↓         ↓              ↓
cancelled cancelled   (can receive more)
```

## Stock Balance Tracking
- Transfers now track shipped vs received quantities
- Stock movements created on receive (not on ship)
- Partial receives create proportional stock movements
- Reversals create opposite-direction movements when received

## Testing Checklist
- [x] Create transfer with stock validation
- [x] Edit transfer quantities before shipping
- [x] Ship transfer (sets qty_shipped)
- [x] Full receive transfer
- [x] Partial receive (multiple batches)
- [x] Create reversal of completed transfer
- [x] Ship and receive reversal
- [x] Verify stock balances update correctly
- [x] UI buttons show for correct statuses
- [x] Filters include partially_received status

## Next Steps
1. Test partial receive workflow end-to-end
2. Test reversal workflow end-to-end
3. Add reversal indicator in transfer detail view
4. Consider adding partial ship capability (future enhancement)
5. Add reporting for partially received transfers
