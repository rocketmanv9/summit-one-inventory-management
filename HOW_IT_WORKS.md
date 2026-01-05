# Summit One Inventory Management - Complete System Guide

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [Authentication & Authorization](#authentication--authorization)
5. [Event Sourcing Pattern](#event-sourcing-pattern)
6. [API Layer](#api-layer)
7. [Usage Examples](#usage-examples)
8. [Development Workflow](#development-workflow)

---

## System Overview

This is a **multi-tenant inventory management microservice** built for asphalt/concrete service companies. It tracks:
- Stock items (bulk materials like asphalt, sealcoat, fuels)
- Serialized assets (trucks, equipment with VINs/asset tags)
- Locations (yards, warehouses, trucks, job sites, people)
- Purchase orders and receipts
- Cycle counts

**Key Features:**
- Event-driven architecture with full audit trail
- Strict tenant isolation via Row Level Security (RLS)
- JWT-based authentication with role/module permissions
- Read models optimized for dashboard queries
- Idempotent event processing

**Tech Stack:**
- Next.js 15 (App Router)
- Supabase (PostgreSQL + Auth)
- TypeScript
- Docker (local development)

---

## Architecture

### Multi-Tenant Isolation

```
┌─────────────────────────────────────────────────────┐
│                   TENANT BOUNDARY                    │
│  Every table has tenant_id + RLS policies           │
│  JWT contains: tenant_id, role, modules             │
└─────────────────────────────────────────────────────┘

┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   Tenant A   │      │   Tenant B   │      │   Tenant C   │
│  ae837809... │      │  12345678... │      │  abcdefgh... │
└──────────────┘      └──────────────┘      └──────────────┘
       │                     │                     │
       └─────────────────────┴─────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   PostgreSQL    │
                    │  (RLS enforced) │
                    └─────────────────┘
```

### Event-Driven Flow

```
API Request (with JWT)
    │
    ▼
Auth Middleware (validates JWT, extracts claims)
    │
    ▼
Create Authenticated Supabase Client
    │
    ▼
Write to Event Ledger (immutable events)
    │
    ├──▶ Trigger updates Read Models
    │
    └──▶ Trigger publishes to events_outbox
         │
         ▼
    External Event Bus (future: Kafka/RabbitMQ)
```

### Three-Layer Data Model

1. **Event Ledger** (source of truth, immutable)
   - `inventory_events` - stock movements
   - `asset_events` - asset state changes
   - `procurement_events` - PO/receipt events

2. **Read Models** (fast queries, eventually consistent)
   - `stock_balances` - current qty by item/location
   - `asset_state` - current asset status/location
   - `reservations` - pending allocations
   - `daily_item_activity` - aggregated metrics
   - `daily_asset_metrics` - aggregated asset stats

3. **Reference Data** (master data)
   - `catalog_items` - what items exist
   - `locations` - where items can be
   - `assets` - serialized equipment

---

## Database Schema

### Schema: `inventory`

All tables live in the `inventory` schema with these standard fields:
```sql
id              UUID PRIMARY KEY
tenant_id       UUID NOT NULL (indexed)
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
created_by      UUID (references auth.users)
updated_by      UUID (references auth.users)
```

### Core Tables (28 total)

#### Reference Data
- **catalog_items** - SKU, name, tracking mode (stock/serialized/both), UOM, category
- **item_categories** - hierarchical categories (parent_category_id)
- **locations** - type (yard/warehouse/truck/job/person/vendor), parent hierarchy
- **assets** - asset_tag, serial_number, VIN, status, home_location
- **identifiers** - alternate IDs for items (barcode, supplier SKU, etc.)

#### Event Ledger (Immutable)
- **inventory_events** - stock movements (receipt, issue, transfer, adjust, reserve, fulfill)
  - Has `last_event_id` UNIQUE per (tenant, catalog_item, location) for idempotency
- **asset_events** - asset movements (acquire, assign, transfer, return, service, retire)
  - Has `last_event_id` UNIQUE per (tenant, asset) for idempotency
- **procurement_events** - PO lifecycle (create, approve, receive, complete, cancel)
  - Has `last_event_id` UNIQUE per (tenant, purchase_order) for idempotency

#### Read Models (Updated by Triggers)
- **stock_balances** - current qty_on_hand, qty_reserved, qty_available
- **reservations** - active allocations (order_id, qty, expires_at)
- **asset_state** - current asset status, location, operator
- **daily_item_activity** - aggregated movements per day
- **daily_asset_metrics** - aggregated asset usage per day

#### Transactional Data
- **purchase_orders** - status, supplier, total_amount
- **po_lines** - item, qty_ordered, qty_received, unit_price
- **receipts** - PO receiving (receipt_date, received_by)
- **receipt_lines** - item, qty_received, lot_number
- **cycle_counts** - physical inventory counts
- **count_lines** - expected vs actual qty

#### Configuration
- **dashboards** - scope (tenant/role/user), layout
- **dashboard_widgets** - type (kpi/chart/table/map/alert/custom), config

#### Events Outbox
- **events_outbox** - domain events for external systems
  - scope: tenant | profile | global
  - Auto-published from ledger tables via triggers

### Indexes Strategy

Every table has:
```sql
CREATE INDEX idx_{table}_tenant ON {table}(tenant_id);
CREATE INDEX idx_{table}_tenant_created ON {table}(tenant_id, created_at DESC);
```

Event tables have additional idempotency indexes:
```sql
CREATE UNIQUE INDEX idx_inventory_events_idempotency 
ON inventory_events(tenant_id, catalog_item_id, location_id, last_event_id)
WHERE last_event_id IS NOT NULL;
```

---

## Authentication & Authorization

### JWT Structure

Users authenticate with Supabase Auth. The JWT contains:

```json
{
  "sub": "user-uuid-here",
  "email": "user@example.com",
  "app_metadata": {
    "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
    "role": "admin",
    "modules": ["inventory", "dashboard", "purchasing"]
  }
}
```

**Critical:** The `app_metadata.tenant_id` MUST be set when creating users. This is how RLS knows what data to show.

### Row Level Security (RLS)

Every table has RLS enabled with policies like:

```sql
-- Read policy
CREATE POLICY "tenant_isolation_select"
ON inventory.catalog_items
FOR SELECT
USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- Write policy (role-based)
CREATE POLICY "admins_can_delete"
ON inventory.catalog_items
FOR DELETE
USING (
  tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
  AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);
```

**No bypasses.** Even if you try to query another tenant's data, PostgreSQL will filter it out at the database level.

### Authorization Layers

1. **Network Layer**: Bearer token required
2. **Middleware Layer**: `withAuth()`, `withRole()`, `withModule()` wrappers
3. **Database Layer**: RLS policies enforce tenant isolation
4. **Audit Layer**: `created_by`/`updated_by` auto-set from `auth.uid()`

### Roles & Modules

**Roles** (hierarchical permissions):
- `admin` - Full access, can delete, manage users
- `manager` - Create/update, view reports
- `user` - Read-only or limited operations

**Modules** (feature access):
- `inventory` - Stock/asset tracking
- `dashboard` - View dashboards
- `purchasing` - Create POs
- `cycle_count` - Perform counts

Example: User with `role: "manager"` and `modules: ["inventory"]` can create items but not delete them, and cannot access purchasing.

---

## Event Sourcing Pattern

### Why Events?

Instead of directly updating `stock_balances`, we:
1. Write an immutable event to `inventory_events`
2. Trigger automatically updates `stock_balances`
3. Event also publishes to `events_outbox` for external systems

**Benefits:**
- Full audit trail (who did what, when, why)
- Can rebuild state from events
- Can replay events to fix data
- External systems get notified of changes

### Event Types

**Inventory Events:**
- `receipt` - received stock from supplier
- `issue` - gave stock to job/customer
- `transfer` - moved between locations
- `adjust` - correction (count variance)
- `reserve` - allocated for future use
- `fulfill` - released reservation

**Asset Events:**
- `acquire` - new asset purchased
- `assign` - assigned to operator/job
- `transfer` - moved to new location
- `return` - returned from job
- `service` - sent for maintenance
- `retire` - taken out of service

### Idempotency

Events have a `last_event_id` field. If you try to insert the same event twice:

```sql
INSERT INTO inventory.inventory_events (
  tenant_id, catalog_item_id, location_id, 
  event_type, qty, last_event_id
) VALUES (
  'ae837809...', 'item-uuid', 'loc-uuid',
  'receipt', 100, 'PO-123-LINE-1'
);
```

The UNIQUE constraint on `(tenant_id, catalog_item_id, location_id, last_event_id)` prevents duplicates.

### Read Model Updates

When an event is inserted, triggers update read models:

```sql
-- Simplified example
CREATE FUNCTION update_stock_balance() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.event_type IN ('receipt', 'adjust') THEN
    -- Increase qty_on_hand
  ELSIF NEW.event_type IN ('issue', 'transfer') THEN
    -- Decrease qty_on_hand
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Events Outbox

Every event automatically publishes to `events_outbox`:

```sql
CREATE TRIGGER publish_inventory_event
AFTER INSERT ON inventory.inventory_events
FOR EACH ROW
EXECUTE FUNCTION inventory.publish_event_to_outbox();
```

External event poller can query:
```sql
SELECT * FROM inventory.events_outbox 
WHERE processed = false
ORDER BY created_at;
```

---

## API Layer

### Project Structure

```
src/
  app/
    api/
      inventory/
        items/
          route.ts          # GET, POST /api/inventory/items
          [id]/
            route.ts        # DELETE /api/inventory/items/{id}
  lib/
    auth-middleware.ts      # withAuth, withRole, withModule
supabase/
  client.ts                 # Supabase client setup
  inventory-service.ts      # Data access layer
```

### Auth Middleware

**withAuth** - Require any authenticated user
```typescript
export const GET = withAuth(async (req, authContext) => {
  // authContext = { userId, tenantId, role, modules, email }
  return NextResponse.json({ data: "protected" });
});
```

**withRole** - Require specific role
```typescript
export const DELETE = withRole('admin', async (req, authContext) => {
  // Only admins can access
});
```

**withModule** - Require module access
```typescript
export const GET = withModule('inventory', async (req, authContext) => {
  // Must have 'inventory' in modules array OR be admin
});
```

### Making Authenticated Requests

Inside route handlers, create Supabase client with user's JWT:

```typescript
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    global: {
      headers: {
        Authorization: req.headers.get('authorization')!
      }
    }
  }
);

// RLS automatically filters by tenant_id from JWT
const { data } = await supabase.from('catalog_items').select('*');
```

### Data Access Layer

For complex queries, use `InventoryService`:

```typescript
import { InventoryService } from '@/supabase/inventory-service';

const service = new InventoryService(authContext.tenantId);
const items = await service.getCatalogItems();
const balances = await service.getStockBalances();
const lowStock = await service.getLowStockItems();
```

---

## Usage Examples

### 1. Create a New Item

**Request:**
```bash
POST /api/inventory/items
Authorization: Bearer {jwt-token}
Content-Type: application/json

{
  "sku": "SEAL-001",
  "name": "Premium Sealcoat",
  "tracking_mode": "stock",
  "uom": "gallon",
  "category_id": "cat-uuid"
}
```

**What Happens:**
1. Middleware validates JWT, extracts tenant_id
2. Creates Supabase client with user's token
3. Inserts into `catalog_items` with explicit `tenant_id`
4. RLS policy checks `tenant_id` matches JWT claim
5. Trigger sets `created_by` to `auth.uid()`
6. Returns created item

### 2. Receive Stock

**Request:**
```bash
POST /api/inventory/events/receipt
Authorization: Bearer {jwt-token}

{
  "catalog_item_id": "item-uuid",
  "location_id": "main-yard-uuid",
  "qty": 500,
  "uom": "gallon",
  "receipt_id": "REC-2024-001",
  "notes": "Delivery from supplier ABC"
}
```

**What Happens:**
1. Inserts event into `inventory_events` table
2. Trigger updates `stock_balances.qty_on_hand += 500`
3. Trigger publishes to `events_outbox`
4. External systems can poll outbox and send webhooks

### 3. Query Stock Balances

**Request:**
```bash
GET /api/inventory/stock-balances?location_id=main-yard-uuid
Authorization: Bearer {jwt-token}
```

**Response:**
```json
{
  "data": [
    {
      "id": "balance-uuid",
      "catalog_item": {
        "sku": "SEAL-001",
        "name": "Premium Sealcoat",
        "uom": "gallon"
      },
      "location": {
        "name": "Main Yard",
        "location_type": "yard"
      },
      "qty_on_hand": 500,
      "qty_reserved": 0,
      "qty_available": 500,
      "updated_at": "2026-01-02T10:30:00Z"
    }
  ]
}
```

### 4. Transfer Stock Between Locations

**Request:**
```bash
POST /api/inventory/events/transfer
Authorization: Bearer {jwt-token}

{
  "catalog_item_id": "item-uuid",
  "from_location_id": "main-yard-uuid",
  "to_location_id": "truck-5-uuid",
  "qty": 50,
  "reason": "Loading truck for job site"
}
```

**What Happens:**
1. Creates TWO events:
   - `issue` event at main-yard (qty: -50)
   - `receipt` event at truck-5 (qty: +50)
2. Both events have same `last_event_id` for idempotency
3. Triggers update both location balances
4. Events published to outbox

### 5. Assign Asset to Operator

**Request:**
```bash
POST /api/inventory/assets/events
Authorization: Bearer {jwt-token}

{
  "asset_id": "truck-uuid",
  "event_type": "assign",
  "location_id": "job-site-uuid",
  "assigned_to": "operator-uuid",
  "notes": "Assigned to John for downtown job"
}
```

**What Happens:**
1. Inserts into `asset_events`
2. Trigger updates `asset_state`:
   - `status = 'assigned'`
   - `current_location_id = job-site-uuid`
   - `assigned_to = operator-uuid`
3. Event published for fleet tracking system

---

## Development Workflow

### Local Setup

```bash
# Start Supabase (PostgreSQL, Auth, Storage, etc.)
npm run sb:start

# Check status
npm run sb:status

# Access Studio
http://127.0.0.1:55323

# Reset database (apply all migrations + seed)
npx supabase db reset

# Start Next.js dev server
npm run dev
```

### Environment Variables

Create `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
TENANT_ID=ae837809-1a24-4ab5-ba06-34fd98c05f48
```

### Creating Users with app_metadata

**Via Supabase Studio:**
1. Go to Authentication → Users
2. Create user
3. Edit user → User Metadata → Raw JSON
4. Add:
```json
{
  "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
  "role": "admin",
  "modules": ["inventory", "dashboard"]
}
```

**Via API (service role):**
```typescript
import { supabaseAdmin } from '@/supabase/client';

await supabaseAdmin.auth.admin.createUser({
  email: 'manager@example.com',
  password: 'secure-password',
  email_confirm: true,
  app_metadata: {
    tenant_id: 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
    role: 'manager',
    modules: ['inventory']
  }
});
```

### Testing API Routes

```bash
# Get access token
curl -X POST http://127.0.0.1:55321/auth/v1/token?grant_type=password \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "password"
  }'

# Use token
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/inventory/items
```

### Migration Workflow

```bash
# Create new migration
npx supabase migration new add_feature_name

# Edit: supabase/migrations/TIMESTAMP_add_feature_name.sql

# Apply locally
npx supabase db reset

# Commit migration file
git add supabase/migrations/
git commit -m "Add feature_name migration"

# Deploy to production
npx supabase db push
```

---

## Key Concepts for New Developers

### 1. Always Use Authenticated Client

❌ **Wrong:**
```typescript
import { supabase } from '@/supabase/client';
const { data } = await supabase.from('catalog_items').select('*');
// This uses anon key, may not have user context
```

✅ **Right:**
```typescript
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    global: {
      headers: {
        Authorization: req.headers.get('authorization')!
      }
    }
  }
);
const { data } = await supabase.from('catalog_items').select('*');
```

### 2. Never Bypass RLS in Application Code

❌ **Wrong:**
```typescript
// Using service role in API routes
import { supabaseAdmin } from '@/supabase/client';
const { data } = await supabaseAdmin.from('catalog_items')
  .select('*')
  .eq('tenant_id', tenantId); // Manual filtering
