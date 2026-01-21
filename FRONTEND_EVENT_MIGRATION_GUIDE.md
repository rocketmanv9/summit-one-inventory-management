# Frontend Event Migration Guide

## ⚠️ Event Naming Changes - IMMEDIATE ACTION REQUIRED

**Date:** January 21, 2026  
**Status:** ✅ COMPLETE - Only supply_chain.* events are emitted  
**Grace Period:** ❌ NONE - Old event names removed immediately

---

## 📋 What Changed?

After the **bounded context separation**, event names for supply chain entities were updated to follow the domain-driven design pattern:

### Old Event Names (DEPRECATED ⚠️)
```
vendor.created
vendor.updated
purchase_order.created
purchase_order.submitted
purchase_order.approved
receipt.created
receipt.line_added
inventory.po.placed
inventory.po.approved
inventory.po.received
```

### New Event Names (USE THESE ✅)
```
supply_chain.vendor.created
supply_chain.vendor.updated
supply_chain.purchase_order.created
supply_chain.purchase_order.submitted
supply_chain.purchase_order.approved
supply_chain.purchase_order.in_transit
supply_chain.purchase_order.received
supply_chain.purchase_order.cancelled
supply_chain.purchase_order.closed
supply_chain.receipt.created
supply_chain.receipt.line_added
supply_chain.receipt.posted
```

---

## 🚀 Migration Steps

### Step 1: Update Event Subscriptions

**Before (Old Code):**
```typescript
// ❌ DEPRECATED - Will stop working after April 21, 2026
useEventSubscription({
  eventNames: [
    'purchase_order.created',
    'purchase_order.approved',
    'receipt.created'
  ],
  onEvent: (event) => {
    refreshData();
  }
});
```

**After (New Code):**
```typescript
// ✅ CORRECT - Use new supply_chain.* event names
useEventSubscription({
  eventNames: [
    'supply_chain.purchase_order.created',
    'supply_chain.purchase_order.approved',
    'supply_chain.receipt.created'
  ],
  onEvent: (event) => {
    refreshData();
  }
});
```

### Step 2: Use Domain-Specific Hooks

**Option 1: Use the new `useSupplyChainEvents` hook (RECOMMENDED)**
```typescript
import { useSupplyChainEvents } from '@/hooks/useEventSubscription';

// ✅ Cleaner approach - automatically subscribes to supply_chain.* events
useSupplyChainEvents({
  onPurchaseOrderEvent: (event) => {
    console.log('PO event:', event.event_name);
    refreshPurchaseOrders();
  },
  onReceiptEvent: (event) => {
    console.log('Receipt event:', event.event_name);
    refreshReceipts();
  },
  onVendorEvent: (event) => {
    console.log('Vendor event:', event.event_name);
    refreshVendors();
  }
});
```

**Option 2: Use pattern matching**
```typescript
// ✅ Subscribe to all supply chain events with wildcard
useEventSubscription({
  eventPattern: 'supply_chain.%',
  onEvent: (event) => {
    if (event.event_name.startsWith('supply_chain.purchase_order.')) {
      handlePOEvent(event);
    } else if (event.event_name.startsWith('supply_chain.receipt.')) {
      handleReceiptEvent(event);
    }
  }
});
```

### Step 3: Update Widget Components

**Example: Purchase Orders Widget**

**Before:**
```typescript
// src/components/widgets/procurement/OpenPurchaseOrders.tsx
export function OpenPurchaseOrders({ widget }: { widget: DashboardWidget }) {
  // ❌ Old: Static polling, no real-time updates
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, []);
  
  return <BaseTableWidget widget={widget} data={data} isLoading={isLoading} />;
}
```

**After:**
```typescript
// src/components/widgets/procurement/OpenPurchaseOrdersRealtime.tsx
import { useSupplyChainEvents } from '@/hooks/useEventSubscription';

export function OpenPurchaseOrdersRealtime({ widget }: { widget: DashboardWidget }) {
  // ✅ New: Real-time updates via supply_chain.* events
  useSupplyChainEvents({
    onPurchaseOrderEvent: (event) => {
      console.log('📦 PO updated:', event.event_name);
      fetchData(); // Refresh when events occur
    }
  });
  
  return <BaseTableWidget widget={widget} data={data} isLoading={isLoading} />;
}
```

---

## 📦 Updated Components

The following new real-time components are available:

