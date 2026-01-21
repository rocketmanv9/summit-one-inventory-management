# Frontend Implementation Guide
## RPC-Based Architecture with Bounded Contexts

**Created:** January 21, 2026  
**Architecture:** Domain-Driven Design (DDD)  
**Patterns:** RPC-First, Bounded Contexts, CQRS  

---

## 🎯 Overview

This frontend implements the **complete Phase 1 MVP** features from the FRONTEND_CAPABILITIES_ROADMAP.md using a **clean RPC-based architecture** that respects the backend's bounded context separation.

### What's Implemented

✅ **RPC Service Layer** (`src/lib/rpc/`)
- `supply-chain.ts` - Procurement bounded context
- `inventory.ts` - Inventory management bounded context

✅ **Core Pages** (Phase 1 MVP)
1. Catalog Items Management (`/inventory/items`)
2. Stock Balances Dashboard (`/inventory/stock`)
3. Create Receipt (`/operations/receive/create`)
4. Issue Inventory (`/operations/issue`)
5. Create Purchase Order (`/inventory/purchasing/create`)

✅ **Dashboard Widgets**
- Inventory Summary Widget (uses `mv_inventory_summary`)
- Low Stock Alert Widget (uses `mv_low_stock_summary`)

---

## 🏗️ Architecture Principles

### 1. **RPC-First Design**

❌ **Never do this:**
```typescript
// Direct table insert - WRONG!
const { data, error } = await supabase
  .from('receipts')
  .insert({ ... });
```

✅ **Always do this:**
```typescript
// Use RPC - CORRECT!
const result = await SupplyChainRPC.createReceipt({
  location_id: '...',
  lines: [...],
  auto_post: true,
});
```

**Why?**
- RPCs enforce business rules
- Atomic transactions
- Idempotency built-in
- Audit trail automatic
- Cross-schema coordination (atomic bridge)

### 2. **Bounded Context Awareness**

The backend has two schemas:

| Schema | Purpose | Tables | RPCs |
|--------|---------|--------|------|
| **supply_chain** | Procurement | vendors, purchase_orders, receipts | rpc_create_purchase_order, rpc_create_receipt, rpc_post_receipt_to_inventory |
| **inventory** | Stock & Assets | catalog_items, stock_balances, reservations | rpc_issue_inventory, rpc_adjust_inventory |

**Frontend Rule:** Use the correct RPC service:
- Procurement operations → `SupplyChainRPC`
- Inventory operations → `InventoryRPC`

### 3. **Read vs. Write Separation**

✅ **Reads:** Query tables/views directly
```typescript
// OK: Direct query for reads
const items = await InventoryRPC.getCatalogItems({ active: true });
```

❌ **Writes:** MUST use RPCs
```typescript
// REQUIRED: RPC for writes
await InventoryRPC.issueInventory({ ... });
```

---

## 📁 Project Structure

```
src/
├── lib/
│   └── rpc/
│       ├── supply-chain.ts    # Procurement RPCs
│       └── inventory.ts        # Inventory RPCs
│
├── app/(dashboard)/
│   ├── inventory/
│   │   ├── items/              # Catalog items CRUD
│   │   ├── stock/              # Stock balances view
│   │   └── purchasing/
│   │       └── create/         # Create PO (RPC-based)
│   │
│   └── operations/
│       ├── receive/
│       │   └── create/         # Create receipt (RPC-based)
│       └── issue/              # Issue inventory (RPC-based)
│
└── components/
    └── widgets/
        └── inventory/
            ├── LowStockWidget.tsx       # Uses mv_low_stock_summary
            └── InventorySummaryWidget.tsx # Uses mv_inventory_summary
```

---

## 🚀 Quick Start

### 1. Start Development Server

```powershell
npm run dev
```

### 2. Navigate to Pages

- **Catalog Items:** http://localhost:3000/inventory/items
- **Stock Balances:** http://localhost:3000/inventory/stock
- **Create Receipt:** http://localhost:3000/operations/receive/create
- **Issue Inventory:** http://localhost:3000/operations/issue
- **Create PO:** http://localhost:3000/inventory/purchasing/create

### 3. Test RPC Operations

#### Create a Receipt
1. Go to `/operations/receive/create`
2. Select location
3. Add items and quantities
4. Check "Auto-post to inventory"
5. Submit

**Behind the scenes:**
```typescript
SupplyChainRPC.createReceipt({
  location_id: 'uuid',
  lines: [{ catalog_item_id: 'uuid', qty_received: 100 }],
  auto_post: true, // Calls atomic bridge!
})
```

**What happens:**
1. Receipt created in `supply_chain.receipts`
2. RPC calls atomic bridge: `rpc_post_receipt_to_inventory()`
3. Inventory events created (ledger)
4. Stock movements created
5. Stock balances updated
6. All in ONE transaction with idempotency!

#### Issue Inventory
1. Go to `/operations/issue`
2. Select location
3. Add items (shows available qty in real-time)
4. Enter who it's issued to (job, truck, person)
5. Submit

**Behind the scenes:**
```typescript
InventoryRPC.issueInventory({
  location_id: 'uuid',
  items: [{ catalog_item_id: 'uuid', qty_issued: 25 }],
  issued_to_type: 'job',
  issued_to_ref: 'JOB-12345',
  reason: 'Job consumption',
})
```

**What happens:**
1. Validates availability (prevents over-issuing)
2. Creates inventory event (ledger)
3. Creates stock movement
4. Updates stock balances
5. All atomic with idempotency!

---

## 🔑 Key Features

### Real-Time Stock Availability

The Issue Inventory page shows real-time availability:

