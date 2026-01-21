# Event Quick Reference Card

## 📌 Event Naming Pattern
```
<domain>.<entity>.<action>
```

## 🎯 Domain Prefixes

| Prefix | Schema | Examples |
|--------|--------|----------|
| `supply_chain.*` | `supply_chain` | `supply_chain.vendor.created`<br>`supply_chain.purchase_order.approved`<br>`supply_chain.receipt.posted` |
| `inventory.*` | `inventory` | `inventory.item.created`<br>`inventory.stock.adjusted`<br>`inventory.cycle_count.discrepancy` |
| No prefix | `inventory` | `stock.issued`<br>`asset.assigned`<br>`transfer.completed` |

## ✅ Active Event Count by Domain

- **Supply Chain:** 12 events
- **Inventory:** 34 events
- **Total Active:** 46 events
- **Deprecated:** 13 events

## 🚀 Common Event Examples

### Supply Chain Domain

```sql
-- Vendor Events
supply_chain.vendor.created
supply_chain.vendor.updated

-- Purchase Order Events  
supply_chain.purchase_order.created
supply_chain.purchase_order.submitted
supply_chain.purchase_order.approved
supply_chain.purchase_order.in_transit
supply_chain.purchase_order.received
supply_chain.purchase_order.cancelled
supply_chain.purchase_order.closed

-- Receipt Events
supply_chain.receipt.created
supply_chain.receipt.line_added
supply_chain.receipt.posted  ← ATOMIC BRIDGE EVENT
```

### Inventory Domain

```sql
-- Catalog Events
inventory.item.created
catalog_item.updated
catalog_item.deactivated

-- Location Events
location.created
location.updated
location.deactivated

-- Stock Movement Events
stock.replenished
stock.issued
stock.returned
stock.low_threshold_reached ← ALERT
stock.out_of_stock ← ALERT

-- Transfer Events
transfer.created
transfer.completed
transfer.cancelled

-- Asset Events
asset.created
asset.assigned
asset.returned
asset.retired

-- Reservation Events
reservation.created
reservation.fulfilled
reservation.cancelled

-- Cycle Count Events
cycle_count.started
cycle_count.line_counted
cycle_count.approved
cycle_count.posted

-- Adjustment Events
adjustment.created
adjustment.approved
```

## 📡 Frontend Integration

### Subscribe to All Supply Chain Events

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(url, key);

supabase
  .channel('supply_chain')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'inventory',
    table: 'events_outbox',
    filter: 'event_name=like.supply_chain.%'
  }, (payload) => {
    console.log('Supply chain event:', payload.new);
  })
  .subscribe();
```

### Subscribe to Specific Event

```typescript
supabase
  .channel('po_approved')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'inventory',
    table: 'events_outbox',
    filter: 'event_name=eq.supply_chain.purchase_order.approved'
  }, (payload) => {
    const data = payload.new.payload;
    showNotification({
      type: 'success',
      title: 'PO Approved',
      message: `${data.po_number} has been approved`
    });
  })
  .subscribe();
```

### Subscribe to Stock Alerts

```typescript
supabase
  .channel('stock_alerts')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'inventory',
    table: 'events_outbox',
    filter: 'event_name=in.(stock.low_threshold_reached,stock.out_of_stock)'
  }, (payload) => {
    const data = payload.new.payload;
    showAlert({
      type: 'warning',
      message: `Low stock: ${data.item_name} at ${data.location_name}`
    });
  })
  .subscribe();
```

## 🔍 Query Events

### Get All Events for Tenant (Last Hour)

```sql
SELECT 
    event_name,
    payload,
    created_at
FROM inventory.events_outbox
WHERE 
    tenant_id = 'your-tenant-id'
    AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

### Get Purchase Order Lifecycle

```sql
SELECT 
    event_name,
    payload->>'po_number' as po_number,
    payload->>'status' as status,
    created_at
FROM inventory.events_outbox
WHERE 
    event_name LIKE 'supply_chain.purchase_order.%'
    AND payload->>'po_id' = 'your-po-id'
ORDER BY created_at ASC;
```

### Event Statistics by Type

```sql
SELECT 
    event_name,
    COUNT(*) as count,
    MAX(created_at) as last_emitted
FROM inventory.events_outbox
WHERE tenant_id = 'your-tenant-id'
GROUP BY event_name
ORDER BY count DESC;
```

## ⚠️ Deprecated Events (DO NOT USE)

These events were deprecated on **January 21, 2026**:

| Old Event | New Event |
|-----------|-----------|
| `vendor.created` | `supply_chain.vendor.created` |
| `vendor.updated` | `supply_chain.vendor.updated` |
| `purchase_order.created` | `supply_chain.purchase_order.created` |
| `purchase_order.submitted` | `supply_chain.purchase_order.submitted` |
| `purchase_order.approved` | `supply_chain.purchase_order.approved` |
| `purchase_order.cancelled` | `supply_chain.purchase_order.cancelled` |
| `purchase_order.closed` | `supply_chain.purchase_order.closed` |
| `receipt.line_added` | `supply_chain.receipt.line_added` |
| `receipt.completed` | `supply_chain.receipt.posted` |
| `inventory.po.placed` | `supply_chain.purchase_order.in_transit` |
| `inventory.po.cancelled` | `supply_chain.purchase_order.cancelled` |
| `inventory.po.received` | `supply_chain.purchase_order.received` |
| `inventory.receipt.created` | `supply_chain.receipt.created` |

**Migration Deadline:** April 21, 2026 (90 days)

## 🎯 Key Events to Monitor

### Critical Business Events

1. **supply_chain.receipt.posted** - Inventory updated (atomic bridge)
2. **stock.out_of_stock** - Critical stockout
3. **stock.low_threshold_reached** - Reorder alert
4. **supply_chain.purchase_order.approved** - PO ready to send
5. **adjustment.approved** - Inventory corrected

### Performance Monitoring

1. **Event outbox growth** - Check for stuck events
2. **Failed publishes** - Events not delivered to webhooks
3. **Event lag** - Time between creation and publishing

## 📚 Full Documentation

- **EVENT_CATALOG.md** - Complete event reference (42 pages)
- **EVENT_AUDIT_SUMMARY.md** - Migration summary
- **FRONTEND_IMPLEMENTATION.md** - RPC integration guide
- **DATABASE_MONITORING_GUIDE.md** - Event troubleshooting

## ✅ Checklist for New Events

When adding a new event:

- [ ] Use proper naming: `<domain>.<entity>.<action>`
- [ ] Register via `public.register_event()`
- [ ] Set correct `producer` (schema name)
- [ ] Create payload schema (JSON Schema)
- [ ] Provide example payload
- [ ] Update trigger to emit event
- [ ] Add to EVENT_CATALOG.md
- [ ] Test emission
- [ ] Update frontend subscriptions

---

**Last Updated:** January 21, 2026  
**Status:** Production Ready ✅