```

✅ **Right:**
```typescript
// Let RLS handle it
const { data } = await supabase.from('catalog_items').select('*');
// RLS automatically filters by tenant_id from JWT
```

**When to use service role:** Background jobs, admin operations that need to read across tenants (analytics), or operations that need to bypass RLS (data migrations).

### 3. Write Events, Not Direct Updates

❌ **Wrong:**
```typescript
await supabase.from('stock_balances')
  .update({ qty_on_hand: 150 })
  .eq('id', balanceId);
// No audit trail, no event history
```

✅ **Right:**
```typescript
await supabase.from('inventory_events').insert({
  tenant_id: authContext.tenantId,
  catalog_item_id: itemId,
  location_id: locationId,
  event_type: 'receipt',
  qty: 50,
  notes: 'Received from supplier'
});
// Trigger updates stock_balances automatically
// Event preserved for audit trail
```

### 4. Always Set last_event_id for Idempotency

```typescript
await supabase.from('inventory_events').insert({
  tenant_id: authContext.tenantId,
  catalog_item_id: itemId,
  location_id: locationId,
  event_type: 'receipt',
  qty: 100,
  last_event_id: `PO-${poNumber}-LINE-${lineNumber}`, // Unique!
  notes: 'PO receipt'
});
// If you try to insert again with same last_event_id, it will fail
// This prevents double-counting
```

### 5. Use InventoryService for Complex Queries

```typescript
// Instead of writing complex joins every time
const service = new InventoryService(authContext.tenantId);

