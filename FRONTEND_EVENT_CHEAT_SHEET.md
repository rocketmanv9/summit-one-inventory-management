# 🎯 Frontend Event Cheat Sheet

**Quick reference for using the new supply_chain.* event system**

---

## ⚡ Quick Start (Copy & Paste)

### 1. Subscribe to Purchase Order Events
```typescript
import { useSupplyChainEvents } from '@/hooks/useEventSubscription';

function MyPurchaseOrderWidget() {
  const [data, setData] = useState([]);
  
  // ✅ Auto-refresh when POs change
  useSupplyChainEvents({
    onPurchaseOrderEvent: (event) => {
      console.log('PO Event:', event.event_name);
      fetchPurchaseOrders(); // Refresh your data
    }
  });
  
  return <div>...</div>;
}
```

### 2. Subscribe to Receipt Events
```typescript
useSupplyChainEvents({
  onReceiptEvent: (event) => {
    if (event.event_name === 'supply_chain.receipt.posted') {
      // Receipt was posted to inventory (atomic bridge)
      refreshInventory();
      showToast('Receipt posted successfully');
    }
  }
});
```

### 3. Subscribe to Stock Events
```typescript
import { useInventoryStockEvents } from '@/hooks/useEventSubscription';

useInventoryStockEvents({
  onStockChange: (event) => {
    console.log('Stock changed:', event.payload);
    refreshStockBalances();
  }
});
```

### 4. Subscribe to ALL Supply Chain Events
```typescript
import { useEventSubscription } from '@/hooks/useEventSubscription';

useEventSubscription({
  eventPattern: 'supply_chain.%',  // SQL LIKE pattern
  onEvent: (event) => {
    console.log('Event:', event.event_name, event.payload);
  }
});
```

---

## 📋 Event Name Quick Reference

### Purchase Order Events
| Event Name | When It Fires |
|------------|---------------|
| `supply_chain.purchase_order.created` | PO created in draft |
| `supply_chain.purchase_order.submitted` | PO submitted for approval |
| `supply_chain.purchase_order.approved` | PO approved by manager |
| `supply_chain.purchase_order.in_transit` | PO sent to vendor |
| `supply_chain.purchase_order.received` | Goods received |
| `supply_chain.purchase_order.cancelled` | PO cancelled |
| `supply_chain.purchase_order.closed` | PO fully fulfilled and closed |

### Receipt Events
| Event Name | When It Fires |
|------------|---------------|
| `supply_chain.receipt.created` | Receipt document created |
| `supply_chain.receipt.line_added` | Item added to receipt |
| `supply_chain.receipt.posted` | Receipt posted to inventory (ATOMIC) |

### Vendor Events
| Event Name | When It Fires |
|------------|---------------|
| `supply_chain.vendor.created` | New vendor registered |
| `supply_chain.vendor.updated` | Vendor info updated |

### Stock Events
| Event Name | When It Fires |
|------------|---------------|
| `stock.replenished` | Stock added (from receipt) |
| `stock.issued` | Stock removed (to job/truck) |
| `stock.adjusted` | Manual stock adjustment |
| `stock.low_threshold_reached` | Item below reorder point |
| `stock.out_of_stock` | Item quantity = 0 |

---

## 🎨 Common Patterns

### Pattern 1: Real-Time Widget with "Live" Indicator
```typescript
'use client';

import { useState, useCallback } from 'react';
import { useSupplyChainEvents } from '@/hooks/useEventSubscription';

export function MyWidget() {
  const [data, setData] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  
  const fetchData = useCallback(async () => {
    const res = await fetch('/api/my-data');
    setData(await res.json());
    setLastUpdate(new Date());
  }, []);
  
  // Auto-refresh on events
  useSupplyChainEvents({
    onPurchaseOrderEvent: () => {
      setTimeout(fetchData, 1000); // Debounce
    }
  });
  
  return (
    <div className="relative">
      {/* Your widget content */}
      <YourContent data={data} />
      
      {/* Live indicator */}
      <div className="absolute top-2 right-2 flex items-center gap-2 text-xs">
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        <span>Live</span>
        <span className="opacity-50">
          {lastUpdate.toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
```

### Pattern 2: Toast Notifications on Events
```typescript
import { toast } from '@/components/ui/use-toast';

useSupplyChainEvents({
  onPurchaseOrderEvent: (event) => {
    if (event.event_name === 'supply_chain.purchase_order.approved') {
      toast({
        title: '✅ PO Approved',
        description: `${event.payload.po_number} - ${event.payload.vendor_name}`,
      });
    }
  }
});
```

