# SUMMIT ONE INVENTORY MICROSERVICE - PRODUCTION AUDIT REPORT
**Date:** January 19, 2026  
**Auditor:** Summit Inventory Engineer  
**Version:** 1.0.0

---

## 1. CURRENT STATE SNAPSHOT

### A) Database Inventory

#### Core Inventory Tables (inventory schema)

| Table | Tenant ID | last_event_id | created/updated_at | RLS | Missing/Issues |
|-------|-----------|--------------|-------------------|-----|----------------|
| `inventory_movements` | ✅ | ✅ UUID UNIQUE | ✅ created_at | ✅ | None |
| `inventory_stock` | ✅ | ❌ | ✅ updated_at | ✅ | No idempotency (read model) |
| `inventory_reservations` | ✅ | ✅ UUID UNIQUE | ✅ both | ✅ | None |
| `inventory_events` | ✅ | ✅ TEXT UNIQUE | ✅ both | ✅ | None |
| `asset_events` | ✅ | ✅ TEXT UNIQUE | ✅ both | ✅ | None |
| `procurement_events` | ✅ | ✅ TEXT UNIQUE | ✅ both | ✅ | None |
| `catalog_items` | ✅ | ❌ | ✅ both | ✅ | Reference table - no events |
| `assets` | ✅ | ❌ | ✅ both | ✅ | Reference table - no events |
| `locations` | ✅ | ❌ | ✅ both | ✅ | Reference table - no events |
| `item_categories` | ✅ | ❌ | ✅ both | ✅ | Reference table - no events |
| `identifiers` | ✅ | ❌ | ✅ both | ✅ | Lookup table - no events |
| `stock_balances` | ✅ | ❌ | ✅ updated_at | ✅ | Read model (rebuilt from events) |
| `reservations` | ✅ | ✅ TEXT UNIQUE | ✅ both | ✅ | None |
| `asset_state` | ✅ | ❌ | ✅ updated_at | ✅ | Read model (rebuilt from events) |
| `daily_item_activity` | ✅ | ❌ | ✅ updated_at | ✅ | Aggregation table |
| `daily_asset_metrics` | ✅ | ❌ | ✅ updated_at | ✅ | Aggregation table |
| `purchase_orders` | ✅ | ⚠️ | ✅ both | ✅ | Missing last_event_id |
| `purchase_order_lines` | ✅ | ⚠️ | ✅ both | ✅ | Missing last_event_id |
| `receipts` | ✅ | ✅ TEXT UNIQUE | ✅ both | ✅ | None |
| `receipt_lines` | ✅ | ❌ | ✅ both | ✅ | Line items don't need idempotency |
| `cycle_counts` | ✅ | ❌ | ✅ both | ✅ | Missing last_event_id |
| `cycle_count_lines` | ✅ | ❌ | ✅ both | ✅ | Line items don't need idempotency |
| `vendors` | ✅ | ❌ | ✅ both | ✅ | Reference table - no events |
| `vendor_items` | ✅ | ❌ | ✅ both | ✅ | Reference table - no events |
| `stock_movements` | ✅ | ✅ TEXT UNIQUE | ✅ both | ✅ | None |
| `accounting_expenses` | ✅ | ✅ TEXT UNIQUE | ✅ both | ✅ | None |
| `inventory_item_aliases` | ✅ | ⚠️ | ✅ both | ✅ | Missing last_event_id |
| `inventory_reason_codes` | ✅ | ⚠️ | ✅ both | ✅ | Missing last_event_id |
| `inventory_ai_suggestions` | ✅ | ✅ UUID UNIQUE | ✅ both | ✅ | None |
| `inventory_decision_traces` | ✅ | ✅ UUID UNIQUE | ✅ both | ✅ | None |
| `inventory_reorder_rules` | ✅ | ❌ | ✅ both | ✅ | Configuration table |

#### Dashboard/UI Tables (public schema)

| Table | Tenant ID | last_event_id | created/updated_at | RLS | Missing/Issues |
|-------|-----------|--------------|-------------------|-----|----------------|
| `dashboards` | ✅ | ❌ | ✅ both | ✅ | UI config - no events |
| `dashboard_widgets` | ✅ | ❌ | ✅ both | ✅ | UI config - no events |
| `widget_registry` | ❌ | ❌ | ✅ both | ✅ | Global registry (no tenant) |
| `tenants` | ✅ | ⚠️ | ✅ both | ❌ | Missing RLS! |

