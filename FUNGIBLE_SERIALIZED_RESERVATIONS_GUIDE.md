# Fungible vs Serialized Reservations - Implementation Guide

## 📋 Schema Audit Summary

### Existing Tables Identified

1. **`inventory.catalog_items`** - SKU/Item definitions
   - Already has `tracking_mode` column with values: `stock`, `serialized`, `both`
   - Extended to support: `fungible`, `hybrid`, `consumable`

2. **`inventory.assets`** - Serialized/tracked items
   - Has: `asset_tag`, `serial_number`, `vin`, `status`
   - Links to `catalog_item_id` and `location_id`
   - Status values: `available`, `assigned`, `in_repair`, `out_of_service`, `retired`

3. **`inventory.stock_balances`** - Fungible stock levels
   - Tracks: `qty_on_hand`, `qty_reserved`, `qty_available` (computed)
   - Per `catalog_item_id` + `location_id` combination

4. **`inventory.reservations`** - Original reservation model
   - Was qty-based only
   - Now supports BOTH fungible and serialized modes

5. **`inventory.locations`** - Where items/assets are stored

6. **Job/Dispatch Linkage**
   - Via `job_ref` (JSONB) and `external_order_ref` (TEXT)
   - Supports `allocation_type`: `job`, `project`, `customer_order`, etc.

### Current Behavior (Before Migration)

- ✅ Reservations were fungible-only (qty-based)
- ✅ Validation checked `stock_balances.qty_available`
- ✅ Updated `qty_reserved` on create/release
- ✅ Idempotent via `last_event_id`
- ✅ Tenant-isolated via RLS
- ❌ No support for asset-specific reservations
- ❌ No time window support
- ❌ No overlap prevention for serialized items

---

## 🔄 Migration Changes (Additive Only)

### New Columns Added to `inventory.reservations`

```sql
-- Asset reservation support
asset_id UUID                       -- References specific asset
reservation_type TEXT NOT NULL      -- 'fungible' or 'serialized'

-- Time window support
reserved_from TIMESTAMP WITH TIME ZONE
reserved_until TIMESTAMP WITH TIME ZONE

-- Additional context
notes TEXT
```

### New Constraints

1. **Mutual Exclusivity** (`chk_reservation_mode_validity`)
   ```sql
   -- Fungible: requires qty + catalog_item_id + location_id, NO asset_id
   -- Serialized: requires asset_id, qty=1 or NULL
   ```

2. **No Overlapping Asset Reservations** (`chk_no_asset_time_overlap`)
   ```sql
   -- Uses PostgreSQL exclusion constraint with tstzrange
   -- Prevents double-booking same asset in overlapping time windows
   ```

### New Indexes

```sql
-- Find available assets
idx_reservations_asset_id_status

-- Fungible reservations by item/location
idx_reservations_fungible_lookup

-- Time window queries
idx_reservations_time_window

-- Expiration cleanup
idx_reservations_expiration
```

### Extended `catalog_items.tracking_mode`

```sql
-- Original: 'stock', 'serialized', 'both'
-- Extended: 'fungible', 'hybrid', 'consumable'
-- Backward compatible
```

---

## 🛡️ RLS Policies

### Existing Policies (Unchanged)

```sql
-- All reads/writes already tenant-isolated
CREATE POLICY reservations_tenant_isolation 
ON inventory.reservations
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY reservations_service_role
ON inventory.reservations
TO service_role
USING (true) WITH CHECK (true);
```

**No changes needed** - tenant isolation already enforced for all reservation types.

---

## 🔧 Core Validation Functions

### 1. Fungible Stock Availability

```sql
SELECT * FROM inventory.validate_fungible_reservation_availability(
    p_tenant_id := 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
    p_catalog_item_id := '...',
    p_location_id := '...',
    p_qty := 5,
    p_exclude_reservation_id := NULL  -- For updates
);
```

