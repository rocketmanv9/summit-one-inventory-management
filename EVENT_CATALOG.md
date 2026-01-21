# Event Catalog

## Complete Event Registry for Summit One Inventory Management

**Last Updated:** January 21, 2026  
**Status:** ✅ Aligned with Bounded Context Architecture  
**Total Active Events:** 46  
**Deprecated Events:** 13

---

## 📋 Table of Contents

1. [Event Naming Convention](#event-naming-convention)
2. [Bounded Context Separation](#bounded-context-separation)
3. [Supply Chain Events](#supply-chain-events) (12 events)
4. [Inventory Events](#inventory-events) (34 events)
5. [Deprecated Events](#deprecated-events) (13 events)
6. [Event Emission Guide](#event-emission-guide)
7. [Event Consumer Integration](#event-consumer-integration)

---

## Event Naming Convention

All events follow the pattern:
```
<bounded_context>.<entity>.<action>
```

**Examples:**
- `supply_chain.purchase_order.created`
- `inventory.stock.issued`
- `inventory.asset.assigned`

### Bounded Context Prefixes

| Prefix | Schema | Description |
|--------|--------|-------------|
| `supply_chain.*` | `supply_chain` | Procurement documents (vendors, POs, receipts) |
| `inventory.*` | `inventory` | Stock state, movements, assets, reservations |
| Others | Various | Catalog items, locations, categories, etc. |

---

## Bounded Context Separation

After the **January 21, 2026 migration**, events are now properly aligned with the DDD bounded contexts:

### **Supply Chain Bounded Context**
- **Tables:** `vendors`, `purchase_orders`, `receipts`, `vendor_performance_metrics`
- **Responsibilities:** Procurement workflow, vendor management
- **Events:** All prefixed with `supply_chain.*`
- **Producer:** `supply_chain` schema functions/triggers

### **Inventory Bounded Context**
- **Tables:** `catalog_items`, `locations`, `stock_balances`, `inventory_events`, `assets`, `reservations`, `transfers`
- **Responsibilities:** Stock tracking, movements, asset management
- **Events:** Prefixed with `inventory.*` or entity-specific (e.g., `stock.*`, `asset.*`)
- **Producer:** `inventory` schema functions/triggers

### **The Bridge** 🌉
**ONE atomic RPC:** `supply_chain.rpc_post_receipt_to_inventory()`
- Only way to post receipts from supply_chain to inventory
- Emits `supply_chain.receipt.posted` on success
- Creates `inventory_events` and `stock_movements` atomically

---

## Supply Chain Events

### Vendor Events (2 events)

#### `supply_chain.vendor.created`
**Producer:** `supply_chain`  
**Trigger:** INSERT on `supply_chain.vendors`  
**Description:** New vendor added to system

**Payload:**
```json
{
  "vendor_id": "uuid",
  "vendor_name": "string",
  "vendor_code": "string",
  "tenant_id": "uuid",
  "created_at": "timestamp"
}
```

**When Emitted:**
- New vendor record created in supply_chain.vendors table
- Triggered automatically by database trigger

**Consumers:**
- Core System: Update vendor directory
- Analytics: Track vendor onboarding
- Notifications: Welcome email to vendor

---

#### `supply_chain.vendor.updated`
**Producer:** `supply_chain`  
**Trigger:** UPDATE on `supply_chain.vendors`  
**Description:** Vendor information updated

**Payload:**
```json
{
  "vendor_id": "uuid",
  "changes": {
    "old": { ... },
    "new": { ... }
  },
  "tenant_id": "uuid",
  "updated_at": "timestamp"
}
```

**When Emitted:**
- Any update to vendor record (name, contact, terms, etc.)

**Consumers:**
- Core System: Sync vendor data
- Analytics: Track vendor data changes
- Audit: Log modifications

---

### Purchase Order Events (7 events)

#### `supply_chain.purchase_order.created`
**Producer:** `supply_chain`  
**Trigger:** INSERT on `supply_chain.purchase_orders`  
**Description:** New purchase order created

**Payload:**
```json
{
  "po_id": "uuid",
  "po_number": "string",
  "vendor_id": "uuid",
  "order_date": "date",
  "expected_delivery_date": "date",
  "line_items_count": "integer",
  "total_value": "number",
  "tenant_id": "uuid",
  "created_at": "timestamp"
}
```

**When Emitted:**
- Via `supply_chain.rpc_create_purchase_order()` RPC
- Status: `draft`

**Consumers:**
- Core System: Update PO registry
- Purchasing Dashboard: Show new PO
- Analytics: Track procurement activity

---

#### `supply_chain.purchase_order.submitted`
**Producer:** `supply_chain`  
**Trigger:** UPDATE status to `submitted`  
**Description:** Purchase order submitted to vendor

**Payload:**
```json
{
  "po_id": "uuid",
  "po_number": "string",
  "tenant_id": "uuid",
  "submitted_at": "timestamp"
}
```

**When Emitted:**
- User marks PO as submitted
- Status: `draft` → `submitted`

**Consumers:**
- Email Service: Send PO to vendor
- Core System: Update status
- Notifications: Alert purchasing team

---

#### `supply_chain.purchase_order.approved`
**Producer:** `supply_chain`  
**Trigger:** UPDATE status to `approved`  
**Description:** Purchase order approved for sending to vendor

**Payload:**
```json
{
  "po_id": "uuid",
  "po_number": "string",
  "approved_by_user_id": "uuid",
  "tenant_id": "uuid",
  "approved_at": "timestamp"
}
```

**When Emitted:**
- Manager approves PO
- Status: `submitted` → `approved`

**Consumers:**
- Email Service: Send approved PO to vendor
- Core System: Release hold on PO
- Notifications: Alert requestor

---

#### `supply_chain.purchase_order.in_transit`
**Producer:** `supply_chain`  
**Trigger:** UPDATE status to `in_transit`  
**Description:** Purchase order shipment is in transit from vendor

**Payload:**
```json
{
  "po_id": "uuid",
  "po_number": "string",
  "vendor_id": "uuid",
  "tenant_id": "uuid",
  "shipped_at": "timestamp"
}
```

**When Emitted:**
- Vendor marks shipment as shipped
- Status: `approved` → `in_transit`

**Consumers:**
- Receiving: Prepare for receipt
- Tracking: Monitor expected arrival
- Notifications: Alert warehouse

---

#### `supply_chain.purchase_order.received`
**Producer:** `supply_chain`  
**Trigger:** UPDATE status to `received` (when all lines received)  
**Description:** All items on purchase order have been received

**Payload:**
```json
{
  "po_id": "uuid",
  "po_number": "string",
  "total_lines": "integer",
  "tenant_id": "uuid",
  "received_at": "timestamp"
}
```

**When Emitted:**
- Last receipt line closes PO
- Status: `in_transit` → `received`

**Consumers:**
- Purchasing: Close PO workflow
- Analytics: Track lead time
- Vendor Performance: Update metrics

---

#### `supply_chain.purchase_order.cancelled`
**Producer:** `supply_chain`  
**Trigger:** UPDATE status to `cancelled`  
**Description:** Purchase order cancelled before fulfillment

**Payload:**
```json
{
  "po_id": "uuid",
  "po_number": "string",
  "reason": "string",
  "tenant_id": "uuid",
  "cancelled_at": "timestamp"
}
```

**When Emitted:**
- User cancels PO
- Status: any → `cancelled`

**Consumers:**
- Email Service: Notify vendor
- Core System: Release commitments
- Analytics: Track cancellation reasons

---

#### `supply_chain.purchase_order.closed`
**Producer:** `supply_chain`  
**Trigger:** UPDATE status to `closed`  
**Description:** Purchase order administratively closed

**Payload:**
```json
{
  "po_id": "uuid",
  "po_number": "string",
  "total_lines": "integer",
  "tenant_id": "uuid",
  "closed_at": "timestamp"
}
```

**When Emitted:**
- User manually closes PO
- Used for partial receipts or admin closure

**Consumers:**
- Purchasing: Archive PO
- Analytics: Track completion
- Audit: Log closure

---

### Receipt Events (3 events)

#### `supply_chain.receipt.created`
**Producer:** `supply_chain`  
**Trigger:** INSERT on `supply_chain.receipts`  
**Description:** New receipt document created (goods receiving)

**Payload:**
```json
{
  "receipt_id": "uuid",
  "receipt_number": "string",
  "location_id": "uuid",
  "po_id": "uuid",
  "received_by_user_id": "uuid",
  "tenant_id": "uuid",
  "received_at": "timestamp"
}
```

**When Emitted:**
- Via `supply_chain.rpc_create_receipt()` RPC
- Initial receipt document creation

**Consumers:**
- Warehouse: Show new receipt
- Core System: Track receiving activity

---

#### `supply_chain.receipt.line_added`
**Producer:** `supply_chain`  
**Trigger:** INSERT on `supply_chain.receipt_lines`  
**Description:** Line item added to receipt

**Payload:**
```json
{
  "receipt_id": "uuid",
  "line_id": "uuid",
  "catalog_item_id": "uuid",
  "qty_received": "number",
  "po_line_id": "uuid",
  "tenant_id": "uuid",
  "created_at": "timestamp"
}
```

**When Emitted:**
- Each item added to receipt
- Multiple events per receipt

**Consumers:**
- Warehouse: Update receiving screen
- Analytics: Track item receipts

---

#### `supply_chain.receipt.posted`
**Producer:** `supply_chain`  
**Trigger:** `rpc_post_receipt_to_inventory()` success  
**Description:** Receipt posted to inventory (via atomic bridge)

**Payload:**
```json
{
  "receipt_id": "uuid",
  "receipt_number": "string",
  "location_id": "uuid",
  "total_lines": "integer",
  "total_qty": "number",
  "posted_by_user_id": "uuid",
  "tenant_id": "uuid",
  "posted_at": "timestamp"
}
```

**When Emitted:**
- After successful atomic bridge execution
- Creates inventory_events + stock_movements
- **THIS IS THE BRIDGE EVENT** 🌉

**Consumers:**
- Inventory: Refresh balances
- Warehouse: Close receipt
- Analytics: Track throughput

---

## Inventory Events

### Catalog Item Events (4 events)

#### `inventory.item.created`
**Producer:** `inventory`  
**Trigger:** INSERT on `inventory.catalog_items`  
**Description:** New catalog item (SKU) created

**Payload:**
```json
{
  "item_id": "uuid",
  "sku": "string",
  "name": "string",
  "tenant_id": "uuid",
  "created_at": "timestamp"
}
```

---

#### `catalog_item.updated`
**Producer:** `inventory`  
**Trigger:** UPDATE on `inventory.catalog_items`  
**Description:** Catalog item details updated

---

#### `catalog_item.deactivated`
**Producer:** `inventory`  
**Trigger:** UPDATE active = false  
**Description:** Catalog item marked as inactive

---

#### `catalog_item.reactivated`
**Producer:** `inventory`  
**Trigger:** UPDATE active = true  
**Description:** Catalog item marked as active again

---

### Location Events (3 events)

#### `location.created`
**Producer:** `inventory`  
**Trigger:** INSERT on `inventory.locations`  
**Description:** New location created (yard, warehouse, truck, job, etc.)

---

#### `location.updated`
**Producer:** `inventory`  
**Trigger:** UPDATE on `inventory.locations`  
**Description:** Location details updated

---

#### `location.deactivated`
**Producer:** `inventory`  
**Trigger:** UPDATE active = false  
**Description:** Location marked as inactive

---

### Stock Movement Events (5 events)

#### `stock.replenished`
**Producer:** `inventory`  
**Description:** Stock replenishment from supplier or transfer

**When Emitted:**
- After receipt posted to inventory
- After transfer completed

---

#### `stock.issued`
**Producer:** `inventory`  
**Trigger:** `rpc_issue_inventory()` success  
**Description:** Stock issued to job, truck, or person

**Payload:**
```json
{
  "movement_id": "uuid",
  "item_id": "uuid",
  "from_location_id": "uuid",
  "to_location_id": "uuid",
  "quantity": "number",
  "issued_to": "string",
  "tenant_id": "uuid",
  "occurred_at": "timestamp"
}
```

---

#### `stock.returned`
**Producer:** `inventory`  
**Description:** Stock returned from job, truck, or person

---

#### `stock.low_threshold_reached`
**Producer:** `inventory`  
**Trigger:** Automatic check after stock decrease  
**Description:** Stock level dropped below reorder point

**Payload:**
```json
{
  "item_id": "uuid",
  "location_id": "uuid",
  "current_qty": "number",
  "reorder_point": "number",
  "reorder_qty": "number",
  "tenant_id": "uuid",
  "detected_at": "timestamp"
}
```

**Consumers:**
- Purchasing: Auto-create PO requisition
- Alerts: Notify warehouse manager
- Dashboard: Show low stock warning

---

#### `stock.out_of_stock`
**Producer:** `inventory`  
**Description:** Item completely out of stock at location

**Consumers:**
- Alerts: Critical notification
- Reservations: Block new reservations
- Dashboard: Show stockout alert

---

### Transfer Events (3 events)

#### `transfer.created`
**Producer:** `inventory`  
**Trigger:** `rpc_create_transfer()` success  
**Description:** Inventory transfer created in draft status

---

#### `transfer.completed`
**Producer:** `inventory`  
**Trigger:** `rpc_complete_transfer()` success  
**Description:** Inventory transfer completed - goods moved

**Payload:**
```json
{
  "transfer_id": "uuid",
  "transfer_number": "string",
  "from_location_id": "uuid",
  "to_location_id": "uuid",
  "total_items": "integer",
  "tenant_id": "uuid",
  "completed_at": "timestamp"
}
```

---

#### `transfer.cancelled`
**Producer:** `inventory`  
**Description:** Inventory transfer cancelled

---

### Reservation Events (3 events)

#### `reservation.created`
**Producer:** `inventory`  
**Trigger:** `rpc_create_reservation()` success  
**Description:** Inventory reservation created

**Payload:**
```json
{
  "reservation_id": "uuid",
  "item_id": "uuid",
  "location_id": "uuid",
  "quantity": "number",
  "job_ref": "string",
  "tenant_id": "uuid",
  "created_at": "timestamp"
}
```

---

#### `reservation.fulfilled`
**Producer:** `inventory`  
**Description:** Inventory reservation fulfilled (stock issued)

---

#### `reservation.cancelled`
**Producer:** `inventory`  
**Description:** Inventory reservation cancelled

---

### Asset Events (5 events)

#### `asset.created`
**Producer:** `inventory`  
**Trigger:** INSERT on `inventory.assets`  
**Description:** New asset created with serial/VIN

---

#### `asset.assigned`
**Producer:** `inventory`  
**Trigger:** `rpc_assign_asset()` success  
**Description:** Asset assigned to employee/vehicle/job

**Payload:**
```json
{
  "asset_id": "uuid",
  "asset_tag": "string",
  "assigned_to_type": "employee|vehicle|job",
  "assigned_to_id": "uuid",
  "tenant_id": "uuid",
  "assigned_at": "timestamp"
}
```

---

#### `asset.returned`
**Producer:** `inventory`  
**Description:** Asset returned from assignment

---

#### `asset.updated`
**Producer:** `inventory`  
**Description:** Asset details updated

---

#### `asset.retired`
**Producer:** `inventory`  
**Description:** Asset retired from service

---

### Cycle Count Events (4 events)

#### `cycle_count.started`
**Producer:** `inventory`  
**Description:** Cycle count initiated

---

#### `cycle_count.line_counted`
**Producer:** `inventory`  
**Description:** Individual line item counted in cycle count

**Payload:**
```json
{
  "cycle_count_id": "uuid",
  "line_id": "uuid",
  "item_id": "uuid",
  "location_id": "uuid",
  "expected_qty": "number",
  "actual_qty": "number",
  "variance_qty": "number",
  "tenant_id": "uuid",
  "counted_at": "timestamp"
}
```

---

#### `cycle_count.approved`
**Producer:** `inventory`  
**Description:** Cycle count approved for posting

---

#### `cycle_count.posted`
**Producer:** `inventory`  
**Description:** Cycle count adjustments posted to ledger

---

#### `cycle_count.cancelled`
**Producer:** `inventory`  
**Description:** Cycle count cancelled

---

#### `inventory.cycle_count.discrepancy`
**Producer:** `trigger_cycle_count_events`  
**Description:** Emitted when a cycle count reveals a discrepancy

---

### Adjustment Events (2 events)

#### `adjustment.created`
**Producer:** `inventory`  
**Trigger:** `rpc_adjust_inventory()` called  
**Description:** Manual inventory adjustment initiated

**Payload:**
```json
{
  "adjustment_id": "uuid",
  "item_id": "uuid",
  "location_id": "uuid",
  "quantity_change": "number",
  "reason": "damage|loss|found|correction|obsolete",
  "notes": "string",
  "created_by_user_id": "uuid",
  "tenant_id": "uuid",
  "created_at": "timestamp"
}
```

---

#### `adjustment.approved`
**Producer:** `inventory`  
**Description:** Inventory adjustment approved and posted

---

### Category Events (2 events)

#### `category.created`
**Producer:** `inventory`  
**Description:** New item category created

---

#### `category.updated`
**Producer:** `inventory`  
**Description:** Item category name/details updated

---

### System Events (1 event)

#### `inventory.stock.adjusted`
**Producer:** `trigger_stock_movement_events`  
**Description:** Emitted when stock levels change (adjustment, sale, receipt)

---

## Deprecated Events

The following events were **deprecated on January 21, 2026** after bounded context separation:

| Old Event Name | Replacement | Reason |
|----------------|-------------|--------|
| `vendor.created` | `supply_chain.vendor.created` | Schema separation |
| `vendor.updated` | `supply_chain.vendor.updated` | Schema separation |
| `purchase_order.created` | `supply_chain.purchase_order.created` | Schema separation |
| `purchase_order.submitted` | `supply_chain.purchase_order.submitted` | Schema separation |
| `purchase_order.approved` | `supply_chain.purchase_order.approved` | Schema separation |
| `purchase_order.cancelled` | `supply_chain.purchase_order.cancelled` | Schema separation |
| `purchase_order.closed` | `supply_chain.purchase_order.closed` | Schema separation |
| `receipt.line_added` | `supply_chain.receipt.line_added` | Schema separation |
| `receipt.completed` | `supply_chain.receipt.posted` | Schema separation + clarity |
| `inventory.po.placed` | `supply_chain.purchase_order.in_transit` | Naming convention |
| `inventory.po.cancelled` | `supply_chain.purchase_order.cancelled` | Naming convention |
| `inventory.po.received` | `supply_chain.purchase_order.received` | Naming convention |
| `inventory.receipt.created` | `supply_chain.receipt.created` | Schema separation |

**Migration Path:**
- Old events still in database with `status = 'deprecated'`
- Triggers updated to emit new event names
- Frontend should subscribe to new events
- Old event consumers should be updated within 90 days

---

## Event Emission Guide

### How Events Are Emitted

Events are emitted via the `public.emit_event()` function:

```sql
PERFORM public.emit_event(
    p_event_name TEXT,    -- e.g., 'supply_chain.vendor.created'
    p_payload JSONB,      -- Event data
    p_tenant_id UUID      -- Multi-tenant isolation
);
```

### Event Flow

1. **Trigger Fires** (on INSERT/UPDATE/DELETE)
2. **Trigger Function** builds payload
3. **emit_event()** called
4. **Event Written** to `inventory.events_outbox`
5. **Event Published** to external systems (optional)

### Example: Purchase Order Created

```sql
-- Triggered by: supply_chain.purchase_orders INSERT
CREATE TRIGGER trigger_po_status_events
    AFTER INSERT OR UPDATE ON supply_chain.purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION supply_chain.emit_po_status_event();

-- Function emits event:
PERFORM public.emit_event(
    'supply_chain.purchase_order.created',
    jsonb_build_object(
        'po_id', NEW.id,
        'po_number', NEW.po_number,
        'vendor_id', NEW.vendor_location_id,
        'tenant_id', NEW.tenant_id
    ),
    NEW.tenant_id
);
```

---

## Event Consumer Integration

### Frontend Integration

**Using Supabase Realtime:**

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(url, key);

// Subscribe to supply_chain events
const subscription = supabase
  .channel('supply_chain_events')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'inventory',
      table: 'events_outbox',
      filter: `event_name=like.supply_chain.%`
    },
    (payload) => {
      console.log('Supply chain event:', payload);
      // Update UI, refresh data, show notifications
    }
  )
  .subscribe();
```

**Example: Low Stock Alert Widget**

```typescript
supabase
  .channel('stock_alerts')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'inventory',
      table: 'events_outbox',
      filter: 'event_name=eq.stock.low_threshold_reached'
    },
    (payload) => {
      const data = payload.new.payload;
      showNotification({
        type: 'warning',
        title: 'Low Stock Alert',
        message: `${data.item_name} at ${data.location_name} is below reorder point`
      });
    }
  )
  .subscribe();
```

### External System Integration

**Webhook Configuration:**

1. Register webhook in `public.event_consumers` table
2. Event outbox processor sends HTTP POST to webhook URL
3. Retry logic with exponential backoff

**Example Webhook Payload:**

```json
{
  "event_id": "uuid",
  "event_name": "supply_chain.purchase_order.approved",
  "event_version": 1,
  "occurred_at": "2026-01-21T12:00:00Z",
  "tenant_id": "uuid",
  "payload": {
    "po_id": "uuid",
    "po_number": "PO-2026-001",
    "approved_by_user_id": "uuid",
    "approved_at": "2026-01-21T12:00:00Z"
  }
}
```

---

## Event Query Examples

### Get All Events for a Tenant (Last 24 Hours)

```sql
SELECT 
    event_name,
    payload,
    created_at
FROM inventory.events_outbox
WHERE 
    tenant_id = 'your-tenant-id'
    AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

### Get All Purchase Order Events

```sql
SELECT 
    event_name,
    payload->>'po_number' as po_number,
    created_at
FROM inventory.events_outbox
WHERE 
    event_name LIKE 'supply_chain.purchase_order.%'
    AND tenant_id = 'your-tenant-id'
ORDER BY created_at DESC;
```

### Get Event Statistics

```sql
SELECT 
    event_name,
    COUNT(*) as event_count,
    MAX(created_at) as last_emitted,
    COUNT(*) FILTER (WHERE published_at IS NULL) as pending,
    COUNT(*) FILTER (WHERE published_at IS NOT NULL) as published
FROM inventory.events_outbox
WHERE tenant_id = 'your-tenant-id'
GROUP BY event_name
ORDER BY event_count DESC;
```

---

## Summary

✅ **46 Active Events** across 2 bounded contexts  
✅ **Proper Naming Convention** with domain prefixes  
✅ **Producer Alignment** with schemas  
✅ **Atomic Bridge** event for cross-context operations  
✅ **Deprecated Events** tracked for migration  
✅ **Real-time Integration** via Supabase Realtime  
✅ **Webhook Support** for external systems  

**Next Steps:**
1. Update frontend to subscribe to new `supply_chain.*` events
2. Migrate webhook consumers from deprecated events
3. Monitor event outbox for stuck/failed events
4. Add custom events as new features are built

---

**Questions or Issues?**  
See: `DATABASE_MONITORING_GUIDE.md` for event troubleshooting