```typescript
// Loads stock balances when location selected
const balances = await InventoryRPC.getStockBalances({
  location_id: selectedLocation,
});

// Displays available qty per item
<div>Available: {balance.qty_available} {item.unit_of_measure}</div>

// Prevents over-issuing
if (qty_issued > qty_available) {
  error = "Insufficient stock!";
}
```

### Idempotency

All RPCs are idempotent via `last_event_id` unique constraints:

```typescript
// Safe to retry - won't create duplicates
await SupplyChainRPC.createReceipt({ ... });
await SupplyChainRPC.createReceipt({ ... }); // Won't duplicate!
```

### Materialized View Widgets

Dashboard widgets use pre-aggregated data for instant load:

```typescript
// LowStockWidget.tsx
const items = await InventoryRPC.getLowStockItems();
// Queries: mv_low_stock_summary (refreshed every 5 min)
// Result: <500ms response time!
```

---

## 📝 Adding New Features

### Example: Add Transfer Page

**Step 1:** Create RPC method (if not exists)

```typescript
// src/lib/rpc/inventory.ts

export const InventoryRPC = {
  // ... existing methods

  async createTransfer(params: {
    from_location_id: string;
    to_location_id: string;
    items: Array<{ catalog_item_id: string; qty: number }>;
    notes?: string;
  }) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('rpc_create_transfer', {
      p_from_location_id: params.from_location_id,
      p_to_location_id: params.to_location_id,
      p_items: params.items,
      p_notes: params.notes,
    });

    if (error) throw new Error(`Failed to create transfer: ${error.message}`);
    return data;
  },
};
```

**Step 2:** Create page

```typescript
// src/app/(dashboard)/operations/transfer/create/page.tsx

'use client';

import { InventoryRPC } from '@/lib/rpc/inventory';

export default function CreateTransferPage() {
  const handleSubmit = async (formData) => {
    const result = await InventoryRPC.createTransfer({
      from_location_id: formData.fromLocation,
      to_location_id: formData.toLocation,
      items: formData.items,
    });
    
    // Success! Transfer created atomically
  };

  return <form onSubmit={handleSubmit}>...</form>;
}
```

---

## 🎨 UI Patterns

### Search with Filters

```typescript
const [search, setSearch] = useState('');
const [filters, setFilters] = useState({ active: true });

// RPC methods accept filter params
const items = await InventoryRPC.getCatalogItems({
  active: filters.active,
  search: search || undefined,
});
```

### Real-Time Updates

```typescript
useEffect(() => {
  loadData();
  
  // Auto-refresh every 30 seconds
  const interval = setInterval(loadData, 30000);
  return () => clearInterval(interval);
}, []);
```

### Error Handling

```typescript
const [error, setError] = useState('');

try {
  await InventoryRPC.issueInventory({ ... });
} catch (err: any) {
  setError(err.message); // RPC throws descriptive errors
}

// Display:
{error && (
  <div className="p-4 bg-red-50 border border-red-200 rounded">
    {error}
  </div>
)}
```

---

## 🔍 Debugging

### Check RPC Calls

Open browser DevTools → Network tab → Filter: `rpc_`

You'll see:
- `rpc_create_receipt`
- `rpc_issue_inventory`
- `rpc_create_purchase_order`

### Check Database

```sql
-- See last receipt posted
SELECT * FROM supply_chain.receipts ORDER BY created_at DESC LIMIT 1;

-- See inventory events
SELECT * FROM inventory.inventory_events ORDER BY event_ts DESC LIMIT 10;

-- See stock balances
SELECT * FROM inventory.stock_balances;

-- Check low stock items (materialized view)
SELECT * FROM inventory.mv_low_stock_summary;
```

---

## 📚 Next Steps

### Phase 2 Features (Not Yet Implemented)

1. **Transfers** - Create transfer page using `rpc_create_transfer`
2. **Adjustments** - Manual adjustments using `rpc_adjust_inventory`
3. **Reservations** - Job-based reservations
4. **Cycle Counts** - Variance approval workflow
5. **Assets** - Serialized asset tracking

### Reference Documents

- **BOUNDED_CONTEXT_SEPARATION.md** - Complete architecture guide
- **BOUNDED_CONTEXT_QUICK_REF.md** - Developer quick reference
- **FRONTEND_CAPABILITIES_ROADMAP.md** - Full feature roadmap (30+ features)

---

## ⚠️ Important Rules

### DO ✅
- Use RPC methods for ALL writes
- Query tables/views directly for reads
- Leverage materialized views for dashboards
- Handle errors from RPCs
- Show real-time availability
- Auto-refresh dashboard data

### DON'T ❌
- Insert/update tables directly
- Skip validation
- Ignore errors
- Mix bounded contexts (use correct RPC service)
- Create duplicate operations (RPCs are idempotent!)

---

## 🎉 Success Metrics

Your MVP frontend now has:

✅ **5 fully functional pages** (CRUD operations)  
✅ **2 dashboard widgets** (real-time KPIs)  
✅ **RPC-first architecture** (clean, atomic)  
✅ **Bounded context aware** (DDD compliance)  
✅ **Idempotent operations** (safe retries)  
✅ **Real-time data** (auto-refresh)  
✅ **Type-safe** (TypeScript throughout)  
✅ **Production-ready** (error handling, validation)  

**You can now:**
- Create catalog items
- Receive inventory (with atomic bridge)
- Issue inventory (with availability checks)
- Create purchase orders
- View stock balances
- Monitor low stock alerts

**Next:** Build Phase 2 features from the roadmap! 🚀

---

*For questions or issues, refer to the comprehensive documentation in BOUNDED_CONTEXT_SEPARATION.md and FRONTEND_CAPABILITIES_ROADMAP.md.*