**Returns:**
```sql
available_qty | is_available | message
--------------+--------------+------------------------------------------
         12   |     true     | ✓ Available: 12 units of "Rake" at "Yard A"
```

**Features:**
- ✅ Checks `stock_balances.qty_available`
- ✅ Excludes specific reservation (for update scenarios)
- ✅ Returns human-readable messages
- ✅ Concurrency-safe (STABLE function)

### 2. Serialized Asset Availability

```sql
SELECT * FROM inventory.validate_asset_reservation_availability(
    p_tenant_id := 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
    p_asset_id := '...',
    p_reserved_from := '2026-01-28 08:00:00',
    p_reserved_until := '2026-01-28 17:00:00',
    p_exclude_reservation_id := NULL
);
```

**Returns:**
```sql
is_available | conflicting_reservation_id | message
-------------+---------------------------+------------------------------------
    true     |          NULL             | ✓ Asset "T-123" (Trailer) is available
```

**Features:**
- ✅ Checks asset status (must be `available` or `assigned`)
- ✅ Detects overlapping time windows using `tstzrange`
- ✅ Returns conflicting reservation ID if overlap found
- ✅ Supports indefinite reservations (no time window)

---

## 📡 RPC Functions

### Create Fungible Reservation

```sql
SELECT inventory.rpc_inv_reserve_fungible(
    p_tenant_id := 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
    p_catalog_item_id := '...',
    p_location_id := '...',
    p_qty := 6,
    p_allocation_type := 'job',
    p_external_order_ref := 'JOB-123',
    p_needed_by := '2026-01-30',
    p_expiration_date := '2026-01-31',
    p_reserved_from := '2026-01-28 08:00:00',
    p_reserved_until := '2026-01-28 17:00:00',
    p_notes := 'For paving crew A',
    p_last_event_id := 'reserve_fungible_abc123'  -- Idempotency
) AS reservation_id;
```

**Behavior:**
1. ✅ Validates qty > 0
2. ✅ Checks `qty_available >= qty` via validation function
3. ✅ Creates reservation with `reservation_type = 'fungible'`
4. ✅ Updates `stock_balances.qty_reserved += qty`
5. ✅ Publishes `reservation.created.fungible` event
6. ✅ Idempotent on `last_event_id`

**Error Handling:**
- Throws exception if insufficient stock
- ERRCODE: `check_violation`
- Message includes available qty and item/location names

### Create Serialized Asset Reservation

```sql
SELECT inventory.rpc_inv_reserve_asset(
    p_tenant_id := 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
    p_asset_id := '...',
    p_allocation_type := 'job',
    p_external_order_ref := 'JOB-123',
    p_needed_by := '2026-01-30',
    p_reserved_from := '2026-01-28 08:00:00',
    p_reserved_until := '2026-01-28 17:00:00',
    p_notes := 'Trailer for site delivery',
    p_last_event_id := 'reserve_asset_xyz789'
) AS reservation_id;
```

**Behavior:**
1. ✅ Validates asset exists and belongs to tenant
2. ✅ Checks asset status is `available` or `assigned`
3. ✅ Checks no overlapping reservations (time window)
4. ✅ Creates reservation with `reservation_type = 'serialized'`, `qty = 1`
5. ✅ Updates asset status to `assigned`
6. ✅ Publishes `reservation.created.serialized` event
7. ✅ Idempotent on `last_event_id`

**Error Handling:**
- Throws exception if asset unavailable or double-booked
- Returns conflicting reservation details
- ERRCODE: `check_violation`

### Find Available Assets

```sql
SELECT * FROM inventory.rpc_inv_find_available_assets(
    p_tenant_id := 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
    p_catalog_item_id := '...',  -- Type of asset (e.g., "Trailer")
    p_location_id := '...',      -- Optional: filter by location
    p_reserved_from := '2026-01-28 08:00:00',
    p_reserved_until := '2026-01-28 17:00:00',
    p_limit := 50
);
```

