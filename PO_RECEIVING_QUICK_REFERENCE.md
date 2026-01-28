# Purchase Order Receiving - Quick Reference

## 🚀 Quick Start

### Create a Receipt (Most Common Use Case)
```javascript
POST /api/supply-chain/receipts
{
  "receipt_number": "RCV-2026-001",
  "location_id": "uuid",
  "po_id": "uuid",
  "lines": [
    {
      "catalog_item_id": "uuid",
      "qty_received": 50,
      "po_line_id": "uuid",
      "condition_status": "accepted"  // accepted | damaged | quarantine | rejected
    }
  ]
}
```

---

## 📊 Key Concepts

### Receipt Status Flow
```
draft → confirmed → (cancelled)
  ↓         ↓
  └─────→ posted to inventory
```

### Condition Status
- **accepted** - Good condition, add to inventory
- **damaged** - Usable but flagged, add to inventory
- **quarantine** - Needs inspection, add to inventory with flag
- **rejected** - Not acceptable, DO NOT add to inventory

---

## 🔗 API Endpoints (Quick Reference)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/supply-chain/purchase-orders/receiving` | GET | List open POs |
| `/api/supply-chain/purchase-orders/{id}/receiving` | GET | PO detail + remaining qty |
| `/api/supply-chain/receipts` | POST | Create receipt |
| `/api/supply-chain/receipts/{id}` | GET | Receipt detail |
| `/api/supply-chain/receipts/{id}/confirm` | POST | Confirm draft |
| `/api/supply-chain/receipts/{id}/validate` | POST | Pre-flight check |
| `/api/supply-chain/receipts/{id}` | DELETE | Cancel receipt |

---

## 🔍 Common Queries (SQL)

### Get Open POs
```sql
SELECT * FROM supply_chain.rpc_get_open_pos_for_receiving();
```

### Get PO Detail with Remaining Quantities
```sql
SELECT * FROM supply_chain.rpc_get_po_receiving_detail('po-uuid');
```

### Check Stock Balance
```sql
SELECT qty_on_hand, qty_reserved, qty_available
FROM inventory.stock_balances
WHERE tenant_id = 'your-tenant-id'
  AND catalog_item_id = 'item-uuid'
  AND location_id = 'location-uuid';
```

### Check Receipt History for PO
```sql
SELECT * FROM supply_chain.rpc_get_po_receipt_history('po-uuid');
```

---

## ⚠️ Business Rules

### Receiving Rules
✅ **CAN:**
- Receive partial quantities (multiple deliveries)
- Receive more than ordered (if `allow_over_delivery=true`)
- Receive without PO (quick receive)
- Split lines to different locations
- Mark items as damaged/rejected/quarantine

❌ **CANNOT:**
- Receive more than ordered (if `allow_over_delivery=false`)
- Cancel confirmed receipts (use reverse function)
- Update confirmed receipts (immutable)
- Receive negative quantities

### Inventory Impact
| Condition | Inventory Impact |
|-----------|------------------|
| accepted | ✅ Added to qty_on_hand |
| damaged | ✅ Added to qty_on_hand (flagged) |
| quarantine | ✅ Added to qty_on_hand (flagged) |
| rejected | ❌ NOT added to inventory |

---

## 📝 Receipt Line Schema

### Required Fields
```javascript
{
  catalog_item_id: "uuid",     // REQUIRED
  qty_received: 10             // REQUIRED (> 0)
}
```

### Optional Fields
```javascript
{
  po_line_id: "uuid",                    // Links to PO line (null for quick receive)
  condition_status: "accepted",          // Default: accepted
  destination_location_id: "uuid",       // Override receipt location
  unit_cost_actual: 75.50,              // Actual cost (for variance)
  uom: "ton",                            // Unit of measure
  notes: "Pallet 1"                      // Line notes
}
```

---

## 🎯 Use Case Cheat Sheet

### Standard PO Receipt
```javascript
{
  receipt_number: "RCV-001",
  location_id: "yard-uuid",
  po_id: "po-uuid",
  packing_slip_no: "PS-12345",
  lines: [{ catalog_item_id, qty_received, po_line_id }]
}
```