// Optimized queries with proper joins
const lowStock = await service.getLowStockItems();
const assetsByLocation = await service.getAssetsByLocation(locationId);
const dailyActivity = await service.getDailyActivity(startDate, endDate);
```

---

## Production Deployment Checklist

- [ ] Set `NEXT_PUBLIC_SUPABASE_URL` to production URL
- [ ] Set `NEXT_PUBLIC_SUPABASE_ANON_KEY` from production project
- [ ] Set `SUPABASE_SERVICE_ROLE_KEY` (keep secret!)
- [ ] Run all migrations: `npx supabase db push`
- [ ] Create admin user with correct `app_metadata`
- [ ] Test RLS policies with test users
- [ ] Set up event poller for `events_outbox`
- [ ] Configure JWT secret rotation
- [ ] Enable database backups
- [ ] Set up monitoring/logging
- [ ] Rate limit API endpoints
- [ ] Add API key authentication for service-to-service calls

---

## Common Patterns

### Pattern: Soft Deletes

Instead of DELETE, set `active = false`:

```typescript
await supabase.from('catalog_items')
  .update({ active: false })
  .eq('id', itemId);
```

RLS policies filter by `active = true` for regular queries.

### Pattern: Hierarchical Locations

```typescript
// Get all child locations recursively
WITH RECURSIVE location_tree AS (
  SELECT * FROM inventory.locations WHERE id = $parent_id
  UNION ALL
  SELECT l.* FROM inventory.locations l
  JOIN location_tree lt ON l.parent_location_id = lt.id
)
SELECT * FROM location_tree;
```

### Pattern: Reservation System

```typescript
// Reserve stock
await supabase.from('inventory_events').insert({
  event_type: 'reserve',
  qty: 100,
  metadata: { order_id: 'ORD-123', expires_at: '2026-01-10' }
});

