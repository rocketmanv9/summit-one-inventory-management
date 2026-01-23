# Supply Chain Schema Analysis & Implementation Roadmap

**Date:** January 23, 2026  
**Status:** ✅ Schema seeded with test data  
**Purpose:** Complete analysis of supply_chain schema tables and implementation recommendations

---

## 📊 Supply Chain Schema Overview

The `supply_chain` schema implements a complete **procurement-to-pay workflow** with vendor performance tracking. All tables are properly integrated with event-driven architecture and tenant isolation.

---

## 🗂️ Table Inventory & Current Usage

### **1. vendors** ✅ IMPLEMENTED
**Purpose:** Core vendor master data  
**Status:** CRUD UI implemented at `/inventory/vendors`  
**Seeded Data:** 4 vendors (3 active, 1 inactive)

**Key Columns:**
- `name`, `code` - Vendor identification (unique per tenant)
- `contact_name`, `contact_email`, `contact_phone` - Primary contact
- `payment_terms`, `lead_time_days` - Commercial terms
- `notes` - Free-form annotations
- `active` - Soft delete flag

**Relationships:**
- Referenced by `purchase_orders.vendor_location_id` (indirect via locations)
- Referenced by `vendor_items.vendor_id`
- Referenced by `vendor_performance_events.vendor_id`
- Referenced by `vendor_performance_metrics.vendor_id`
- Referenced by `accounting_expenses.vendor_id`
- Referenced by `catalog_items.preferred_vendor_id`

**Current Functionality:**
- ✅ Create/Edit/Delete vendors via UI
- ✅ Unique constraints on name and code per tenant
- ✅ Event emission for vendor lifecycle
- ✅ Soft delete support (active flag)

**Missing Functionality:**
- ⚠️ No vendor location tracking (addresses, warehouses)
- ⚠️ No vendor approval workflow
- ⚠️ No vendor tier/rating display in UI

---

### **2. vendor_items** ⚠️ PARTIAL IMPLEMENTATION
**Purpose:** Maps catalog items to vendors with pricing and lead times  
**Status:** Table exists, no UI  
**Seeded Data:** 5 mappings across 3 vendors

**Key Columns:**
- `catalog_item_id` - Links to inventory.catalog_items
- `vendor_id` - Which vendor supplies this item
- `vendor_sku` - Vendor's part number
- `vendor_uom`, `pack_size` - Vendor's packaging
- `is_preferred` - Preferred supplier flag
- `unit_cost`, `currency` - Pricing information
- `lead_time_days`, `min_order_qty` - Ordering constraints

**Relationships:**
- Links `supply_chain.vendors` ↔ `inventory.catalog_items`
- Used when creating purchase orders to get pricing

**Current Functionality:**
- ✅ Database constraints ensure one preferred vendor per item
- ✅ Soft delete via vendor CASCADE

**Missing Functionality:**
- ❌ **NO UI for managing vendor items**
- ❌ No price history tracking
- ❌ No bulk import/export
- ❌ No vendor catalog browsing

**Recommended Implementation:**
```
Priority: HIGH
Location: /inventory/vendor-items or as tab in /inventory/vendors/[id]
Features:
- Grid showing all items a vendor supplies
- Inline editing of pricing and lead times
- Mark preferred vendor
- Import vendor price lists (CSV)
- Price change history timeline
```

---

### **3. purchase_orders** ❌ NOT IMPLEMENTED
**Purpose:** Purchase order header records  
**Status:** Table exists with triggers, NO UI  
**Seeded Data:** 2 POs (1 partially received, 1 awaiting approval)

**Key Columns:**
- `po_number` - Unique PO identifier
- `vendor_location_id` - Which vendor (via location)
- `status` - Workflow state (draft → approved → received → closed)
- `order_date`, `expected_delivery_date` - Timeline tracking
- `delivery_location_id` - Where to receive items
- `notes` - Order instructions

**Valid Status Transitions:**
```
draft → awaiting_approval → approved → placed → acknowledged 
     → partially_received → fully_received → closed
     ↘ cancelled (from any state)
```

**Relationships:**
- Has many `purchase_order_lines`
- Referenced by `receipts.po_id`
- Tracked in `procurement_events`
- Tracked in `vendor_performance_events`

**Current Functionality:**
- ✅ Status validation triggers
- ✅ Event emission for status changes
- ✅ Vendor performance tracking

**Missing Functionality:**
- ❌ **NO UI for creating/managing POs**
- ❌ No approval workflow
- ❌ No PO PDF generation
- ❌ No email notifications to vendors