**Returns:**
```sql
asset_id | asset_tag | serial_number | status    | location_id | location_name | is_available
---------+-----------+--------------+-----------+-------------+---------------+--------------
...      | T-001     | VIN123       | available | ...         | Yard A        | true
...      | T-002     | VIN456       | assigned  | ...         | Yard B        | false
```

**Use Cases:**
- Asset picker UI component
- Availability dashboard
- Job planning tools

---

## 📊 Event-Driven Behavior

### Events Published

1. **`reservation.created.fungible`**
   ```json
   {
     "reservation_id": "uuid",
     "reservation_type": "fungible",
     "catalog_item_id": "uuid",
     "location_id": "uuid",
     "qty": 6,
     "allocation_type": "job",
     "external_order_ref": "JOB-123",
     "reserved_from": "2026-01-28T08:00:00Z",
     "reserved_until": "2026-01-28T17:00:00Z"
   }
   ```

2. **`reservation.created.serialized`**
   ```json
   {
     "reservation_id": "uuid",
     "reservation_type": "serialized",
     "asset_id": "uuid",
     "asset_tag": "T-123",
     "catalog_item_id": "uuid",
     "location_id": "uuid",
     "allocation_type": "job",
     "external_order_ref": "JOB-123",
     "reserved_from": "2026-01-28T08:00:00Z",
     "reserved_until": "2026-01-28T17:00:00Z"
   }
   ```

### Idempotency

- All RPCs use `last_event_id` as idempotency key
- `ON CONFLICT (tenant_id, last_event_id) DO NOTHING`
- Webhook handlers can safely retry

### Fail-Safe Logic

```sql
-- If validation fails, transaction rolls back
-- Event remains pending in outbox
-- No partial updates (atomic transactions)
```

---

## 🎨 API/UI Implementation Guide

### API Endpoints (Suggested)

#### 1. Create Reservation (Unified Endpoint)

**POST** `/api/inventory/reservations`

```typescript
interface CreateReservationRequest {
  // Required for all
  allocation_type?: 'job' | 'project' | 'customer_order' | 'internal_order';
  external_order_ref?: string;
  needed_by?: string; // ISO date
  expiration_date?: string;
  notes?: string;
  
  // Time window (optional)
  reserved_from?: string; // ISO datetime
  reserved_until?: string;
  
  // Fungible-specific
  fungible?: {
    catalog_item_id: string;
    location_id: string;
    qty: number;
  };
  
  // Serialized-specific
  serialized?: {
    asset_id: string;
  };
}
```

**Implementation:**
```typescript
export async function POST(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  const body = await request.json();
  const supabase = createClient();
  
  if (body.fungible) {
    const { data, error } = await supabase.rpc('rpc_inv_reserve_fungible', {
      p_tenant_id: tenantId,
      p_catalog_item_id: body.fungible.catalog_item_id,
      p_location_id: body.fungible.location_id,
      p_qty: body.fungible.qty,
      p_allocation_type: body.allocation_type,
      p_external_order_ref: body.external_order_ref,
      p_needed_by: body.needed_by,
      p_expiration_date: body.expiration_date,
      p_reserved_from: body.reserved_from,
      p_reserved_until: body.reserved_until,
      p_notes: body.notes,
      p_last_event_id: `web_reserve_${crypto.randomUUID()}`
    });
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    return NextResponse.json({ data, reservation_id: data });
  }
  
  if (body.serialized) {
    const { data, error } = await supabase.rpc('rpc_inv_reserve_asset', {
      p_tenant_id: tenantId,
      p_asset_id: body.serialized.asset_id,
      p_allocation_type: body.allocation_type,
      p_external_order_ref: body.external_order_ref,
      p_needed_by: body.needed_by,
      p_expiration_date: body.expiration_date,
      p_reserved_from: body.reserved_from,
      p_reserved_until: body.reserved_until,
      p_notes: body.notes,
      p_last_event_id: `web_reserve_${crypto.randomUUID()}`
    });
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    return NextResponse.json({ data, reservation_id: data });
  }
  
  return NextResponse.json(
    { error: 'Must specify either fungible or serialized' },
    { status: 400 }
  );
}
```

