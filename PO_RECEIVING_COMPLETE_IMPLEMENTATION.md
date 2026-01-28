# Purchase Order Receiving Implementation - Complete Guide

## Date: January 28, 2026

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Database Schema](#database-schema)
4. [API Endpoints](#api-endpoints)
5. [Workflow Examples](#workflow-examples)
6. [Testing Guide](#testing-guide)
7. [Deployment Steps](#deployment-steps)
8. [Troubleshooting](#troubleshooting)

---

## Executive Summary

The Purchase Order Receiving workflow is now **fully implemented** with the following capabilities:

✅ **Full Receiving Workflow**
- Receive items against POs with partial receipts
- Support for over-delivery (configurable)
- Line-by-line tracking with remaining quantities
- Quick receive (without PO)

✅ **Advanced Features**
- Damaged/rejected item handling
- Line-level location splitting
- Vendor packing slip and invoice tracking
- Draft/confirm workflow
- Receipt validation before posting

✅ **Multitenancy & Security**
- Full tenant isolation via RLS
- Idempotent operations (retry-safe)
- Atomic transactions (all-or-nothing)
- Complete audit trail

✅ **Event-Driven**
- Events emitted for all state changes
- Outbox pattern for reliability
- Integration-ready for downstream systems

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js)                        │
│  Receiving Page → API Routes → Edge Functions                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              API LAYER (Next.js API Routes)                  │
│                                                               │
│  /api/supply-chain/purchase-orders/receiving   GET           │
│  /api/supply-chain/purchase-orders/[id]/receiving  GET       │
│  /api/supply-chain/purchase-orders/[id]/receipts  GET        │
│  /api/supply-chain/receipts   GET, POST                      │
│  /api/supply-chain/receipts/[id]  GET, PATCH, DELETE         │
│  /api/supply-chain/receipts/[id]/confirm  POST               │
│  /api/supply-chain/receipts/[id]/validate  POST              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              RPC LAYER (PostgreSQL Functions)                │
│                                                               │
│  rpc_get_open_pos_for_receiving()                            │
│  rpc_get_po_receiving_detail()                               │
│  rpc_get_po_receipt_history()                                │
│  rpc_get_receipt_detail()                                    │
│  rpc_create_receipt_v2()                                     │
│  rpc_post_receipt_to_inventory_v2()                          │
│  rpc_confirm_receipt()                                       │
│  rpc_cancel_receipt()                                        │
│  rpc_validate_receipt()                                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                 DATABASE LAYER (Supabase)                    │
│                                                               │
│  supply_chain.receipts                                       │
│  supply_chain.receipt_lines                                  │
│  supply_chain.purchase_orders                                │
│  supply_chain.purchase_order_lines                           │
│  inventory.stock_balances                                    │
│  inventory.stock_movements (ledger)                          │
│  inventory.events_outbox                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### New/Enhanced Columns

#### `supply_chain.receipts`
```sql
-- New columns (added in migration 20260128000000)
status                TEXT NOT NULL DEFAULT 'confirmed'  -- draft | confirmed | cancelled
vendor_id             UUID                                -- FK to vendors (denormalized)
packing_slip_no       TEXT                                -- Vendor packing slip reference
vendor_invoice_no     TEXT                                -- Vendor invoice for matching
source_type           TEXT DEFAULT 'delivery'             -- delivery | pickup | transfer | return
```

#### `supply_chain.receipt_lines`
```sql
-- New columns (added in migration 20260128000000)
condition_status      TEXT NOT NULL DEFAULT 'accepted'   -- accepted | damaged | quarantine | rejected
destination_location_id UUID                              -- FK to locations (line-level override)
unit_cost_actual      NUMERIC(18,4)                       -- Actual cost from invoice
uom                   TEXT                                -- Unit of measure (denormalized)
notes                 TEXT                                -- Line-level notes
```

#### `supply_chain.purchase_order_lines`
```sql
-- New column (added in migration 20260128000000)
allow_over_delivery   BOOLEAN DEFAULT false              -- Allow qty_received > qty_ordered
```

### Key Relationships

```
purchase_orders (1) ──┬─> (N) purchase_order_lines
                      └─> (N) receipts

receipts (1) ──> (N) receipt_lines

receipt_lines (N) ──> (1) catalog_items
receipt_lines (N) ──> (1) locations (destination)
receipt_lines (N) ──> (0..1) purchase_order_lines

stock_movements (N) ──> (1) receipts (source_ref)
```

---

## API Endpoints

### 1. Get Open POs for Receiving

**GET** `/api/supply-chain/purchase-orders/receiving`

**Query Params:**
- `vendor_id` (optional): Filter by vendor
- `search` (optional): Search PO number or vendor name
- `limit` (optional): Max results (default: 50)

**Response:**
```json
{
  "data": [
    {
      "po_id": "uuid",
      "po_number": "PO-2026-001",
      "vendor_id": "uuid",
      "vendor_name": "ABC Supply",
      "order_date": "2026-01-15",
      "expected_delivery_date": "2026-01-30",
      "delivery_location_name": "Main Yard",
      "status": "placed",
      "total_lines": 5,
      "open_lines": 3,
      "partially_received_lines": 2,
      "fully_received_lines": 0,
      "total_ordered_value": 5000.00
    }
  ],
  "meta": { "count": 1, "tenantId": "uuid" }
}
```

---

### 2. Get PO Receiving Detail

**GET** `/api/supply-chain/purchase-orders/[id]/receiving`

**Response:**
```json
{
  "data": {
    "po_id": "uuid",
    "po_number": "PO-2026-001",
    "vendor_name": "ABC Supply",
    "status": "placed",
    "delivery_location_name": "Main Yard",
    "lines": [
      {
        "line_id": "uuid",
        "line_number": 1,
        "catalog_item_id": "uuid",
        "item_name": "Asphalt Mix",
        "item_sku": "ASP-001",
        "qty_ordered": 100,
        "qty_received": 50,
        "qty_remaining": 50,
        "unit_of_measure": "ton",
        "unit_cost": 75.00,
        "status": "partially_received"
      }
    ]
  }
}
```

---

### 3. Get Receipt History for PO

**GET** `/api/supply-chain/purchase-orders/[id]/receipts`

**Response:**
```json
{
  "data": [
    {
      "receipt_id": "uuid",
      "receipt_number": "RCV-2026-001",
      "received_at": "2026-01-20T10:30:00Z",
      "location_name": "Main Yard",
      "status": "confirmed",
      "total_lines": 2,
      "total_qty_received": 50,
      "packing_slip_no": "PS-12345"
    }
  ]
}
```

---

### 4. Create Receipt

**POST** `/api/supply-chain/receipts`

**Request Body:**
```json
{
  "receipt_number": "RCV-2026-002",
  "location_id": "uuid",
  "po_id": "uuid",  // Optional (for quick receive)
  "vendor_id": "uuid",  // Optional (auto-filled from PO)
  "received_at": "2026-01-28T14:00:00Z",
  "packing_slip_no": "PS-67890",
  "vendor_invoice_no": "INV-54321",
  "source_type": "delivery",
  "status": "confirmed",  // or "draft"
  "auto_post": true,  // Auto-post to inventory
  "notes": "Delivery at gate 2",
  "lines": [
    {
      "catalog_item_id": "uuid",
      "qty_received": 25,
      "po_line_id": "uuid",  // Optional (for quick receive)
      "condition_status": "accepted",  // accepted | damaged | quarantine | rejected
      "destination_location_id": "uuid",  // Optional (override receipt location)
      "unit_cost_actual": 76.50,  // Optional (if different from PO)
      "uom": "ton",
      "notes": "Pallet 1"
    }
  ]
}
```

**Response:**
```json
{
  "data": {
    "success": true,
    "receipt_id": "uuid",
    "receipt_number": "RCV-2026-002",
    "line_count": 1,
    "status": "confirmed",
    "posted_to_inventory": true,
    "post_result": {
      "posted_lines": 1,
      "rejected_lines": 0,
      "damaged_lines": 0
    }
  }
}
```

---

### 5. Get Receipt Detail

**GET** `/api/supply-chain/receipts/[id]`

**Response:**
```json
{
  "data": {
    "receipt_id": "uuid",
    "receipt_number": "RCV-2026-002",
    "po_number": "PO-2026-001",
    "vendor_name": "ABC Supply",
    "location_name": "Main Yard",
    "status": "confirmed",
    "received_at": "2026-01-28T14:00:00Z",
    "packing_slip_no": "PS-67890",
    "lines": [
      {
        "line_id": "uuid",
        "line_number": 1,
        "item_name": "Asphalt Mix",
        "qty_received": 25,
        "condition_status": "accepted",
        "destination_location_name": "Main Yard"
      }
    ]
  }
}
```

---

### 6. Confirm Receipt (Draft → Confirmed)

**POST** `/api/supply-chain/receipts/[id]/confirm`

**Response:**
```json
{
  "data": {
    "success": true,
    "receipt_id": "uuid",
    "posted_lines": 3,
    "rejected_lines": 0,
    "message": "Posted 3 lines to inventory"
  }
}
```

---

### 7. Validate Receipt

**POST** `/api/supply-chain/receipts/[id]/validate`

**Response:**
```json
{
  "data": {
    "valid": true,
    "errors": [],
    "warnings": ["1 line(s) would exceed ordered quantity"],
    "receipt_id": "uuid",
    "status": "draft",
    "line_count": 3
  }
}
```

---

### 8. Cancel Receipt

**DELETE** `/api/supply-chain/receipts/[id]?reason=Wrong%20delivery`

**Response:**
```json
{
  "data": {
    "success": true,
    "receipt_id": "uuid",
    "status": "cancelled",
    "message": "Receipt cancelled successfully"
  }
}
```

---

## Workflow Examples

### Workflow 1: Standard Receipt Against PO

```javascript
// 1. Get open POs
GET /api/supply-chain/purchase-orders/receiving

// 2. Select PO and get detail
GET /api/supply-chain/purchase-orders/{po_id}/receiving

// 3. Create receipt (auto-post to inventory)
POST /api/supply-chain/receipts
{
  "receipt_number": "RCV-2026-003",
  "location_id": "location-uuid",
  "po_id": "po-uuid",
  "lines": [
    {
      "catalog_item_id": "item-uuid",
      "qty_received": 50,
      "po_line_id": "po-line-uuid",
      "condition_status": "accepted"
    }
  ],
  "auto_post": true,
  "status": "confirmed"
}

// Result: Receipt created, inventory updated, PO line status updated
```

---

### Workflow 2: Partial Receipt with Damaged Items

```javascript
// 1. Create receipt with mixed condition
POST /api/supply-chain/receipts
{
  "receipt_number": "RCV-2026-004",
  "location_id": "location-uuid",
  "po_id": "po-uuid",
  "packing_slip_no": "PS-12345",
  "lines": [
    {
      "catalog_item_id": "item-uuid",
      "qty_received": 90,
      "po_line_id": "po-line-uuid",
      "condition_status": "accepted"
    },
    {
      "catalog_item_id": "item-uuid",
      "qty_received": 10,
      "po_line_id": "po-line-uuid",
      "condition_status": "damaged",
      "notes": "Torn bags - still usable"
    }
  ]
}

// Result:
// - 90 units added to inventory as "accepted"
// - 10 units added to inventory as "damaged" (flagged)
// - PO line shows 100 received out of 100 ordered
// - PO line status → fully_received
```

---

### Workflow 3: Over-Delivery

```javascript
// Setup: PO line has qty_ordered=100, allow_over_delivery=true

POST /api/supply-chain/receipts
{
  "receipt_number": "RCV-2026-005",
  "location_id": "location-uuid",
  "po_id": "po-uuid",
  "lines": [
    {
      "catalog_item_id": "item-uuid",
      "qty_received": 110,  // 10 more than ordered
      "po_line_id": "po-line-uuid",
      "condition_status": "accepted"
    }
  ]
}

// Result:
// - 110 units added to inventory
// - PO line qty_received = 110 (exceeds qty_ordered)
// - PO line status → fully_received
// - No error (because allow_over_delivery=true)
```

---

### Workflow 4: Rejected Items

```javascript
POST /api/supply-chain/receipts
{
  "receipt_number": "RCV-2026-006",
  "location_id": "location-uuid",
  "po_id": "po-uuid",
  "lines": [
    {
      "catalog_item_id": "item-uuid",
      "qty_received": 80,
      "po_line_id": "po-line-uuid",
      "condition_status": "accepted"
    },
    {
      "catalog_item_id": "item-uuid",
      "qty_received": 20,
      "po_line_id": "po-line-uuid",
      "condition_status": "rejected",
      "notes": "Wrong specification - returning to vendor"
    }
  ]
}

// Result:
// - 80 units added to inventory
// - 20 units NOT added to inventory (rejected)
// - Event logged for rejected items
// - PO line qty_received = 80 (not 100)
// - PO line status → partially_received
```

---

### Workflow 5: Quick Receive (No PO)

```javascript
// Scenario: Emergency purchase, no PO created

POST /api/supply-chain/receipts
{
  "receipt_number": "RCV-2026-007",
  "location_id": "location-uuid",
  "po_id": null,  // No PO
  "vendor_id": "vendor-uuid",  // Must specify vendor
  "source_type": "pickup",
  "notes": "Emergency purchase from ABC Supply",
  "lines": [
    {
      "catalog_item_id": "item-uuid",
      "qty_received": 10,
      "unit_cost_actual": 50.00,
      "uom": "bag",
      "condition_status": "accepted"
    }
  ]
}

// Result:
// - 10 units added to inventory
// - No PO line updates (no PO)
// - Vendor tracked for reporting
```

---

### Workflow 6: Draft → Review → Confirm

```javascript
// 1. Create draft receipt (don't post yet)
POST /api/supply-chain/receipts
{
  "receipt_number": "RCV-2026-008",
  "location_id": "location-uuid",
  "po_id": "po-uuid",
  "status": "draft",  // Save as draft
  "auto_post": false,  // Don't post to inventory yet
  "lines": [...]
}

// 2. Validate before confirming
POST /api/supply-chain/receipts/{receipt_id}/validate

// Response: { valid: true, errors: [], warnings: [] }

// 3. Confirm and post to inventory
POST /api/supply-chain/receipts/{receipt_id}/confirm

// Result: Receipt status → confirmed, inventory updated
```

---

### Workflow 7: Line-Level Location Splitting

```javascript
// Scenario: Delivery goes to multiple locations

POST /api/supply-chain/receipts
{
  "receipt_number": "RCV-2026-009",
  "location_id": "main-yard-uuid",  // Default location
  "po_id": "po-uuid",
  "lines": [
    {
      "catalog_item_id": "item-uuid",
      "qty_received": 50,
      "po_line_id": "po-line-uuid",
      "destination_location_id": "main-yard-uuid"  // Explicit
    },
    {
      "catalog_item_id": "item-uuid",
      "qty_received": 30,
      "po_line_id": "po-line-uuid",
      "destination_location_id": "satellite-yard-uuid"  // Different location!
    }
  ]
}

// Result:
// - 50 units added to Main Yard
// - 30 units added to Satellite Yard
// - Total 80 received against PO line
```

---

## Testing Guide

### Test Setup (SQL)

```sql
-- 1. Create test vendor
INSERT INTO supply_chain.vendors (tenant_id, name, code)
VALUES ('your-tenant-id', 'Test Vendor', 'TST-VEND')
RETURNING id;  -- Save vendor_id

-- 2. Create test location
INSERT INTO inventory.locations (tenant_id, name, code, location_type)
VALUES ('your-tenant-id', 'Test Yard', 'YARD-TEST', 'yard')
RETURNING id;  -- Save location_id

-- 3. Create test catalog item
INSERT INTO inventory.catalog_items (tenant_id, name, sku, unit_of_measure, item_type)
VALUES ('your-tenant-id', 'Test Asphalt', 'ASP-TEST', 'ton', 'fungible')
RETURNING id;  -- Save item_id

-- 4. Create test PO
INSERT INTO supply_chain.purchase_orders (
  tenant_id, po_number, vendor_id, order_date, delivery_location_id, status, last_event_id
)
VALUES (
  'your-tenant-id', 'PO-TEST-001', 'vendor-id', CURRENT_DATE, 'location-id', 'placed', 'test-po-event-1'
)
RETURNING id;  -- Save po_id

-- 5. Create test PO line
INSERT INTO supply_chain.purchase_order_lines (
  tenant_id, po_id, line_number, catalog_item_id, qty_ordered, unit_cost, allow_over_delivery, last_event_id
)
VALUES (
  'your-tenant-id', 'po-id', 1, 'item-id', 100, 75.00, true, 'test-pol-event-1'
)
RETURNING id;  -- Save po_line_id
```

### Test Cases (API)

#### Test 1: Full Delivery
```bash
curl -X POST http://localhost:3000/api/supply-chain/receipts \
  -H "Content-Type: application/json" \
  -d '{
    "receipt_number": "TEST-RCV-001",
    "location_id": "location-id",
    "po_id": "po-id",
    "lines": [{
      "catalog_item_id": "item-id",
      "qty_received": 100,
      "po_line_id": "po-line-id",
      "condition_status": "accepted"
    }]
  }'
```

**Expected:**
- ✅ Receipt created with status=confirmed
- ✅ Stock balance increased by 100
- ✅ PO line status → fully_received
- ✅ PO status → fully_received

#### Test 2: Partial Delivery
```bash
# First delivery: 60 units
curl -X POST http://localhost:3000/api/supply-chain/receipts \
  -H "Content-Type: application/json" \
  -d '{
    "receipt_number": "TEST-RCV-002",
    "location_id": "location-id",
    "po_id": "po-id",
    "lines": [{
      "catalog_item_id": "item-id",
      "qty_received": 60,
      "po_line_id": "po-line-id"
    }]
  }'

# Second delivery: 40 units
curl -X POST http://localhost:3000/api/supply-chain/receipts \
  -H "Content-Type: application/json" \
  -d '{
    "receipt_number": "TEST-RCV-003",
    "location_id": "location-id",
    "po_id": "po-id",
    "lines": [{
      "catalog_item_id": "item-id",
      "qty_received": 40,
      "po_line_id": "po-line-id"
    }]
  }'
```

**Expected:**
- ✅ After first: qty_received=60, status=partially_received
- ✅ After second: qty_received=100, status=fully_received

#### Test 3: Over-Delivery
```bash
curl -X POST http://localhost:3000/api/supply-chain/receipts \
  -H "Content-Type: application/json" \
  -d '{
    "receipt_number": "TEST-RCV-004",
    "location_id": "location-id",
    "po_id": "po-id",
    "lines": [{
      "catalog_item_id": "item-id",
      "qty_received": 110,
      "po_line_id": "po-line-id"
    }]
  }'
```

**Expected:**
- ✅ Receipt accepted (allow_over_delivery=true)
- ✅ Stock balance increased by 110
- ✅ PO line qty_received=110 (exceeds 100)

#### Test 4: Rejected Items
```bash
curl -X POST http://localhost:3000/api/supply-chain/receipts \
  -H "Content-Type: application/json" \
  -d '{
    "receipt_number": "TEST-RCV-005",
    "location_id": "location-id",
    "po_id": "po-id",
    "lines": [
      {
        "catalog_item_id": "item-id",
        "qty_received": 80,
        "po_line_id": "po-line-id",
        "condition_status": "accepted"
      },
      {
        "catalog_item_id": "item-id",
        "qty_received": 20,
        "po_line_id": "po-line-id",
        "condition_status": "rejected",
        "notes": "Wrong spec"
      }
    ]
  }'
```

**Expected:**
- ✅ Only 80 units added to inventory
- ✅ 20 units logged but not inventoried
- ✅ PO line qty_received=80

#### Test 5: Idempotency
```bash
# Send same request twice
for i in {1..2}; do
  curl -X POST http://localhost:3000/api/supply-chain/receipts \
    -H "Content-Type: application/json" \
    -d '{
      "receipt_number": "TEST-RCV-IDEM",
      "location_id": "location-id",
      "po_id": "po-id",
      "lines": [{
        "catalog_item_id": "item-id",
        "qty_received": 50,
        "po_line_id": "po-line-id"
      }]
    }'
done
```

**Expected:**
- ✅ First request: Success, receipt created
- ✅ Second request: Error 409 (duplicate receipt_number)
- ✅ Inventory only increased once

---

## Deployment Steps

### Step 1: Apply Migrations
```bash
cd supabase
npx supabase db push
```

**Migrations to apply:**
1. `20260128000000_enhance_receiving_workflow.sql` - Schema changes
2. `20260128000001_receiving_query_rpcs.sql` - Query RPCs
3. `20260128000002_enhanced_receipt_rpcs.sql` - Enhanced RPCs

### Step 2: Verify Schema
```sql
-- Check new columns exist
\d supply_chain.receipts
\d supply_chain.receipt_lines
\d supply_chain.purchase_order_lines

-- Check RPCs exist
\df supply_chain.rpc_*receipt*
```

### Step 3: Test RPCs Directly
```sql
-- Test get open POs
SELECT * FROM supply_chain.rpc_get_open_pos_for_receiving();

-- Test create receipt
SELECT supply_chain.rpc_create_receipt_v2(
  p_receipt_number := 'TEST-001',
  p_location_id := 'your-location-id',
  p_lines := '[{"catalog_item_id": "your-item-id", "qty_received": 10}]'::jsonb
);
```

### Step 4: Deploy API Routes
API routes are auto-deployed when you push to Next.js. No additional steps needed.

### Step 5: Smoke Test
```bash
# Test each endpoint
curl http://localhost:3000/api/supply-chain/purchase-orders/receiving
curl http://localhost:3000/api/supply-chain/receipts
```

---

## Troubleshooting

### Issue: Receipt creation fails with "duplicate key"
**Cause:** Receipt number already exists
**Fix:** Use unique receipt numbers per tenant

### Issue: Cannot receive more than ordered
**Cause:** `allow_over_delivery=false` on PO line
**Fix:** 
```sql
UPDATE supply_chain.purchase_order_lines
SET allow_over_delivery = true
WHERE id = 'po-line-id';
```

### Issue: Rejected items still adding to inventory
**Cause:** Old `rpc_post_receipt_to_inventory` function (not v2)
**Fix:** Ensure calling `rpc_post_receipt_to_inventory_v2`

### Issue: Receipt not posting to inventory
**Cause:** Status is 'draft' or auto_post=false
**Fix:** Call `/receipts/{id}/confirm` endpoint

### Issue: RLS blocking access
**Cause:** tenant_id mismatch or missing from JWT
**Fix:** Check auth headers:
```javascript
console.log(request.headers.get('x-tenant-id'));
```

---

## Summary

✅ **3 SQL Migrations** created and ready to deploy
✅ **9 RPCs** for complete receiving workflow
✅ **8 API Endpoints** for frontend integration
✅ **Full multitenancy** with RLS
✅ **Idempotent operations** for retry safety
✅ **Atomic transactions** for data integrity
✅ **Event-driven** for downstream integrations

**Ready for production deployment!**