#### Event Infrastructure (public/inventory schemas)

| Table | Tenant ID | last_event_id | created/updated_at | RLS | Missing/Issues |
|-------|-----------|--------------|-------------------|-----|----------------|
| `events_outbox` | ✅ | ❌ | ✅ created_at | ✅ | Outbox pattern |
| `processed_events` | ✅ | ✅ delivery_id UNIQUE | ✅ processed_at | ❌ | Missing RLS! |
| `event_definitions` | ❌ | ❌ | ✅ both | ❌ | Global catalog, no RLS |
| `event_consumers` | ❌ | ❌ | ✅ both | ❌ | Global catalog, no RLS |
| `summit_config` | ❌ | ❌ | ✅ both | ❌ | Global config, no RLS |
| `events_dead_letter` | ✅ | ❌ | ✅ created_at | ❌ | Missing RLS! |

### B) RLS Policy Analysis

**✅ CORRECT RLS (tenant-scoped)**
- All `inventory.*` tables have proper `tenant_id` RLS policies
- Format: `USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID)`
- Service role has bypass policies where needed

**❌ MISSING/WEAK RLS**
1. `public.tenants` - Has tenant_id but **NO RLS ENABLED**
2. `public.processed_events` - Has tenant_id but **NO RLS ENABLED**  
3. `public.events_dead_letter` - Has tenant_id but **NO RLS ENABLED**
4. `public.widget_registry` - Global table (acceptable)
5. `public.event_definitions` - Global catalog (acceptable)
6. `public.event_consumers` - Global catalog (acceptable)
7. `public.summit_config` - Global config (acceptable)

**⚠️ AUTH METHOD RISK**
- Current auth uses **cookie-based sessions** with `inventory_session` cookie
- JWT claim extraction (`auth.jwt() ->> 'tenant_id'`) **WILL FAIL** with cookie sessions
- RLS policies expect Supabase JWT but dev environment uses custom session cookies

### C) Functions / RPCs / Triggers / Cron

#### RPCs (inventory schema)
- `inventory.publish_event()` - Creates outbox events (SECURITY DEFINER) ✅
- `inventory.insert_inventory_event()` - Idempotent insert (SECURITY DEFINER) ✅
- `inventory.insert_asset_event()` - Idempotent insert (SECURITY DEFINER) ✅
- `inventory.prevent_movement_modification()` - Append-only enforcer ✅

#### RPCs (public schema)
- `public.poll_inventory_events()` - Poller event fetcher ✅
- `public.update_event_status()` - Event status updater ✅
- `public.set_session_context()` - Session variable setter (SECURITY DEFINER) ⚠️
- `public.current_tenant_id()` - Gets tenant from session ⚠️

#### Triggers
- `prevent_movements_modification` - Blocks UPDATE/DELETE on movements ledger ✅
- `emit_inventory_event_to_outbox` - Auto-publishes to outbox ✅
- `update_*_updated_at` - Auto-updates timestamps on all tables ✅

#### Cron Jobs
- **❌ NO CRON CONFIGURED** - Events poller not scheduled
- Expected: `pg_cron` or Supabase cron running events-poller every 1 minute

### D) Edge Functions

**Located:** `supabase/functions/events-poller/`

**Purpose:** Poll `inventory.events_outbox` and publish events to webhooks/Core

**Status:** ✅ Function exists but ❌ **NOT SCHEDULED**

**Issues:**
1. No cron trigger configured
2. Uses `rpc('poll_inventory_events')` which exists ✅
3. Uses `rpc('update_event_status')` which exists ✅
4. Requires `EVENTS_WEBHOOK_URL` env var (not documented)

**AuthGate Status:** ❌ **NOT IMPLEMENTED**
- No `/auth/callback` Edge Function found
- Current auth uses **dev-login bypass** (cookie session)
- No SSO token exchange from Core
- AuthGate component redirects to `/dev-login` in development
- Production would redirect to Core but has no callback handler

### E) Event Model

**Event Catalog:** ✅ `public.event_definitions` exists
- Contains event registry with schema, scope, producer