#### 2. Get Available Assets

**GET** `/api/inventory/assets/available?catalog_item_id=...&location_id=...&from=...&until=...`

```typescript
export async function GET(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  const { searchParams } = new URL(request.url);
  const supabase = createClient();
  
  const { data, error } = await supabase.rpc('rpc_inv_find_available_assets', {
    p_tenant_id: tenantId,
    p_catalog_item_id: searchParams.get('catalog_item_id'),
    p_location_id: searchParams.get('location_id'),
    p_reserved_from: searchParams.get('from'),
    p_reserved_until: searchParams.get('until'),
    p_limit: parseInt(searchParams.get('limit') || '50')
  });
  
  return NextResponse.json({ data });
}
```

#### 3. Validate Availability (Pre-Check)

**POST** `/api/inventory/reservations/validate`

```typescript
export async function POST(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  const body = await request.json();
  const supabase = createClient();
  
  if (body.fungible) {
    const { data, error } = await supabase.rpc(
      'validate_fungible_reservation_availability',
      {
        p_tenant_id: tenantId,
        p_catalog_item_id: body.fungible.catalog_item_id,
        p_location_id: body.fungible.location_id,
        p_qty: body.fungible.qty
      }
    );
    
    return NextResponse.json({ data });
  }
  
  if (body.serialized) {
    const { data, error } = await supabase.rpc(
      'validate_asset_reservation_availability',
      {
        p_tenant_id: tenantId,
        p_asset_id: body.serialized.asset_id,
        p_reserved_from: body.reserved_from,
        p_reserved_until: body.reserved_until
      }
    );
    
    return NextResponse.json({ data });
  }
}
```

### UI Components

#### Reservation Form Component