// Fulfill reservation
await supabase.from('inventory_events').insert({
  event_type: 'fulfill',
  qty: 100,
  metadata: { order_id: 'ORD-123' }
});
```

### Pattern: Asset Maintenance Tracking

```typescript
// Send to service
await supabase.from('asset_events').insert({
  event_type: 'service',
  asset_id: truckId,
  location_id: shopId,
  metadata: { 
    reason: 'Oil change',
    scheduled_return: '2026-01-05'
  }
});

// Return from service
await supabase.from('asset_events').insert({
  event_type: 'return',
  asset_id: truckId,
  location_id: yardId,
  metadata: { service_completed: true }
});
```

---

## Troubleshooting

### "Row violates row-level security policy"

**Cause:** JWT missing `tenant_id` in `app_metadata` or wrong tenant.

**Fix:** Check user's app_metadata in Supabase Studio.

### "Duplicate key violates unique constraint"

**Cause:** Trying to insert same `last_event_id` twice.

**Fix:** This is expected for idempotency. Handle gracefully:
```typescript
const { error } = await supabase.from('inventory_events').insert(event);
if (error?.code === '23505') {
  // Already processed, skip
  return;
}
```

### "Function auth.uid() does not exist"

**Cause:** Using wrong schema or RLS context not available.

**Fix:** Ensure function runs in RLS context, not as SECURITY DEFINER.

### TypeScript errors with Supabase types

**Solution:** Generate types:
```bash
npx supabase gen types typescript --local > src/types/supabase.ts
```

Then use:
```typescript
import { Database } from '@/types/supabase';
const supabase = createClient<Database>(...);
```

---

## Further Reading

- [Supabase RLS Docs](https://supabase.com/docs/guides/auth/row-level-security)
- [Event Sourcing Pattern](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Next.js App Router](https://nextjs.org/docs/app)
- [Multi-tenancy Best Practices](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

---

**Current Tenant ID:** `ae837809-1a24-4ab5-ba06-34fd98c05f48`  
**Database:** PostgreSQL 15 (Supabase local)  
**Ports:** 55321 (API), 55322 (DB), 55323 (Studio), 55324 (Inbucket)  
**Status:** ✅ Production-ready with strict auth