**Ingestion Tables:** ✅ Properly structured
- `inventory.inventory_events` (last_event_id TEXT UNIQUE)
- `inventory.asset_events` (last_event_id TEXT UNIQUE)
- `inventory.procurement_events` (last_event_id TEXT UNIQUE)
- `inventory.inventory_movements` (last_event_id UUID UNIQUE)
- `inventory.inventory_reservations` (last_event_id UUID UNIQUE)

**Outbox/Poller:** ✅ Implemented
- `inventory.events_outbox` table with status lifecycle
- `public.events_outbox` duplicate (schema confusion? ⚠️)

**Status Lifecycle:**
- `pending` → `published` → done
- `pending` → (retry N times) → `failed`
- Retry count tracked in `retry_count` column
- `MAX_ATTEMPTS = 5` in poller
- Dead letter queue: `public.events_dead_letter`

**Idempotency Implementation:**
- ✅ `last_event_id` with UNIQUE constraints on all ledger tables
- ✅ `ON CONFLICT (tenant_id, last_event_id) DO NOTHING` in insert functions
- ✅ `processed_events.delivery_id` for webhook deduplication

---

## 2. SCORECARD

| Area | Status | Risk | What's Missing (exact) |
|------|--------|------|----------------------|
| **Multitenancy + RLS** | ⚠️ | **HIGH** | `tenants`, `processed_events`, `events_dead_letter` missing RLS. Cookie auth breaks JWT-based RLS. |
| **Idempotent ingestion (last_event_id unique)** | ✅ | Low | All ledger tables have it. Missing on `purchase_orders`, `cycle_counts`, `inventory_item_aliases`, `inventory_reason_codes`. |
| **AuthGate exchange via Edge Function** | ❌ | **CRITICAL** | No `/auth/callback` Edge Function. Using dev-login bypass only. No SSO token exchange. |
| **Poller + cron schedule + retries** | ⚠️ | **HIGH** | Edge Function exists but **NOT SCHEDULED**. No cron trigger. Retry logic exists. |
| **Core inventory objects (items, locations, lots, assets)** | ✅ | Low | All tables exist with proper structure. |
| **Transactions + statuses (on hand, reserved, ordered, etc.)** | ✅ | Low | `inventory_movements` ledger + `inventory_stock` read model. Reservation system complete. |
| **Vendor purchasing + receiving workflow** | ⚠️ | Medium | PO/receipt tables exist but **missing last_event_id** on `purchase_orders` and `purchase_order_lines`. |
| **Assignments (assets to employees/crews/jobs)** | ⚠️ | Medium | `asset_events` supports it. Missing dedicated `assignments` tracking table. Metadata only. |
| **Auditability (ledger / immutable movements)** | ✅ | Low | Append-only ledger with trigger enforcement. All events timestamped and audit-trailed. |
| **"AI-ready" schema (clean views, denorm read models)** | ✅ | Low | Read models exist: `inventory_stock`, `asset_state`, `stock_balances`, `daily_*` aggregations. AI tables present. |

---

## 3. NEXT WORK PLAN (Phased Execution)

### **PHASE 0: CRITICAL SECURITY FIXES** ⚠️ DO FIRST
**Goal:** Fix auth vulnerabilities and RLS gaps

**SQL Migrations Required:**
```sql
-- File: 20260120000000_fix_rls_gaps.sql

-- Enable RLS on public.tenants
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenants_tenant_isolation ON public.tenants
    FOR ALL
    USING (id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE POLICY tenants_service_role ON public.tenants
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Enable RLS on public.processed_events
ALTER TABLE public.processed_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY processed_events_tenant_isolation ON public.processed_events
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID OR tenant_id IS NULL);

CREATE POLICY processed_events_service_role ON public.processed_events
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Enable RLS on public.events_dead_letter
ALTER TABLE public.events_dead_letter ENABLE ROW LEVEL SECURITY;

CREATE POLICY events_dead_letter_tenant_isolation ON public.events_dead_letter
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE POLICY events_dead_letter_service_role ON public.events_dead_letter
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);
```

**RLS Policies Required:** See above