**Recommended Implementation:**
```
Priority: CRITICAL
Location: /inventory/purchase-orders
Pages Needed:
1. /inventory/purchase-orders - List view with filters
2. /inventory/purchase-orders/new - Create wizard
3. /inventory/purchase-orders/[id] - Detail/edit view
4. /inventory/purchase-orders/[id]/approve - Approval modal

Features:
- Multi-step wizard: Select vendor → Add items → Review → Submit
- Status badges with workflow visualization
- Inline approval (if user has permission)
- Generate PDF for vendor
- Email PO to vendor contact
- Bulk actions (approve multiple, cancel, etc.)
```

---

### **4. purchase_order_lines** ❌ NOT IMPLEMENTED
**Purpose:** Line items within purchase orders  
**Status:** Table exists with auto-status triggers, NO UI  
**Seeded Data:** 3 lines across 2 POs

**Key Columns:**
- `po_id`, `line_number` - PO reference and line sequence
- `catalog_item_id` - What to order
- `qty_ordered`, `qty_received` - Quantity tracking
- `unit_cost` - Price (copied from vendor_items or manual)
- `status` - Line-level status (open/partially_received/fully_received/cancelled)

**Triggers:**
- `update_po_line_status_trigger` - Auto-updates line status based on qty_received
- `update_po_status_trigger` - Cascades line status changes to PO header
- `validate_catalog_item_active_trigger` - Ensures item is not deleted

**Current Functionality:**
- ✅ Automatic status updates when receiving
- ✅ Quantity validation (received ≤ ordered)
- ✅ Cascading status to PO header

**Missing Functionality:**
- ❌ **NO UI** (embedded in PO UI)
- ❌ No line-level notes/tracking
- ❌ No partial cancel functionality

**Recommended Implementation:**
```
Embedded in: /inventory/purchase-orders/[id]
Display As: Editable grid within PO detail page
Features:
- Add/remove lines
- Auto-populate unit_cost from vendor_items
- Show qty_received progress bar
- Inline editing for quantities/prices
- Delete with confirmation
```

---

### **5. receipts** ❌ NOT IMPLEMENTED
**Purpose:** Physical goods receiving records  
**Status:** Table exists with triggers, NO UI  
**Seeded Data:** 1 receipt with 1 line

**Key Columns:**
- `receipt_number` - Unique receipt identifier
- `po_id` - Optional link to purchase order
- `received_at` - When goods arrived
- `received_by_user_id` - Who checked them in
- `location_id` - Where goods were received
- `notes` - Condition notes, packing slip info

**Relationships:**
- Has many `receipt_lines`
- Links to `purchase_orders` (optional - can receive without PO)
- Tracked in `vendor_performance_events` (on-time delivery tracking)

**Current Functionality:**
- ✅ Auto-matching expenses on receipt creation
- ✅ Vendor performance tracking (delivery timeliness)
- ✅ Event emission for downstream processing

**Missing Functionality:**
- ❌ **NO UI for receiving**
- ❌ No barcode scanning
- ❌ No photo attachment for damaged goods
- ❌ No discrepancy reporting

**Recommended Implementation:**
```
Priority: CRITICAL
Location: /inventory/receiving
Pages Needed:
1. /inventory/receiving - List of receipts
2. /inventory/receiving/new - Receive against PO
3. /inventory/receiving/blind - Blind receiving (no PO)
4. /inventory/receiving/[id] - Receipt detail

Features:
- Scan/type PO number to start receiving
- Show expected items with checkboxes
- Enter actual quantities received
- Flag discrepancies (over/under shipment)
- Photo upload for damaged items
- Print receiving label
- Update stock_balances automatically
```

---

### **6. receipt_lines** ❌ NOT IMPLEMENTED
**Purpose:** Individual items received  
**Status:** Table exists with triggers, NO UI  
**Seeded Data:** 1 line (30 units)

**Key Columns:**
- `receipt_id`, `line_number` - Receipt reference and sequence
- `po_line_id` - Optional link to PO line (if receiving against PO)
- `catalog_item_id` - What was received
- `qty_received` - Actual quantity received

**Triggers:**
- `trigger_receipt_line_events` - Emits events for inventory updates
- Auto-updates `purchase_order_lines.qty_received`

**Current Functionality:**
- ✅ Event-driven inventory updates
- ✅ PO line qty tracking

**Missing Functionality:**
- ❌ **NO UI** (embedded in receipt UI)
- ❌ No lot/serial number tracking
- ❌ No expiration date tracking

**Recommended Implementation:**
```
Embedded in: /inventory/receiving/new and /inventory/receiving/[id]
Display As: Grid showing items being received
Features:
- Expected vs Actual quantity columns
- Lot number / serial number entry
- Expiration date for perishables
- Quality inspection notes
- Accept/reject toggle
```

---

### **7. accounting_expenses** ⚠️ PARTIAL IMPLEMENTATION
**Purpose:** Invoice/expense tracking for 3-way matching  
**Status:** Table exists, NO UI  
**Seeded Data:** 1 expense record