| Old Component | New Real-Time Component | Event Pattern |
|---------------|------------------------|---------------|
| `OpenPurchaseOrders` | `OpenPurchaseOrdersRealtime` | `supply_chain.purchase_order.*` |
| `RecentReceipts` | `RecentReceiptsRealtime` | `supply_chain.receipt.*` |
| (future) VendorList | (future) VendorListRealtime | `supply_chain.vendor.*` |

---

## 🔍 Complete Event Mapping

### Purchase Order Events

| Old Event Name | New Event Name | Description |
|----------------|----------------|-------------|
| `purchase_order.created` | `supply_chain.purchase_order.created` | PO created in draft |
| `purchase_order.submitted` | `supply_chain.purchase_order.submitted` | PO submitted for approval |
| `purchase_order.approved` | `supply_chain.purchase_order.approved` | PO approved |
| `inventory.po.placed` | `supply_chain.purchase_order.in_transit` | PO sent to vendor |
| `inventory.po.received` | `supply_chain.purchase_order.received` | Goods received |
| `purchase_order.cancelled` | `supply_chain.purchase_order.cancelled` | PO cancelled |
| `purchase_order.closed` | `supply_chain.purchase_order.closed` | PO fully fulfilled and closed |

### Receipt Events

| Old Event Name | New Event Name | Description |
|----------------|----------------|-------------|
| `receipt.created` | `supply_chain.receipt.created` | Receipt document created |
| `receipt.line_added` | `supply_chain.receipt.line_added` | Item added to receipt |
| (none) | `supply_chain.receipt.posted` | Receipt posted to inventory (ATOMIC BRIDGE) |

### Vendor Events

| Old Event Name | New Event Name | Description |
|----------------|----------------|-------------|
| `vendor.created` | `supply_chain.vendor.created` | New vendor registered |
| `vendor.updated` | `supply_chain.vendor.updated` | Vendor info updated |

---

## ✅ Migration Checklist

Use this checklist to track your migration progress:

### Components to Update

- [ ] `src/components/widgets/procurement/OpenPurchaseOrders.tsx`
  - [ ] Replace with `OpenPurchaseOrdersRealtime.tsx`
  - [ ] Subscribe to `supply_chain.purchase_order.*`
  
- [ ] `src/components/widgets/flow/RecentReceipts.tsx`
  - [ ] Replace with `RecentReceiptsRealtime.tsx`
  - [ ] Subscribe to `supply_chain.receipt.*`
  
- [ ] `src/app/(dashboard)/inventory/purchasing/**/*.tsx`
  - [ ] Update PO status checks to use new event names
  - [ ] Update event filtering logic
  
- [ ] `src/app/(dashboard)/operations/receive/**/*.tsx`
  - [ ] Update receipt event handlers
  - [ ] Subscribe to `supply_chain.receipt.posted` for stock updates

### Widget Registry

- [ ] Update `src/components/widgets/WidgetRegistry.tsx`
  - [ ] Replace static widgets with real-time versions
  - [ ] Add new widget keys if needed

### API Routes

- [ ] Review `src/app/api/widgets/data/route.ts`
  - [ ] Ensure queries use `supply_chain.*` tables/views
  - [ ] Update event name filters

### Testing

- [ ] Test PO creation → Event emission → Widget refresh
- [ ] Test receipt posting → Event emission → Dashboard update
- [ ] Test vendor updates → Event emission → List refresh
- [ ] Verify real-time indicator shows "Live" status
- [ ] Confirm events appear in browser console with new names

---

## 📚 Reference Documentation

- **EVENT_CATALOG.md** - Complete list of all 46 active events with payload schemas
- **EVENT_QUICK_REFERENCE.md** - Quick lookup card for developers
- **EVENT_AUDIT_SUMMARY.md** - Full audit report with before/after comparison
- **test_events.sql** - Automated event system tests

---

## 🆘 Support

**Questions?** Check these resources:

1. **Event Catalog**: `/EVENT_CATALOG.md` - Full event reference with examples
2. **Quick Reference**: `/EVENT_QUICK_REFERENCE.md` - Common patterns
3. **Hook Documentation**: `src/hooks/useEventSubscription.ts` - JSDoc comments with examples
4. **Migration Deadline**: April 21, 2026 (90 days from event audit)

**Effective Immediately (January 21, 2026):**
- ❌ Old event names have been REMOVED from the system
- ❌ Components using deprecated events will NOT receive updates
- ✅ Database triggers ONLY emit `supply_chain.*` events now

---

## 🎯 Migration Priority