```typescript
'use client';

import { useState, useEffect } from 'react';

interface ReservationFormProps {
  jobRef?: string;
  onSuccess: (reservationId: string) => void;
}

export function ReservationForm({ jobRef, onSuccess }: ReservationFormProps) {
  const [mode, setMode] = useState<'fungible' | 'serialized'>('fungible');
  const [catalogItem, setCatalogItem] = useState<string>('');
  const [trackingMode, setTrackingMode] = useState<string>('');
  
  // Fetch catalog item details
  useEffect(() => {
    if (catalogItem) {
      fetch(`/api/inventory/catalog-items/${catalogItem}`)
        .then(res => res.json())
        .then(data => {
          setTrackingMode(data.tracking_mode);
          
          // Auto-select mode based on tracking_mode
          if (data.tracking_mode === 'serialized') {
            setMode('serialized');
          } else if (data.tracking_mode === 'fungible' || data.tracking_mode === 'stock') {
            setMode('fungible');
          }
          // 'hybrid' allows user choice
        });
    }
  }, [catalogItem]);
  
  return (
    <form onSubmit={handleSubmit}>
      {/* Step 1: Select Item */}
      <ItemPicker 
        value={catalogItem}
        onChange={setCatalogItem}
      />
      
      {/* Step 2: Show appropriate fields based on tracking_mode */}
      {trackingMode === 'hybrid' && (
        <RadioGroup value={mode} onChange={setMode}>
          <Radio value="fungible">Reserve Quantity</Radio>
          <Radio value="serialized">Reserve Specific Asset</Radio>
        </RadioGroup>
      )}
      
      {mode === 'fungible' ? (
        <FungibleFields
          catalogItemId={catalogItem}
          onSubmit={onSuccess}
        />
      ) : (
        <SerializedFields
          catalogItemId={catalogItem}
          onSubmit={onSuccess}
        />
      )}
    </form>
  );
}

function FungibleFields({ catalogItemId, onSubmit }) {
  const [location, setLocation] = useState('');
  const [qty, setQty] = useState(1);
  const [available, setAvailable] = useState<number | null>(null);
  
  // Check availability when location/qty changes
  useEffect(() => {
    if (catalogItemId && location && qty > 0) {
      fetch('/api/inventory/reservations/validate', {
        method: 'POST',
        body: JSON.stringify({
          fungible: {
            catalog_item_id: catalogItemId,
            location_id: location,
            qty: qty
          }
        })
      })
      .then(res => res.json())
      .then(data => setAvailable(data.data[0]?.available_qty));
    }
  }, [catalogItemId, location, qty]);
  
  return (
    <>
      <LocationPicker value={location} onChange={setLocation} />
      <Input 
        type="number" 
        value={qty} 
        onChange={e => setQty(Number(e.target.value))}
        label="Quantity"
      />
      
      {available !== null && (
        <div className={available >= qty ? 'text-green-600' : 'text-red-600'}>
          {available >= qty ? '✓' : '✗'} {available} units available
        </div>
      )}
      
      <Button type="submit" disabled={available === null || available < qty}>
        Reserve {qty} Units
      </Button>
    </>
  );
}

function SerializedFields({ catalogItemId, onSubmit }) {
  const [assets, setAssets] = useState([]);
  const [selectedAsset, setSelectedAsset] = useState('');
  const [timeWindow, setTimeWindow] = useState({ from: '', until: '' });
  
  // Fetch available assets
  useEffect(() => {
    if (catalogItemId) {
      const params = new URLSearchParams({
        catalog_item_id: catalogItemId,
        ...(timeWindow.from && { from: timeWindow.from }),
        ...(timeWindow.until && { until: timeWindow.until })
      });
      
      fetch(`/api/inventory/assets/available?${params}`)
        .then(res => res.json())
        .then(data => setAssets(data.data));
    }
  }, [catalogItemId, timeWindow]);
  
  return (
    <>
      <DateTimeRangePicker
        value={timeWindow}
        onChange={setTimeWindow}
        label="Reservation Period (Optional)"
      />
      
      <AssetPicker
        assets={assets}
        value={selectedAsset}
        onChange={setSelectedAsset}
        renderAsset={(asset) => (
          <div>
            <strong>{asset.asset_tag}</strong>
            {asset.serial_number && <span> - {asset.serial_number}</span>}
            <span className={asset.is_available ? 'text-green-600' : 'text-red-600'}>
              {asset.is_available ? ' ✓ Available' : ' ✗ Reserved'}
            </span>
          </div>
        )}
      />
      
      <Button 
        type="submit" 
        disabled={!selectedAsset || !assets.find(a => a.asset_id === selectedAsset)?.is_available}
      >
        Reserve Asset
      </Button>
    </>
  );
}
```

---

## ✅ Acceptance Criteria Validation

### 1. ✅ Reserve 6 rakes without choosing specific instances

```sql
-- Test query
SELECT inventory.rpc_inv_reserve_fungible(
    p_tenant_id := 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
    p_catalog_item_id := (SELECT id FROM inventory.catalog_items WHERE sku = 'RAKE-001'),
    p_location_id := (SELECT id FROM inventory.locations WHERE name = 'Trailer 12'),
    p_qty := 6,
    p_external_order_ref := 'JOB-123'
);

-- Verify
SELECT * FROM inventory.v_reservation_summary
WHERE reservation_type = 'fungible' AND qty = 6;
```

**Result:** ✅ Creates fungible reservation, updates `qty_reserved`, no asset_id

### 2. ✅ Reserve Trailer A and prevent double-booking