**Key Columns:**
- `vendor_id`, `po_id` - Links to vendor and optionally PO
- `expense_date`, `amount`, `currency` - Financial details
- `status` - posted/matched/disputed/ignored
- `receipt_url`, `invoice_number` - Document tracking
- `description` - Expense description
- `matched_at` - When matched to receipt

**Purpose: 3-Way Matching**
1. **PO** - What was ordered
2. **Receipt** - What was received
3. **Invoice** - What vendor is billing

**Current Functionality:**
- ✅ Auto-matching on receipt creation
- ✅ Status tracking

**Missing Functionality:**
- ❌ **NO UI for expense entry**
- ❌ No OCR invoice scanning
- ❌ No matching workflow
- ❌ No dispute resolution workflow
- ❌ No integration with accounting systems

**Recommended Implementation:**
```
Priority: MEDIUM (accounts payable focus)
Location: /accounting/expenses or /supply-chain/invoices
Features:
- Upload invoice (PDF/image)
- OCR text extraction
- Auto-match to POs/receipts
- Discrepancy highlighting (price, quantity)
- Approve/dispute workflow
- Export to QuickBooks/Xero
```

---

### **8. vendor_performance_events** ✅ IMPLEMENTED (Backend)
**Purpose:** Event sourcing for vendor performance metrics  
**Status:** Events being recorded, NO UI  
**Seeded Data:** 3 events

**Event Types:**
- `po_created`, `po_cancelled` - Order lifecycle
- `delivery_on_time`, `delivery_late` - Delivery performance
- `items_received`, `items_rejected` - Quality tracking
- `invoice_paid`, `dispute_raised` - Payment tracking
- `quality_issue_reported` - Quality problems

**Current Functionality:**
- ✅ Automatic event recording via triggers
- ✅ On-time delivery calculation (days_late)
- ✅ Event metadata for drill-down

**Missing Functionality:**
- ❌ **NO UI to view event timeline**
- ❌ No manual event entry (for disputes, quality issues)
- ❌ No aggregation into metrics

**Recommended Implementation:**
```
Display In: Vendor detail page tabs
Features:
- Timeline view of all vendor interactions
- Filter by event type
- Manual event entry (disputes, quality issues)
- Export to CSV for analysis
```

---

### **9. vendor_performance_metrics** ⚠️ NEEDS IMPLEMENTATION
**Purpose:** Pre-aggregated vendor scorecards (monthly/quarterly)  
**Status:** Table exists, NO calculation logic, NO UI  
**Seeded Data:** None

**Key Metrics:**
- `total_pos_count`, `total_pos_value` - Order volume
- `cancelled_pos_count`, `cancelled_pos_value` - Reliability
- `on_time_deliveries`, `late_deliveries` - Timeliness
- `avg_lead_time_days` - Speed
- `total_items_received`, `rejected_items`, `defect_rate` - Quality
- `disputes_count`, `disputes_value` - Commercial issues
- `on_time_delivery_rate`, `quality_score`, `overall_rating` - KPIs

**Missing Functionality:**
- ❌ **NO aggregation job** (needs scheduled task)
- ❌ No calculation logic
- ❌ No UI to display metrics
- ❌ No trending/historical comparison

**Recommended Implementation:**
```
Priority: MEDIUM
Calculation: Cron job (nightly) or real-time from events

Algorithm:
1. Query vendor_performance_events for date range
2. Aggregate by event_type
3. Calculate derived metrics:
   - on_time_delivery_rate = on_time / (on_time + late)
   - defect_rate = rejected / received
   - overall_rating = weighted average of all scores
4. INSERT/UPDATE vendor_performance_metrics

UI Location: /inventory/vendors/[id]/performance
Display As:
- KPI cards (on-time %, quality score, etc.)
- Trend charts (monthly performance over time)
- Comparison to company average
- Drill-down to events
```

---

### **10. procurement_events** ✅ IMPLEMENTED (Backend)
**Purpose:** Event ledger for procurement workflow  
**Status:** Events being recorded, NO UI  
**Seeded Data:** 2 events

**Event Types:**
- `po_created`, `po_approved`, `po_cancelled`
- `items_received`, `invoice_matched`, `payment_made`

**Purpose:**
- Audit trail for procurement workflow
- Integration point for external systems
- Data source for reporting/analytics

**Current Functionality:**
- ✅ Event emission via triggers
- ✅ JSONB payload for flexibility
- ✅ Processing flag for external consumption

**Missing Functionality:**
- ❌ **NO UI to view event log**
- ❌ No webhook/integration publishing
- ❌ No event replay capability

