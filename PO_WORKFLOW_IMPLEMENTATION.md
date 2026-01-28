# Purchase Order Workflow Implementation

## Core Principle
**PO = Intent | Receipt = Reality | Inventory Updates on Receipt Only**

## Database Schema Summary

### purchase_orders
- **Purpose**: Track intent to purchase
- **Key Fields**:
  - `status`: draft → awaiting_approval → approved → placed → acknowledged → partially_received → fully_received → closed
  - `vendor_id`: Who we're buying from
  - `delivery_location_id`: Where items will go
  - `order_date`: When PO was created
  - `expected_delivery_date`: When we expect items

### purchase_order_lines  
- **Purpose**: Line items on the PO (what we intend to buy)
- **Key Fields**:
  - `catalog_item_id`: What item
  - `qty_ordered`: How many we want
  - `unit_cost`: Estimated/quoted price
  - `status`: open | partially_received | fully_received | cancelled

### receipts
- **Purpose**: Record of what was ACTUALLY received
- **Key Fields**:
  - `po_id`: Links back to PO (optional - can receive without PO)
  - `received_at`: When received
  - `location_id`: Where received
  - `received_by_user_id`: Who received it

### receipt_lines
- **Purpose**: Details of what was received
- **Key Fields**:
  - `receipt_id`: Links to receipt header
  - `po_line_id`: Links back to PO line (optional)
  - `catalog_item_id`: What was received
  - `qty_received`: Actual quantity received

### stock_movements (triggered by receipt_lines)
- **Purpose**: Ledger of all inventory changes
- Automatically created when receipt_line is inserted
- Updates stock_balances via trigger

## Workflow States

### 1. Draft
- User is building the PO
- Can edit everything
- Not yet committed
- **Actions**: Edit, Submit for Approval, Delete

### 2. Awaiting Approval (Optional)
- Submitted but needs manager approval
- Cannot edit
- **Actions**: Approve, Reject

### 3. Approved
- Approved internally
- Ready to send to vendor
- **Actions**: Place Order, Cancel

### 4. Placed/Issued
- PO sent to vendor (email, phone, portal, in-person)
- Vendor is aware of the order
- Waiting for shipment/pickup
- **Actions**: Receive (partial or full), Cancel

### 5. Acknowledged (Optional)
- Vendor confirmed they got the PO
- Gives ETA
- **Actions**: Receive, Update ETA

### 6. Partially Received
- Some items received, some pending
- **Actions**: Receive More, Close PO

### 7. Fully Received
- All line items received (qty_received >= qty_ordered for all lines)
- **Actions**: Close PO

### 8. Closed
- PO is complete
- No more receipts expected
- Kept for audit trail
- **Actions**: View Only

### 9. Cancelled
- PO was cancelled before completion
- Kept for audit trail
- **Actions**: View Only

## Key Business Rules

1. **Inventory Only Updates on Receipt**
   - Creating a PO does NOT change stock_balances
   - Only when receipt_line is created does stock_movements get inserted
   - This is enforced by database triggers

2. **One PO → Many Receipts**
   - Vendor ships partial loads
   - Multiple pickups
   - Backorders arrive later

3. **Receipts Can Exist Without PO**
   - Walk-in purchases
   - Emergency buys
   - Found materials

4. **Partial Quantities Are Normal**
   - Order 100, receive 80
   - Vendor sends what they have
   - Substitutions happen

5. **Prices Can Change**
   - PO line has estimated cost
   - Receipt can have actual cost
   - Accounting reconciles later

## Frontend Actions by Status

### Draft
- ✏️ Edit (full modal)
- 📤 Submit for Approval
- 🗑️ Delete

### Awaiting Approval
- ✅ Approve
- ❌ Reject

### Approved
- 📧 Place Order (mark as placed, optionally send email)
- ❌ Cancel

### Placed/Acknowledged
- 📦 Receive Items (create receipt)
- ❌ Cancel

### Partially Received
- 📦 Receive More (create another receipt)
- 🔒 Close PO

### Fully Received
- 🔒 Close PO

### Closed/Cancelled
- 👁️ View Details Only

## Implementation Checklist

- [ ] Update frontend status labels
- [ ] Simplify status transitions
- [ ] Add "Place Order" button
- [ ] Build receiving UI/flow
- [ ] Show receipt history on PO detail
- [ ] Add "Close PO" action
- [ ] Remove any inventory updates from PO creation
- [ ] Ensure receipts create stock_movements
- [ ] Test partial receiving workflow
- [ ] Test closing a PO early