### Quick Receive (No PO)
```javascript
{
  receipt_number: "RCV-002",
  location_id: "yard-uuid",
  po_id: null,                    // No PO
  vendor_id: "vendor-uuid",       // Required!
  source_type: "pickup",
  lines: [{ catalog_item_id, qty_received, unit_cost_actual }]
}
```

### Damaged Items
```javascript
{
  receipt_number: "RCV-003",
  location_id: "yard-uuid",
  po_id: "po-uuid",
  lines: [
    { catalog_item_id, qty_received: 90, condition_status: "accepted" },
    { catalog_item_id, qty_received: 10, condition_status: "damaged", notes: "Torn bags" }
  ]
}
```

### Rejected Items
```javascript
{
  receipt_number: "RCV-004",
  location_id: "yard-uuid",
  po_id: "po-uuid",
  lines: [
    { catalog_item_id, qty_received: 80, condition_status: "accepted" },
    { catalog_item_id, qty_received: 20, condition_status: "rejected", notes: "Wrong spec" }
  ]
}
```

### Draft Receipt (Review Before Posting)
```javascript
{
  receipt_number: "RCV-005",
  location_id: "yard-uuid",
  po_id: "po-uuid",
  status: "draft",        // Don't post yet
  auto_post: false,       // Manual confirm later
  lines: [...]
}

// Later: POST /receipts/{id}/confirm
```

### Split to Multiple Locations
```javascript
{
  receipt_number: "RCV-006",
  location_id: "main-yard-uuid",  // Default
  po_id: "po-uuid",
  lines: [
    { catalog_item_id, qty_received: 100, destination_location_id: "main-yard-uuid" },
    { catalog_item_id, qty_received: 50, destination_location_id: "satellite-yard-uuid" }
  ]
}
```

---

## 🐛 Debugging Tips

### Receipt Not Posting to Inventory?
```sql
-- Check receipt status
SELECT id, receipt_number, status FROM supply_chain.receipts WHERE id = 'receipt-uuid';
-- If status = 'draft', call confirm endpoint
```

### Cannot Receive More Than Ordered?
```sql
-- Check allow_over_delivery flag
SELECT allow_over_delivery FROM supply_chain.purchase_order_lines WHERE id = 'po-line-uuid';
-- If false, either update flag or reduce qty_received
```

### Duplicate Receipt Number Error?
```sql
-- Check existing receipts
SELECT id, receipt_number FROM supply_chain.receipts 
WHERE tenant_id = 'tenant-uuid' AND receipt_number = 'RCV-001';
-- Use unique numbers (consider auto-generating)
```

### Inventory Not Updating?
```sql
-- Check stock movements were created
SELECT * FROM inventory.stock_movements 
WHERE source_ref_type = 'receipt' AND source_ref_id = 'receipt-uuid';
-- Should have entries for all accepted/damaged/quarantine lines
```

### Check PO Status
```sql
-- View PO line details
SELECT line_number, qty_ordered, qty_received, status
FROM supply_chain.purchase_order_lines
WHERE po_id = 'po-uuid'
ORDER BY line_number;
```

---

## 🔐 Security Checklist

✅ Always filter by `tenant_id` from JWT  
✅ Never trust client-provided `tenant_id`  
✅ Use RLS policies (enabled by default)  
✅ Validate user permissions for sensitive operations  
✅ Log all receipt confirmations for audit trail

---

## 📚 Related Documentation

- **Full Implementation Guide:** [PO_RECEIVING_COMPLETE_IMPLEMENTATION.md](PO_RECEIVING_COMPLETE_IMPLEMENTATION.md)
- **Schema Audit:** [PO_RECEIVING_SCHEMA_AUDIT.md](PO_RECEIVING_SCHEMA_AUDIT.md)
- **Implementation Summary:** [PO_RECEIVING_IMPLEMENTATION_SUMMARY.md](PO_RECEIVING_IMPLEMENTATION_SUMMARY.md)
- **Test Suite:** [supabase/seed_receiving_tests.sql](supabase/seed_receiving_tests.sql)

---

**Last Updated:** January 28, 2026
