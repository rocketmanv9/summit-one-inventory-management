# Purchase Order Quick Reference

## Status Workflow

```
draft 
  ↓ [Submit for Approval]
awaiting_approval
  ↓ [Approve] or [Reject→cancelled]
approved
  ↓ [Place Order]
placed
  ↓ [Receive Items]
partially_received ←─┐
  ↓                  │ [Receive More Items]
fully_received ──────┘
  ↓ [Close PO]
closed
```

## Key Endpoints

### Purchase Orders
- `GET /api/inventory/purchasing` - List POs (filter by status)
- `POST /api/inventory/purchasing` - Create PO
- `GET /api/inventory/purchasing/:id` - Get PO details
- `PUT /api/inventory/purchasing/:id` - Update PO (draft only)
- `PATCH /api/inventory/purchasing/:id` - Update status

### Receiving
- `GET /api/inventory/receiving?po_id=xxx` - List receipts (filter by PO)
- `POST /api/inventory/receiving` - Create receipt (receives items)

### Supporting
- `GET /api/inventory/vendors` - List vendors
- `GET /api/inventory/vendors/:id/items` - Get vendor-specific items
- `GET /api/inventory/locations` - List locations

## Creating a Receipt (Receiving Items)

```typescript
POST /api/inventory/receiving
{
  "purchase_order_id": "uuid",  // optional - can receive without PO
  "location_id": "uuid",         // required
  "notes": "string",             // optional
  "lines": [
    {
      "purchase_order_line_id": "uuid",  // optional
      "catalog_item_id": "uuid",         // required
      "qty_received": 10                 // required
    }
  ]
}
```

**What Happens**:
1. Receipt header created
2. Receipt lines created
3. `rpc_post_receipt_to_inventory()` called → Creates:
   - `inventory_events` (audit)
   - `stock_movements` (ledger)
   - `stock_balances` (totals)
4. PO line `qty_received` updated
5. PO line status updated (partially/fully received)
6. PO status updated based on all lines

## Checking Inventory After Receiving

```sql
-- Stock movements (ledger)
SELECT 
  sm.occurred_at,
  ci.name as item,
  l.name as location,
  sm.quantity_delta,
  sm.source_ref_type,
  sm.notes
FROM inventory.stock_movements sm
JOIN inventory.catalog_items ci ON sm.catalog_item_id = ci.id
JOIN inventory.locations l ON sm.location_id = l.id
WHERE sm.movement_type = 'received'
ORDER BY sm.occurred_at DESC;

-- Stock balances (current totals)
SELECT 
  ci.name as item,
  l.name as location,
  sb.qty_on_hand,
  sb.qty_reserved,
  sb.qty_available
FROM inventory.stock_balances sb
JOIN inventory.catalog_items ci ON sb.catalog_item_id = ci.id
JOIN inventory.locations l ON sb.location_id = l.id
WHERE sb.tenant_id = 'YOUR_TENANT_ID'
ORDER BY ci.name, l.name;
```

## Common Operations

### 1. Create PO for New Vendor Order
1. Go to `/inventory/purchasing`
2. Click "+ Create PO"
3. Select vendor → Items auto-filter
4. Select ship-to location
5. Add line items (unit cost auto-populates)
6. Submit
7. Status: `draft`

### 2. Submit for Approval
1. Open PO detail panel
2. Click "Submit for Approval"
3. Status: `awaiting_approval`

### 3. Approve PO
1. Open PO detail panel
2. Click "Approve PO"
3. Status: `approved`

### 4. Place Order (Send to Vendor)
1. Open PO detail panel
2. Click "Place Order"
3. Status: `placed`
4. (Optionally: print, email, or fax to vendor)

### 5. Receive Items (Partial or Full)
1. Open PO detail panel
2. Click "Receive Items" → Redirects to receiving page
3. Select location from dropdown
4. Enter quantities received (can be less than ordered)
5. Click "Complete Receipt"
6. Status: `partially_received` (or `fully_received` if all items received)
7. **Inventory updated immediately**

### 6. Receive More Items
1. Repeat Step 5
2. Each receipt is separate
3. All receipts show in PO detail panel
4. PO status updates automatically

### 7. Close PO
1. Open PO detail panel
2. Click "Close PO"
3. Status: `closed`
4. No more actions available

## Troubleshooting

### Receipt Not Creating Stock Movements
```sql
-- Check if rpc_post_receipt_to_inventory exists
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_schema = 'supply_chain' 
AND routine_name = 'rpc_post_receipt_to_inventory';

-- Check receipt was created
SELECT * FROM supply_chain.receipts 
WHERE id = 'YOUR_RECEIPT_ID';

-- Check receipt lines
SELECT * FROM supply_chain.receipt_lines 
WHERE receipt_id = 'YOUR_RECEIPT_ID';

-- Check if stock_movements created
SELECT * FROM inventory.stock_movements 
WHERE source_ref_id = 'YOUR_RECEIPT_ID'
AND source_ref_type = 'receipt';
```

### PO Status Not Updating
```sql
-- Check PO line statuses
SELECT 
  id, 
  catalog_item_id, 
  qty_ordered, 
  qty_received, 
  status 
FROM supply_chain.purchase_order_lines 
WHERE purchase_order_id = 'YOUR_PO_ID';

-- If qty_received >= qty_ordered, status should be 'fully_received'
-- If qty_received > 0 and < qty_ordered, status should be 'partially_received'
```

### Location Dropdown Empty
```sql
-- Check locations exist
SELECT id, name, location_type 
FROM inventory.locations 
WHERE tenant_id = 'YOUR_TENANT_ID';
```

## Important Notes

1. **PO does NOT change inventory** - Only receipts do
2. **Always use the receiving UI** - Don't manually insert stock_movements
3. **Partial receiving is normal** - One PO can have many receipts
4. **Receipts can exist without PO** - For walk-in purchases or emergency buys
5. **Inventory updates are atomic** - Via `rpc_post_receipt_to_inventory()`
6. **Each receipt has unique receipt_number** - Auto-generated
7. **Status transitions are one-way** - Can't go backwards (except cancelled→draft)

## Related Files

- `PO_RECEIVING_IMPLEMENTATION_COMPLETE.md` - Full implementation details
- `PO_WORKFLOW_IMPLEMENTATION.md` - Original workflow documentation
- `PO_RECEIVING_FIXES.md` - Problem analysis