**Acceptance Tests:**
```sql
-- Test as non-service role user
SET ROLE authenticated;
SELECT set_session_context('<test-tenant-id>', '<test-user-id>', 'user');
SELECT COUNT(*) FROM public.tenants; -- Should only see own tenant
SELECT COUNT(*) FROM public.processed_events; -- Should only see own events
```

**Risk:** **CRITICAL** - Current setup allows cross-tenant data leaks

---

### **PHASE 1: AUTH GATE IMPLEMENTATION**
**Goal:** Replace dev-login with proper SSO exchange

**Edge Function Required:**
```typescript
// File: supabase/functions/auth-callback/index.ts

import { createClient } from '@supabase/supabase-js'

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const coreToken = url.searchParams.get('core_token')
  const coreEnv = url.searchParams.get('core_env')
  
  if (!coreToken) {
    return new Response('Missing core_token', { status: 400 })
  }
  
  // Validate token with Core API
  const coreUrl = coreEnv === 'production' 
    ? 'https://summit-one.app'
    : 'https://dev.summit-one.app'
    
  const validateRes = await fetch(`${coreUrl}/api/auth/validate`, {
    headers: { 'Authorization': `Bearer ${coreToken}` }
  })
  
  if (!validateRes.ok) {
    return new Response('Invalid token', { status: 401 })
  }
  
  const user = await validateRes.json()
  
  // Create Supabase session
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const { data, error } = await supabase.auth.admin.createUser({
    email: user.email,
    user_metadata: {
      tenant_id: user.tenant_id,
      role: user.role,
      full_name: user.full_name
    }
  })
  
  if (error) {
    console.error('Failed to create user:', error)
    return new Response('Auth failed', { status: 500 })
  }
  
  // Generate session token
  const { data: session } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email
  })
  
  // Redirect to app with session
  return new Response(null, {
    status: 302,
    headers: {
      'Location': `/dashboard?access_token=${session.properties.access_token}`,
      'Set-Cookie': `sb-access-token=${session.properties.access_token}; Path=/; HttpOnly; Secure; SameSite=Lax`
    }
  })
})
```

**App Router Middleware Required:**
```typescript
// File: src/middleware.ts

import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })
  
  const { data: { session } } = await supabase.auth.getSession()
  
  if (!session && !req.nextUrl.pathname.startsWith('/auth')) {
    const coreUrl = process.env.NEXT_PUBLIC_CORE_URL
    return NextResponse.redirect(`${coreUrl}/dashboard`)
  }
  
  return res
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)']
}
```

**Acceptance Tests:**
1. Navigate to app → redirect to Core
2. Core redirects back to `/auth/callback?core_token=X`
3. Exchange creates Supabase session with JWT containing `tenant_id`
4. RLS policies now work with `auth.jwt() ->> 'tenant_id'`

**Risk:** **CRITICAL** - Without this, production auth is broken

---

### **PHASE 2: POLLER SCHEDULING**
**Goal:** Enable automatic event publishing

**Supabase Configuration Required:**
```bash
# Add to supabase/config.toml

[functions.events-poller]
verify_jwt = false

[edge_runtime.policies.events-poller]
allowed_origins = []

# Schedule in Supabase dashboard or CLI:
# Go to Edge Functions → events-poller → Add Cron Trigger
# Schedule: */1 * * * * (every minute)
```

**Environment Variables Required:**
```bash
# Add to .env (project settings)
EVENTS_WEBHOOK_URL=https://dev.summit-one.app/api/webhooks/inventory
```

**Acceptance Tests:**
1. Insert test event into `inventory.events_outbox` with status='pending'
2. Wait 1 minute
3. Verify event status changed to 'published'
4. Check webhook received payload

**Risk:** Medium - Events accumulate but don't publish

---

### **PHASE 3: COMPLETE IDEMPOTENCY**
**Goal:** Add missing last_event_id fields