### Pattern 3: Conditional Subscription (Toggle On/Off)
```typescript
const [enableRealtime, setEnableRealtime] = useState(true);

useSupplyChainEvents({
  onPurchaseOrderEvent: refreshData,
  enabled: enableRealtime  // Can be toggled
});

// In UI:
<Button onClick={() => setEnableRealtime(!enableRealtime)}>
  {enableRealtime ? '🟢 Live' : '⚫ Paused'}
</Button>
```

### Pattern 4: Event Filtering
```typescript
useSupplyChainEvents({
  onPurchaseOrderEvent: (event) => {
    // Only refresh for approved or received events
    if (event.event_name === 'supply_chain.purchase_order.approved' ||
        event.event_name === 'supply_chain.purchase_order.received') {
      refreshData();
    }
  }
});
```

---

## 🔍 Event Payload Examples

### PO Approved Event
```typescript
{
  id: "uuid",
  event_name: "supply_chain.purchase_order.approved",
  payload: {
    po_id: "uuid",
    po_number: "PO-2026-001",
    old_status: "submitted",
    new_status: "approved",
    vendor_name: "Acme Corp"
  },
  actor_user_id: "uuid",
  created_at: "2026-01-21T10:30:00Z"
}
```

### Receipt Posted Event
```typescript
{
  event_name: "supply_chain.receipt.posted",
  payload: {
    receipt_id: "uuid",
    receipt_number: "RCV-045",
    location_id: "uuid",
    items_count: 3,
    total_qty: 150,
    posted_at: "2026-01-21T15:00:00Z"
  }
}
```

### Stock Low Threshold Event
```typescript
{
  event_name: "stock.low_threshold_reached",
  payload: {
    catalog_item_id: "uuid",
    item_sku: "AGG-001",
    item_name: "3/4\" Crushed Stone",
    location_id: "uuid",
    current_qty: 5,
    reorder_point: 10
  }
}
```

---

## ⚠️ Migration from Old Events

### ❌ OLD (Don't use - Deprecated)
```typescript
// These will STOP WORKING after April 21, 2026
useEventSubscription({
  eventNames: [
    'purchase_order.created',      // ❌ DEPRECATED
    'purchase_order.approved',     // ❌ DEPRECATED
    'receipt.created'              // ❌ DEPRECATED
  ]
});
```

### ✅ NEW (Use these)
```typescript
// Use supply_chain.* prefix
useEventSubscription({
  eventNames: [
    'supply_chain.purchase_order.created',   // ✅ CORRECT
    'supply_chain.purchase_order.approved',  // ✅ CORRECT
    'supply_chain.receipt.created'           // ✅ CORRECT
  ]
});

// OR use the domain-specific hook (easier):
useSupplyChainEvents({
  onPurchaseOrderEvent: handlePOEvent,
  onReceiptEvent: handleReceiptEvent
});
```

---

## 📚 Files You Need

| File | Purpose |
|------|---------|
| `src/hooks/useEventSubscription.ts` | Import hooks from here |
| `src/types/events.ts` | TypeScript types (optional) |
| `FRONTEND_EVENT_MIGRATION_GUIDE.md` | Detailed migration guide |
| `EVENT_CATALOG.md` | Complete event reference |
| `/examples/events` page | Live demo |

---

## 🐛 Debugging

### Check if connected:
```typescript
const { isConnected } = useEventSubscription({...});
console.log('Connected:', isConnected);
```

### Enable event logging:
```typescript
useSupplyChainEvents({
  onPurchaseOrderEvent: (event) => {
    console.log('📦 PO Event:', event.event_name, event.payload);
  }
});
```

### Test events:
1. Open `/examples/events` page
2. Create a PO in another tab
3. Watch event appear instantly

---

## ✅ Checklist for New Widget

- [ ] Import `useSupplyChainEvents` or `useEventSubscription`
- [ ] Add subscription hook in component
- [ ] Implement refresh logic in event callback
- [ ] Add debounce (1000ms) to prevent rapid refreshes
- [ ] Add "Live" indicator to UI
- [ ] Test: Create PO → Widget auto-refreshes
- [ ] Console shows event logs with new names

---

## 🚀 Performance Tips

1. **Debounce rapid events** (use setTimeout with 1000ms)
2. **Don't fetch inside event handler** - use useCallback
3. **Filter events early** - only refresh when needed
4. **Use domain hooks** - cleaner than pattern matching
5. **Enable only when visible** - toggle via `enabled` prop

---

## 🆘 Need Help?

- **Complete guide:** `/FRONTEND_EVENT_MIGRATION_GUIDE.md`
- **Event catalog:** `/EVENT_CATALOG.md`
- **Live demo:** `/examples/events`
- **Hook docs:** `src/hooks/useEventSubscription.ts` (JSDoc comments)

---

**Status:** ✅ LIVE - Only supply_chain.* events active  
**Deprecated Events:** ❌ Removed - Use new names immediately!