**Recommended Implementation:**
```
Display In: Admin section or embedded in PO/receipt details
Features:
- Audit log view (chronological)
- Filter by event_type, date range
- JSON payload viewer
- Export for compliance
- Webhook configuration (send events to external URLs)
```

---

## 🚀 Implementation Priority Roadmap

### **Phase 1: Core Procurement (Critical - 2-3 weeks)**

1. **Purchase Orders UI** ⭐⭐⭐
   - `/inventory/purchase-orders` - List view
   - `/inventory/purchase-orders/new` - Creation wizard
   - `/inventory/purchase-orders/[id]` - Detail/edit
   - Status workflow, approval process
   - PDF generation and email

2. **Receiving UI** ⭐⭐⭐
   - `/inventory/receiving` - List view
   - `/inventory/receiving/new` - Receive against PO
   - `/inventory/receiving/blind` - Blind receiving
   - Automatic stock_balances updates
   - Discrepancy reporting

3. **Vendor Items Management** ⭐⭐
   - `/inventory/vendor-items` or tab in vendor detail
   - Pricing management
   - Preferred vendor selection
   - Price history

### **Phase 2: Vendor Performance (Medium - 1-2 weeks)**

4. **Vendor Performance Dashboard** ⭐⭐
   - Implement metrics calculation job
   - Display KPIs on vendor detail page
   - Trending charts
   - Comparison reporting

5. **Event Timeline Viewer** ⭐
   - Vendor event timeline
   - PO event timeline
   - Manual event entry for disputes

### **Phase 3: Financial Integration (Medium - 1-2 weeks)**

6. **Expense/Invoice Matching** ⭐
   - `/accounting/expenses` or `/supply-chain/invoices`
   - 3-way match workflow
   - Discrepancy resolution
   - Approval routing

7. **Reporting & Analytics** ⭐
   - Spend by vendor reports
   - PO cycle time metrics
   - Vendor comparison scorecards

---

## 🔧 Technical Implementation Notes

### **Auto-Update Stock on Receipt**

Currently missing - need to implement trigger or event handler:

```sql
-- Trigger to update stock_balances when receipt_line created
CREATE OR REPLACE FUNCTION supply_chain.update_stock_on_receipt()
RETURNS TRIGGER AS $$
DECLARE
    v_receipt_location_id UUID;
BEGIN
    -- Get receipt location
    SELECT location_id INTO v_receipt_location_id
    FROM supply_chain.receipts
    WHERE id = NEW.receipt_id;
    
    -- Update or insert stock balance
    INSERT INTO inventory.stock_balances (
        tenant_id, catalog_item_id, location_id,
        qty_on_hand, qty_available, last_event_id
    ) VALUES (
        NEW.tenant_id, NEW.catalog_item_id, v_receipt_location_id,
        NEW.qty_received, NEW.qty_received, NEW.last_event_id
    )
    ON CONFLICT (tenant_id, catalog_item_id, location_id)
    DO UPDATE SET
        qty_on_hand = stock_balances.qty_on_hand + EXCLUDED.qty_on_hand,
        qty_available = stock_balances.qty_available + EXCLUDED.qty_available,
        last_event_id = EXCLUDED.last_event_id,
        updated_at = NOW();
        
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### **Vendor Performance Calculation**

Implement as scheduled job (cron or pg_cron):

```typescript
// app/api/cron/calculate-vendor-metrics/route.ts
export async function GET(request: Request) {
  // Auth check for cron secret
  
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - 1);
  
  // Calculate metrics for all vendors
  // ... aggregation logic ...
  
  return Response.json({ success: true });
}
```

---

## 📋 Summary

### **What's Working:**
✅ Vendors CRUD UI  
✅ Database schema with proper relationships  
✅ Event-driven architecture  
✅ Vendor performance event recording  
✅ Automatic PO/receipt status updates  
✅ 3-way matching foundation  

### **What's Missing:**
❌ Purchase Order UI (CRITICAL)  
❌ Receiving UI (CRITICAL)  
❌ Vendor Items management  
❌ Vendor Performance metrics calculation  
❌ Expense/Invoice matching workflow  
❌ Stock updates on receipt  
❌ Reporting dashboards  

### **Next Immediate Steps:**
1. Build Purchase Orders page (`/inventory/purchase-orders`)
2. Build Receiving page (`/inventory/receiving`)
3. Implement stock update trigger on receipt
4. Add Vendor Items tab to vendor detail page
5. Build vendor performance calculation job
6. Display performance metrics on vendor page

---

**Total Tables:** 10  
**Implemented (UI):** 1 (vendors)  
**Partially Implemented:** 2 (vendor_items, accounting_expenses)  
**Backend Only:** 7 (POs, receipts, events, metrics)  

**Overall Completion:** ~10% (UI), ~80% (Database/Backend)