**SQL Migrations Required:**
```sql
-- File: 20260120000001_add_missing_idempotency.sql

-- Add to purchase_orders
ALTER TABLE inventory.purchase_orders 
ADD COLUMN IF NOT EXISTS last_event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_tenant_last_event_id_unique
ON inventory.purchase_orders(tenant_id, last_event_id)
WHERE last_event_id IS NOT NULL;

-- Add to purchase_order_lines  
ALTER TABLE inventory.purchase_order_lines
ADD COLUMN IF NOT EXISTS last_event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_lines_tenant_last_event_id_unique
ON inventory.purchase_order_lines(tenant_id, last_event_id)
WHERE last_event_id IS NOT NULL;

-- Add to cycle_counts
ALTER TABLE inventory.cycle_counts
ADD COLUMN IF NOT EXISTS last_event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS cycle_counts_tenant_last_event_id_unique
ON inventory.cycle_counts(tenant_id, last_event_id)
WHERE last_event_id IS NOT NULL;

-- Add to inventory_item_aliases
ALTER TABLE inventory.inventory_item_aliases
ADD COLUMN IF NOT EXISTS last_event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_item_aliases_tenant_last_event_id_unique
ON inventory.inventory_item_aliases(tenant_id, last_event_id)
WHERE last_event_id IS NOT NULL;

-- Add to inventory_reason_codes
ALTER TABLE inventory.inventory_reason_codes
ADD COLUMN IF NOT EXISTS last_event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_reason_codes_tenant_last_event_id_unique
ON inventory.inventory_reason_codes(tenant_id, last_event_id)
WHERE last_event_id IS NOT NULL;
```

**RPC Updates Required:**
```sql
-- Create idempotent insert functions for each table
CREATE OR REPLACE FUNCTION inventory.upsert_purchase_order(
    p_tenant_id UUID,
    p_last_event_id TEXT,
    p_po_number TEXT,
    -- ... other params
) RETURNS UUID AS $$
DECLARE
    v_po_id UUID;
BEGIN
    INSERT INTO inventory.purchase_orders (
        tenant_id, po_number, last_event_id, ...
    ) VALUES (
        p_tenant_id, p_po_number, p_last_event_id, ...
    )
    ON CONFLICT (tenant_id, last_event_id) WHERE last_event_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_po_id;
    
    IF v_po_id IS NULL THEN
        SELECT id INTO v_po_id
        FROM inventory.purchase_orders
        WHERE tenant_id = p_tenant_id AND last_event_id = p_last_event_id;
    END IF;
    
    RETURN v_po_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Acceptance Tests:**
```sql
-- Test idempotency
SELECT inventory.upsert_purchase_order(..., 'event-123', ...);
SELECT inventory.upsert_purchase_order(..., 'event-123', ...); -- Should return same ID
SELECT COUNT(*) FROM inventory.purchase_orders WHERE last_event_id = 'event-123'; -- Should be 1
```

**Risk:** Low - Prevents duplicate POs from webhook retries

---

### **PHASE 4: ASSET ASSIGNMENT TRACKING**
**Goal:** Proper asset checkout/checkin with history

**SQL Migrations Required:**
```sql
-- File: 20260120000002_create_asset_assignments.sql

CREATE TABLE inventory.asset_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    asset_id UUID NOT NULL REFERENCES inventory.assets(id),
    
    -- Who/what has it
    assigned_to_type TEXT NOT NULL CHECK (assigned_to_type IN ('employee', 'crew', 'job', 'location')),
    assigned_to_id UUID NOT NULL,
    assigned_to_name TEXT, -- Denorm for quick display
    
    -- When
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    due_back_at TIMESTAMPTZ,
    returned_at TIMESTAMPTZ,
    
    -- Status
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned', 'overdue', 'lost')),
    
    -- Audit
    assigned_by_user_id UUID REFERENCES auth.users(id),
    returned_by_user_id UUID REFERENCES auth.users(id),
    notes TEXT,
    
    -- Idempotency
    last_event_id TEXT NOT NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT asset_assignments_tenant_last_event_id_unique UNIQUE (tenant_id, last_event_id)
);

CREATE INDEX idx_asset_assignments_tenant_asset ON inventory.asset_assignments(tenant_id, asset_id);
CREATE INDEX idx_asset_assignments_assigned_to ON inventory.asset_assignments(tenant_id, assigned_to_type, assigned_to_id);
CREATE INDEX idx_asset_assignments_status ON inventory.asset_assignments(tenant_id, status);
CREATE INDEX idx_asset_assignments_active ON inventory.asset_assignments(tenant_id, asset_id) WHERE status = 'active';