```sql
-- First reservation
SELECT inventory.rpc_inv_reserve_asset(
    p_tenant_id := 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
    p_asset_id := (SELECT id FROM inventory.assets WHERE asset_tag = 'TRAILER-A'),
    p_reserved_from := '2026-01-28 08:00:00',
    p_reserved_until := '2026-01-28 17:00:00',
    p_external_order_ref := 'JOB-123'
);
-- SUCCESS

-- Second reservation (overlapping time)
SELECT inventory.rpc_inv_reserve_asset(
    p_tenant_id := 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
    p_asset_id := (SELECT id FROM inventory.assets WHERE asset_tag = 'TRAILER-A'),
    p_reserved_from := '2026-01-28 12:00:00',
    p_reserved_until := '2026-01-28 20:00:00',
    p_external_order_ref := 'JOB-456'
);
-- ERROR: Asset already reserved from 08:00 to 17:00
```

**Result:** ✅ Exclusion constraint prevents overlap

### 3. ✅ Tenant isolation via RLS

```sql
-- Tenant A creates reservation
-- Tenant B cannot see or modify it (RLS enforces tenant_id match)
```

**Result:** ✅ Existing RLS policies enforce isolation

### 4. ✅ Idempotency for webhook retries

```sql
-- First attempt
SELECT inventory.rpc_inv_reserve_fungible(..., p_last_event_id := 'evt_123');
-- Returns: new_uuid

-- Retry (same event_id)
SELECT inventory.rpc_inv_reserve_fungible(..., p_last_event_id := 'evt_123');
-- Returns: same_uuid (no duplicate created)
```

**Result:** ✅ ON CONFLICT DO NOTHING on `last_event_id`

### 5. ✅ Additive migration (no table recreation)

```sql
-- Migration uses ALTER TABLE ADD COLUMN IF NOT EXISTS
-- No DROP TABLE or TRUNCATE statements
-- Backfills existing data with defaults
```

**Result:** ✅ Zero downtime, backward compatible

---

## 🔍 Query Examples

### Dashboard: Reservations by Type

```sql
SELECT 
    reservation_type,
    status,
    COUNT(*) AS count,
    SUM(CASE WHEN reservation_type = 'fungible' THEN qty ELSE 0 END) AS total_qty_reserved
FROM inventory.reservations
WHERE tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
GROUP BY reservation_type, status;
```

### Find All Reservations for a Job

```sql
SELECT * FROM inventory.v_reservation_summary
WHERE tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
  AND external_order_ref = 'JOB-123'
ORDER BY created_at DESC;
```

### Expiring Reservations (Cleanup)

```sql
SELECT * FROM inventory.reservations
WHERE tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
  AND status = 'active'
  AND expiration_date IS NOT NULL
  AND expiration_date < CURRENT_DATE;

-- Auto-expire them
UPDATE inventory.reservations
SET status = 'expired'
WHERE tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
  AND status = 'active'
  AND expiration_date < CURRENT_DATE;
```

### Asset Utilization Report

```sql
SELECT 
    a.asset_tag,
    a.serial_number,
    ci.name AS item_type,
    COUNT(r.id) AS reservation_count,
    MAX(r.reserved_until) AS last_reservation_end
FROM inventory.assets a
LEFT JOIN inventory.catalog_items ci ON ci.id = a.catalog_item_id
LEFT JOIN inventory.reservations r ON r.asset_id = a.id AND r.status = 'active'
WHERE a.tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
GROUP BY a.id, a.asset_tag, a.serial_number, ci.name
ORDER BY reservation_count DESC;
```

---

## 🚀 Next Steps

1. **Frontend Implementation**
   - Build reservation form components
   - Add asset picker with availability filter
   - Implement time window selector

2. **Webhooks/Integration**
   - Listen for `reservation.created.*` events
   - Sync to job management system
   - Send notifications on double-booking attempts

3. **Reports**
   - Asset utilization dashboard
   - Reservation forecast (upcoming)
   - Expiration warnings

4. **Testing**
   - Load test exclusion constraints under concurrency
   - Verify time zone handling in `tstzrange`
   - Test idempotency with network failures

---

## 📞 Support

For questions or issues:
- Check view: `inventory.v_reservation_summary`
- Validate before create: `validate_*_availability()` functions
- Test queries in SQL editor before UI implementation