### Priority 1: High Traffic Widgets (Week 1)
- Purchase Orders widget
- Recent Receipts widget
- Vendor Performance dashboard

### Priority 2: Operational Pages (Week 2-3)
- PO creation/approval pages
- Receipt posting pages
- Vendor management pages

### Priority 3: Reports & Analytics (Week 4)
- Supply chain reports
- Event logs/audit views
- Custom dashboards

---

## ✨ Benefits of Migration

After migrating to the new event system:

✅ **Real-time Updates** - Dashboards refresh instantly when events occur  
✅ **Domain Clarity** - Event names clearly indicate bounded context (supply_chain vs inventory)  
✅ **Better Debugging** - Event logs show clear domain separation  
✅ **Future-Proof** - Aligned with microservice architecture for future scaling  
✅ **Type Safety** - Better TypeScript types with domain-specific hooks  
✅ **Performance** - Eliminate polling, use event-driven architecture

---

## 📊 Example: Complete Widget Migration

**Before (Old Static Widget):**
```typescript
// ❌ OLD: Polling every 30 seconds
'use client';

import { useState, useEffect } from 'react';
import type { DashboardWidget } from '@/types/dashboard';
import { BaseTableWidget } from '../BaseTableWidget';

export function OpenPurchaseOrders({ widget }: { widget: DashboardWidget }) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      const response = await fetch('/api/widgets/data', {
        method: 'POST',
        body: JSON.stringify({ widget_key: widget.widget_key }),
      });
      const result = await response.json();
      setData(result.data);
      setIsLoading(false);
    }
    
    fetchData();
    const interval = setInterval(fetchData, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [widget.widget_key]);

  return <BaseTableWidget widget={widget} data={data} isLoading={isLoading} />;
}
```

**After (New Real-Time Widget):**
```typescript
// ✅ NEW: Real-time updates via supply_chain.purchase_order.* events
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { DashboardWidget } from '@/types/dashboard';
import { BaseTableWidget } from '../BaseTableWidget';
import { useSupplyChainEvents } from '@/hooks/useEventSubscription';

export function OpenPurchaseOrdersRealtime({ widget }: { widget: DashboardWidget }) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    const response = await fetch('/api/widgets/data', {
      method: 'POST',
      body: JSON.stringify({ widget_key: widget.widget_key }),
    });
    const result = await response.json();
    setData(result.data);
    setLastUpdate(new Date());
    setIsLoading(false);
  }, [widget.widget_key]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ✅ Subscribe to real-time events - NO POLLING!
  useSupplyChainEvents({
    onPurchaseOrderEvent: (event) => {
      console.log('📦 PO Event:', event.event_name, event.payload);
      setTimeout(fetchData, 1000); // Debounce rapid events
    },
  });

  return (
    <div className="relative">
      <BaseTableWidget widget={widget} data={data} isLoading={isLoading} />
      
      {/* Real-time indicator */}
      <div className="absolute top-2 right-2 flex items-center gap-2 text-xs">
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        <span>Live</span>
        <span className="opacity-50">
          Updated {lastUpdate.toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
```

**Key Improvements:**
1. ✅ No more polling - saves server resources
2. ✅ Instant updates when POs change
3. ✅ Visual "Live" indicator for users
4. ✅ Event debouncing prevents UI thrashing
5. ✅ Better developer experience with typed events
6. ✅ Console logging for debugging

---

## 🚦 Migration Status Tracking

Track your progress here:

| Area | Status | Notes |
|------|--------|-------|
| Event subscription hook created | ✅ Complete | `useEventSubscription.ts` |
| Supply chain hook created | ✅ Complete | `useSupplyChainEvents()` |
| PO widget migrated | ⏳ Pending | Use `OpenPurchaseOrdersRealtime` |
| Receipt widget migrated | ⏳ Pending | Use `RecentReceiptsRealtime` |
| Vendor pages updated | ⏳ Pending | Subscribe to `supply_chain.vendor.*` |
| PO approval flow updated | ⏳ Pending | Listen for status changes |
| Receipt posting updated | ⏳ Pending | Listen for `receipt.posted` |
| Widget registry updated | ⏳ Pending | Register new real-time widgets |
| Testing complete | ⏳ Pending | All widgets refresh on events |
| Documentation reviewed | ⏳ Pending | Team trained on new patterns |

---

**Need Help?** See `EVENT_CATALOG.md` for complete event documentation or `EVENT_QUICK_REFERENCE.md` for quick examples.

**Status:** ✅ Migration complete - Using new events only