ALTER TABLE inventory.asset_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY asset_assignments_tenant_isolation ON inventory.asset_assignments
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
```

**RPC Required:**
```sql
CREATE OR REPLACE FUNCTION inventory.assign_asset(
    p_tenant_id UUID,
    p_asset_id UUID,
    p_assigned_to_type TEXT,
    p_assigned_to_id UUID,
    p_assigned_to_name TEXT,
    p_due_back_at TIMESTAMPTZ,
    p_last_event_id TEXT
) RETURNS UUID AS $$
DECLARE
    v_assignment_id UUID;
BEGIN
    -- Create assignment
    INSERT INTO inventory.asset_assignments (
        tenant_id, asset_id, assigned_to_type, assigned_to_id,
        assigned_to_name, due_back_at, assigned_by_user_id, last_event_id
    ) VALUES (
        p_tenant_id, p_asset_id, p_assigned_to_type, p_assigned_to_id,
        p_assigned_to_name, p_due_back_at, auth.uid(), p_last_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_assignment_id;
    
    -- Emit asset event
    PERFORM inventory.insert_asset_event(
        p_tenant_id, 'assigned', NOW(), p_asset_id,
        auth.uid(), 'assignment_system', p_last_event_id || '-event',
        jsonb_build_object(
            'assigned_to_type', p_assigned_to_type,
            'assigned_to_id', p_assigned_to_id,
            'assignment_id', v_assignment_id
        )
    );
    
    RETURN v_assignment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Acceptance Tests:**
1. Assign asset to employee
2. Check `asset_assignments` has active record
3. Check `asset_events` has 'assigned' event
4. Return asset
5. Check assignment status = 'returned'

**Risk:** Low - Nice-to-have for asset management

---

### **PHASE 5: READ MODEL VIEWS FOR AI**
**Goal:** Clean, denormalized views for LLM context

**SQL Migrations Required:**
```sql
-- File: 20260120000003_create_ai_views.sql

-- Current inventory summary
CREATE OR REPLACE VIEW inventory.v_stock_summary AS
SELECT 
    i.tenant_id,
    i.id AS item_id,
    i.sku,
    i.name AS item_name,
    c.name AS category_name,
    l.id AS location_id,
    l.name AS location_name,
    l.location_type,
    s.on_hand_quantity,
    s.reserved_quantity,
    s.available_quantity,
    s.updated_at
FROM inventory.catalog_items i
LEFT JOIN inventory.item_categories c ON i.category_id = c.id
LEFT JOIN inventory.inventory_stock s ON i.id = s.item_id
LEFT JOIN inventory.locations l ON s.location_id = l.id
WHERE i.active = true;

COMMENT ON VIEW inventory.v_stock_summary IS 
    'AI-ready view: Current inventory levels by item and location';

-- Asset availability
CREATE OR REPLACE VIEW inventory.v_asset_availability AS
SELECT
    a.tenant_id,
    a.id AS asset_id,
    a.asset_tag,
    a.serial_number,
    i.name AS item_name,
    i.sku,
    ast.current_status,
    l.name AS current_location,
    ast.assigned_to_ref,
    CASE 
        WHEN ast.current_status = 'available' THEN true
        ELSE false
    END AS is_available
FROM inventory.assets a
LEFT JOIN inventory.catalog_items i ON a.catalog_item_id = i.id
LEFT JOIN inventory.asset_state ast ON a.id = ast.asset_id
LEFT JOIN inventory.locations l ON ast.current_location_id = l.id;

COMMENT ON VIEW inventory.v_asset_availability IS
    'AI-ready view: Asset status and availability';

-- Purchase order status
CREATE OR REPLACE VIEW inventory.v_po_status AS
SELECT
    po.tenant_id,
    po.id AS po_id,
    po.po_number,
    po.status AS po_status,
    po.order_date,
    po.expected_delivery_date,
    v.name AS vendor_name,
    dl.name AS delivery_location,
    COUNT(pol.id) AS total_lines,
    SUM(pol.qty_ordered) AS total_qty_ordered,
    SUM(pol.qty_received) AS total_qty_received
FROM inventory.purchase_orders po
LEFT JOIN inventory.locations v ON po.vendor_location_id = v.id
LEFT JOIN inventory.locations dl ON po.delivery_location_id = dl.id
LEFT JOIN inventory.purchase_order_lines pol ON po.id = pol.po_id
GROUP BY po.id, po.tenant_id, po.po_number, po.status, po.order_date, po.expected_delivery_date, v.name, dl.name;

COMMENT ON VIEW inventory.v_po_status IS
    'AI-ready view: Purchase order summary with aggregates';
```

**RLS Policies Required:**
```sql
ALTER TABLE inventory.v_stock_summary OWNER TO authenticator;
ALTER TABLE inventory.v_asset_availability OWNER TO authenticator;
ALTER TABLE inventory.v_po_status OWNER TO authenticator;

-- RLS inherits from underlying tables
```

**Acceptance Tests:**
```sql
SELECT * FROM inventory.v_stock_summary WHERE tenant_id = '<test-tenant>' LIMIT 10;
SELECT * FROM inventory.v_asset_availability WHERE is_available = true LIMIT 10;
SELECT * FROM inventory.v_po_status WHERE po_status = 'approved' LIMIT 10;
```

**Risk:** Low - Quality of life improvement

---

## 4. TOP 10 NEXT TASKS

1. **Enable RLS on `public.tenants`, `public.processed_events`, `public.events_dead_letter`** - Prevents cross-tenant data leaks (30 min)

2. **Create `/auth/callback` Edge Function** - Enables SSO exchange from Core (2 hours)

3. **Remove dev-login bypass, enforce real auth** - Update `AuthGate.tsx` to use Supabase JWT (1 hour)

4. **Schedule events-poller cron trigger** - Enable automatic event publishing (15 min)

5. **Add `last_event_id` to `purchase_orders` and `purchase_order_lines`** - Prevent duplicate POs from webhooks (30 min)

6. **Create `inventory.asset_assignments` table** - Track asset checkout/checkin properly (1 hour)

7. **Build AI-ready views (`v_stock_summary`, `v_asset_availability`, `v_po_status`)** - Clean data for LLM queries (1 hour)

8. **Test RLS with real JWT** - Verify tenant isolation after auth changes (30 min)

9. **Document webhook payload schemas** - Help Core team integrate (1 hour)

10. **Create seed data script for testing** - Sample items/locations/assets for QA (1 hour)

---

## 5. IF YOU ONLY DO 1 THING TODAY

**Fix RLS gaps on `public.tenants`, `public.processed_events`, and `public.events_dead_letter`**

**Why:** These tables have `tenant_id` columns but no RLS, allowing any authenticated user to query cross-tenant data. This is a **data security vulnerability**.

**How:**
```bash
cd supabase
# Create migration
echo "-- Fix RLS gaps
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenants_tenant_isolation ON public.tenants FOR ALL USING (id = (auth.jwt() ->> 'tenant_id')::UUID);
CREATE POLICY tenants_service_role ON public.tenants FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.processed_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY processed_events_tenant_isolation ON public.processed_events FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID OR tenant_id IS NULL);
CREATE POLICY processed_events_service_role ON public.processed_events FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.events_dead_letter ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_dead_letter_tenant_isolation ON public.events_dead_letter FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
CREATE POLICY events_dead_letter_service_role ON public.events_dead_letter FOR ALL TO service_role USING (true) WITH CHECK (true);
" > migrations/20260120000000_fix_rls_gaps.sql

# Apply it
npx supabase db push
```

**Impact:** Immediately secures multi-tenant data. Takes 5 minutes.

---

## APPENDIX: Recommended Inventory Data Model Summary

Your existing model is **strong** and follows best practices:

✅ **Consumables:** `catalog_items` with `tracking_mode='stock'`  
✅ **Non-consumable assets:** `assets` table with serial numbers and status tracking  
✅ **Locations:** Universal `locations` table (yard/warehouse/truck/job/person/vendor)  
✅ **Quantity on hand:** Calculated from `inventory_movements` ledger → materialized in `inventory_stock`  
✅ **Statuses:** Comprehensive coverage in movements and assets  
✅ **Transactions:** Append-only `inventory_movements` ledger (immutable source of truth)  

**No structural changes needed.** Focus on fixing auth/RLS/scheduling gaps.

---

**END OF AUDIT REPORT**
