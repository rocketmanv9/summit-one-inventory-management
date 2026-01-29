# RFID Infrastructure - Data Model Mapping & Design

**Date:** 2026-01-28
**Purpose:** Design document for RFID device registry, handheld cycle counts, tag management, and portal reader infrastructure

---

## EXISTING SCHEMA REUSE

### ✅ REUSED TABLES (No Changes Needed)

1. **`inventory.cycle_counts`** - Cycle count requests/header
   - **Reuse for:** Desktop creates cycle count "requests" that handhelds fetch
   - **Existing fields used:**
     - `id` - Request ID
     - `tenant_id` - Tenant isolation
     - `location_id` - Location to count
     - `count_number` - Display identifier
     - `scheduled_for` - Scheduling
     - `status` - Lifecycle (scheduled → in_progress → submitted → posted)
     - `snapshot_at`, `started_at`, `completed_at` - Timestamps
     - `count_type`, `is_blind` - Configuration
   - **New mapping:** status 'submitted' = device uploaded, waiting review

2. **`inventory.cycle_count_lines`** - SKU count lines (from committed submissions)
   - **Reuse for:** Final committed count data after review
   - **Existing fields:** `qty_counted`, `variance`, `counted_at`, `counted_by_user_id`

3. **`inventory.cycle_count_asset_lines`** - Serialized asset count lines  
   - **Reuse for:** Final committed asset presence after review
   - **Existing fields:** `asset_id`, `counted_present`, `scanned_at`, `scanned_by_user_id`

4. **`inventory.stock_balances`** - Current inventory quantities
   - **Reuse for:** Truth table updated after cycle count commit

5. **`inventory.assets`** - Serialized asset master
   - **Reuse for:** Asset location/status updated after cycle count commit
   - **New mapping:** Will link to RFID tags via new `rfid_tags` table

6. **`inventory.locations`** - Location master
   - **Reuse for:** Cycle count scope, portal installation locations

7. **`inventory.events_outbox`** - Event outbox
   - **Reuse for:** RFID-related events (tag_assigned, portal_observation, etc.)

8. **`public.event_definitions`** - Event catalog
   - **Reuse for:** Register new RFID events

### ✅ EXISTING PATTERNS TO FOLLOW

- **Tenant isolation:** All tables have `tenant_id`, RLS policies
- **Idempotency:** `last_event_id` with unique constraints
- **Audit:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Event-driven:** Emit events via `public.emit_event()`
- **RLS:** Use `current_tenant_id()` function for policies

---

## NEW TABLES REQUIRED

### 1. **`inventory.rfid_devices`** - Device Registry & Auth

```sql
CREATE TABLE inventory.rfid_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    device_code TEXT NOT NULL, -- Human-readable: "scanner-01", "portal-gate-a"
    device_type TEXT NOT NULL CHECK (device_type IN (
        'handheld_cycle_count',
        'portal_reader_entry',
        'portal_reader_exit',
        'portal_reader_bidirectional',
        'desktop_capture'
    )),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'retired')),
    
    -- Auth
    api_key_hash TEXT, -- bcrypt hash of device API key
    scopes TEXT[] NOT NULL DEFAULT '{}', -- e.g. {'cycle_count:sync', 'cycle_count:submit'}
    
    -- Metadata
    hardware_model TEXT,
    firmware_version TEXT,
    app_version TEXT,
    notes TEXT,
    
    -- Location (for fixed portals)
    installed_location_id UUID REFERENCES inventory.locations(id),
    installation_notes TEXT,
    
    -- Telemetry
    last_seen_at TIMESTAMPTZ,
    last_ip_address TEXT,
    heartbeat_count INTEGER DEFAULT 0,
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id),
    
    CONSTRAINT rfid_devices_tenant_device_code_unique UNIQUE (tenant_id, device_code)
);
```

**Indexes:**
- `tenant_id`, `device_code` (unique)
- `device_type`, `status`
- `installed_location_id` (for portals)

**RLS:** Tenant isolation, service_role can manage all

**Scopes:**
- `cycle_count:sync_requests` - Fetch assigned cycle count requests
- `cycle_count:submit_results` - Upload staged submission
- `rfid:capture_epc` - Submit EPC captures for assignment
- `rfid:assign_tags` - Create tag assignments (admin devices)
- `portal:emit_observations` - Submit raw RFID observations
- `device:heartbeat` - Update last_seen telemetry

---

### 2. **`inventory.rfid_tags`** - RFID Tag Identity & Assignment

```sql
CREATE TABLE inventory.rfid_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    epc TEXT NOT NULL, -- EPC-96 or EPC-128 as hex string
    
    -- Assignment
    tag_category TEXT NOT NULL CHECK (tag_category IN ('asset_tag', 'bulk_item_tag', 'unassigned')),
    assignment_status TEXT NOT NULL DEFAULT 'unassigned' CHECK (assignment_status IN (
        'unassigned',
        'assigned',
        'retired',
        'lost',
        'damaged'
    )),
    
    -- Asset assignment (1:1)
    asset_id UUID REFERENCES inventory.assets(id) ON DELETE SET NULL,
    
    -- Bulk item assignment (many EPCs : 1 item type)
    bulk_catalog_item_id UUID REFERENCES inventory.catalog_items(id) ON DELETE SET NULL,
    bulk_assignment_session_id UUID, -- Link to bulk assignment session
    
    -- Assignment metadata
    assigned_at TIMESTAMPTZ,
    assigned_by UUID REFERENCES auth.users(id),
    assigned_via_device_id UUID REFERENCES inventory.rfid_devices(id),
    assignment_notes TEXT,
    
    -- Tag lifecycle
    first_seen_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    seen_count INTEGER DEFAULT 0,
    
    -- Physical tag metadata
    manufacturer TEXT,
    tag_model TEXT,
    memory_size_bits INTEGER,
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id),
    last_event_id TEXT, -- For event-driven assignment
    
    CONSTRAINT rfid_tags_tenant_epc_unique UNIQUE (tenant_id, epc),
    CONSTRAINT rfid_tags_check_assignment CHECK (
        (tag_category = 'asset_tag' AND asset_id IS NOT NULL AND bulk_catalog_item_id IS NULL) OR
        (tag_category = 'bulk_item_tag' AND bulk_catalog_item_id IS NOT NULL AND asset_id IS NULL) OR
        (tag_category = 'unassigned' AND asset_id IS NULL AND bulk_catalog_item_id IS NULL)
    )
);
```

**Indexes:**
- `tenant_id, epc` (unique)
- `asset_id` (1:1 lookup)
- `bulk_catalog_item_id` (pooled tags)
- `assignment_status`, `tag_category`
- `bulk_assignment_session_id`

**RLS:** Tenant isolation

---

### 3. **`inventory.rfid_tag_assignment_history`** - Assignment Audit Trail

```sql
CREATE TABLE inventory.rfid_tag_assignment_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    tag_id UUID NOT NULL REFERENCES inventory.rfid_tags(id) ON DELETE CASCADE,
    epc TEXT NOT NULL,
    
    -- Action
    action TEXT NOT NULL CHECK (action IN ('assigned', 'reassigned', 'unassigned', 'retired')),
    
    -- Previous state
    previous_category TEXT,
    previous_asset_id UUID,
    previous_bulk_catalog_item_id UUID,
    
    -- New state
    new_category TEXT,
    new_asset_id UUID,
    new_bulk_catalog_item_id UUID,
    
    -- Context
    assigned_by UUID REFERENCES auth.users(id),
    assigned_via_device_id UUID REFERENCES inventory.rfid_devices(id),
    reason TEXT,
    notes TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT rfid_tag_assignment_history_tenant_tag_idx 
        FOREIGN KEY (tenant_id, epc) REFERENCES inventory.rfid_tags(tenant_id, epc)
);
```

**Indexes:**
- `tag_id`, `created_at DESC`
- `epc`, `created_at DESC`
- `new_asset_id` (find assignment history for an asset)

**RLS:** Tenant isolation, read-only for devices

---

### 4. **`inventory.rfid_bulk_assignment_sessions`** - Bulk Assignment Batches

```sql
CREATE TABLE inventory.rfid_bulk_assignment_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    session_number TEXT NOT NULL,
    
    catalog_item_id UUID NOT NULL REFERENCES inventory.catalog_items(id),
    
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'cancelled')),
    
    epcs_assigned TEXT[], -- Array of EPCs in this session
    tag_count INTEGER DEFAULT 0,
    
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    started_by UUID REFERENCES auth.users(id),
    device_id UUID REFERENCES inventory.rfid_devices(id),
    notes TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT rfid_bulk_assignment_sessions_tenant_session_unique 
        UNIQUE (tenant_id, session_number)
);
```

**Indexes:**
- `tenant_id, session_number` (unique)
- `catalog_item_id`
- `status`

**RLS:** Tenant isolation

---

### 5. **`inventory.rfid_cycle_count_submissions`** - Staged Handheld Uploads

```sql
CREATE TABLE inventory.rfid_cycle_count_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL, -- Derived from device
    
    -- Device & Request
    device_id UUID NOT NULL REFERENCES inventory.rfid_devices(id),
    cycle_count_id UUID NOT NULL REFERENCES inventory.cycle_counts(id),
    
    -- Idempotency
    client_submission_id UUID NOT NULL, -- Generated on device
    
    -- Session metadata
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    duration_seconds INTEGER GENERATED ALWAYS AS (
        EXTRACT(EPOCH FROM (ended_at - started_at))
    ) STORED,
    
    -- Power mode tracking
    power_mode_used TEXT NOT NULL CHECK (power_mode_used IN ('LOW', 'MED', 'HIGH')),
    power_mode_changes JSONB, -- [{timestamp, old_mode, new_mode, reason}]
    
    -- Status
    status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN (
        'staged',      -- Uploaded, awaiting review
        'committed',   -- Desktop reviewed and posted to inventory
        'rejected',    -- Desktop rejected
        'superseded'   -- Newer submission exists
    )),
    
    -- Evidence: JSONB array of tag reads
    tag_evidence JSONB NOT NULL, -- [{epc, first_seen_at, last_seen_at, seen_count, avg_rssi}]
    
    -- Summary stats
    unique_epcs_count INTEGER,
    total_reads INTEGER,
    recognized_tags INTEGER, -- EPCs that matched known tags
    unrecognized_epcs INTEGER, -- EPCs not in rfid_tags table
    
    -- Review/commit
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES auth.users(id),
    review_notes TEXT,
    committed_at TIMESTAMPTZ,
    committed_by UUID REFERENCES auth.users(id),
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT rfid_cycle_count_submissions_idempotent 
        UNIQUE (tenant_id, device_id, client_submission_id)
);
```

**Indexes:**
- `tenant_id, device_id, client_submission_id` (idempotency)
- `cycle_count_id, status`
- `device_id, created_at DESC`
- `status, created_at` (pending review queue)
- JSONB GIN index on `tag_evidence` for EPC searches

**RLS:** Tenant isolation, devices can only INSERT their own tenant

---

### 6. **`inventory.rfid_epc_captures`** - Desktop Assignment Capture Events

```sql
CREATE TABLE inventory.rfid_epc_captures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    
    device_id UUID NOT NULL REFERENCES inventory.rfid_devices(id),
    epc TEXT NOT NULL,
    rssi INTEGER,
    
    -- Context: What triggered this capture
    capture_context TEXT CHECK (capture_context IN (
        'asset_assignment',
        'bulk_assignment',
        'verification',
        'adhoc'
    )),
    
    -- Session (for multi-scan workflows)
    session_id UUID,
    
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    captured_by UUID REFERENCES auth.users(id),
    
    -- Resolved tag (if known)
    resolved_tag_id UUID REFERENCES inventory.rfid_tags(id),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Indexes:**
- `tenant_id, captured_at DESC`
- `device_id, captured_at DESC`
- `session_id` (multi-scan sessions)
- `epc, tenant_id` (lookup by EPC)

**RLS:** Tenant isolation

**Retention:** Can be pruned after 90 days (not critical audit data)

---

### 7. **`inventory.rfid_portal_observations`** - Raw Portal Reader Data

```sql
CREATE TABLE inventory.rfid_portal_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL, -- Derived from device
    
    device_id UUID NOT NULL REFERENCES inventory.rfid_devices(id),
    epc TEXT NOT NULL,
    
    observed_at TIMESTAMPTZ NOT NULL,
    rssi INTEGER,
    antenna_id INTEGER, -- Which antenna on multi-antenna portal
    read_count INTEGER DEFAULT 1,
    
    -- Batching: device can send batch of reads
    batch_id UUID, -- Device-generated batch identifier
    batch_sequence INTEGER, -- Order within batch
    
    -- Derived movement (processed async)
    movement_event_id UUID, -- Link to derived movement event
    processed_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT rfid_portal_observations_tenant_idx 
        FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
```

**Partitioning:** Partition by `observed_at` (monthly) for performance
**Retention:** Prune observations older than 90 days (keep derived events forever)

**Indexes:**
- `device_id, observed_at DESC` (device reads)
- `epc, observed_at DESC` (tag history)
- `tenant_id, processed_at` WHERE `processed_at IS NULL` (unprocessed queue)
- `batch_id` (batch processing)

**RLS:** Tenant isolation, devices can only INSERT their own tenant

---

### 8. **`inventory.rfid_portal_movement_events`** - Derived Movement Events

```sql
CREATE TABLE inventory.rfid_portal_movement_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    
    -- Device & Tag
    portal_device_id UUID NOT NULL REFERENCES inventory.rfid_devices(id),
    epc TEXT NOT NULL,
    tag_id UUID REFERENCES inventory.rfid_tags(id), -- Resolved tag
    
    -- Movement
    movement_type TEXT NOT NULL CHECK (movement_type IN ('entered', 'exited', 'passed')),
    location_id UUID NOT NULL REFERENCES inventory.locations(id),
    
    -- Confidence
    confidence_score NUMERIC(3,2) CHECK (confidence_score BETWEEN 0 AND 1),
    confidence_reason TEXT,
    
    -- Time window
    event_time TIMESTAMPTZ NOT NULL, -- Derived event time
    first_observation_time TIMESTAMPTZ NOT NULL,
    last_observation_time TIMESTAMPTZ NOT NULL,
    observation_count INTEGER NOT NULL,
    
    -- Evidence
    observation_ids UUID[], -- Array of observation record IDs
    avg_rssi INTEGER,
    primary_antenna_id INTEGER,
    
    -- Lifecycle
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',      -- Detected but not confirmed
        'confirmed',    -- Desktop approved
        'rejected',     -- Desktop rejected
        'auto_applied'  -- Auto-applied by rules
    )),
    
    -- Application to inventory
    applied_at TIMESTAMPTZ,
    applied_by UUID REFERENCES auth.users(id),
    inventory_movement_id UUID, -- Link to stock_movements or asset_events
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_event_id TEXT
);
```

**Indexes:**
- `portal_device_id, event_time DESC`
- `epc, event_time DESC`
- `location_id, event_time DESC`
- `status` (pending review queue)
- `tag_id` (tag movement history)

**RLS:** Tenant isolation

---

## WORKFLOW MAPPINGS

### Handheld Cycle Count Flow

```
DESKTOP:                    DEVICE:                         DATABASE:
┌─────────────┐
│ Create      │ ────────> [cycle_counts status=scheduled]
│ Request     │
└─────────────┘
                           ┌──────────────┐
                           │ Sync API     │ <─── [rfid_devices.scopes includes 'cycle_count:sync']
                           │ GET requests │ <─── [SELECT FROM cycle_counts WHERE status='scheduled']
                           └──────────────┘
                           
                           ┌──────────────┐
                           │ Offline      │
                           │ Scan Session │
                           │ (16x2 LCD)   │
                           └──────────────┘
                           
                           ┌──────────────┐
                           │ Upload       │ ────> [rfid_cycle_count_submissions status='staged']
                           │ Results      │       [tag_evidence JSONB array]
                           └──────────────┘
                           
┌─────────────┐                             
│ Review UI   │ <──── [SELECT submissions WHERE status='staged']
│ Show EPCs   │
│ Resolve to  │
│ Items/Assets│
└─────────────┘
       │
       v
┌─────────────┐
│ Commit      │ ────> [UPDATE cycle_counts SET status='committed']
│ Action      │ ────> [INSERT cycle_count_lines FROM tag_evidence]
│             │ ────> [UPDATE stock_balances via post_cycle_count_adjustments()]
└─────────────┘
```

### RFID Tag Assignment Flow (Individual)

```
DESKTOP:                    DEVICE:                         DATABASE:
┌─────────────┐           ┌──────────────┐
│ Start       │           │ Capture Mode │
│ Assignment  │ ───────> │ Active        │
│ UI          │           └──────────────┘
└─────────────┘                  │
       │                         │ Scan Asset Tag
       │                         v
       │                  ┌──────────────┐
       │ <─────────────── │ Submit EPC   │ ────> [rfid_epc_captures]
       │  (WebSocket      │ Capture      │
       │   or polling)    └──────────────┘
       │
       v
┌─────────────┐
│ Show EPC    │ <─── [SELECT FROM rfid_epc_captures WHERE session_id=X]
│ Select Asset│
│ Confirm     │
└─────────────┘
       │
       v
┌─────────────┐
│ Execute     │ ────> [INSERT/UPDATE rfid_tags SET asset_id, tag_category='asset_tag']
│ Assignment  │ ────> [INSERT rfid_tag_assignment_history]
│             │ ────> [emit_event('inventory.rfid.tag_assigned')]
└─────────────┘
```

---

## AUTHENTICATION STRATEGY

### Device API Key Model (Chosen for MVP)

**API Key Format:** `dev_<tenant_short>_<random32>` (e.g., `dev_acme_k7j2m9p4q8w3x5z1n6b8c4v7`)

**Storage:**
- Store bcrypt hash in `rfid_devices.api_key_hash`
- Device includes in header: `Authorization: Bearer dev_acme_...`

**Middleware:**
```typescript
// Derive tenant from device API key
async function authenticateDevice(apiKey: string) {
  // 1. Hash provided key
  // 2. Find device WHERE api_key_hash matches
  // 3. Extract tenant_id from device record
  // 4. Check device.status = 'active'
  // 5. Check required scope in device.scopes
  // 6. Return { deviceId, tenantId, scopes }
}
```

**Scope Enforcement:**
```sql
-- Device can only call endpoints allowed by scopes
CREATE FUNCTION check_device_scope(p_device_id UUID, p_required_scope TEXT)
RETURNS BOOLEAN AS $$
  SELECT p_required_scope = ANY(scopes)
  FROM inventory.rfid_devices
  WHERE id = p_device_id;
$$ LANGUAGE SQL SECURITY DEFINER;
```

---

## EVENT CATALOG ADDITIONS

New events to register:

1. `inventory.rfid.device_registered` - Device added to registry
2. `inventory.rfid.device_heartbeat` - Device checked in
3. `inventory.rfid.tag_assigned` - Tag assigned to asset or item type
4. `inventory.rfid.tag_reassigned` - Tag reassigned (with warnings)
5. `inventory.rfid.tag_retired` - Tag retired from service
6. `inventory.rfid.cycle_count_submission_uploaded` - Device uploaded staged data
7. `inventory.rfid.cycle_count_submission_committed` - Desktop committed to inventory
8. `inventory.rfid.bulk_assignment_session_completed` - Bulk session finalized
9. `inventory.rfid.portal_observation_received` - Raw observation logged
10. `inventory.rfid.portal_movement_derived` - Movement event created from observations
11. `inventory.rfid.portal_movement_applied` - Movement applied to inventory

---

## RLS POLICIES REQUIRED

### `inventory.rfid_devices`
- Authenticated users: SELECT WHERE `tenant_id = current_tenant_id()`
- Service role: ALL
- Device self-UPDATE: Allow device to update own `last_seen_at`, `heartbeat_count`

### `inventory.rfid_tags`
- Authenticated users: ALL WHERE `tenant_id = current_tenant_id()`
- Service role: ALL
- Devices: SELECT only (for resolution during submissions)

### `inventory.rfid_cycle_count_submissions`
- Authenticated users: ALL WHERE `tenant_id = current_tenant_id()`
- Service role: ALL
- Devices: INSERT WHERE `tenant_id = <derived_from_device>`

### `inventory.rfid_portal_observations`
- Authenticated users: SELECT WHERE `tenant_id = current_tenant_id()`
- Service role: ALL
- Devices: INSERT WHERE `tenant_id = <derived_from_device>`

### All Other RFID Tables
- Standard tenant isolation: `tenant_id = current_tenant_id()`

---

## SUMMARY

**Reused Tables:** 8 (cycle_counts, locations, assets, stock_balances, events_outbox, etc.)
**New Tables:** 8 (devices, tags, submissions, observations, movements, etc.)
**New Events:** 11
**API Endpoints:** ~10 (sync, submit, heartbeat, capture, commit, etc.)

This design integrates cleanly with existing cycle count infrastructure while adding RFID-specific capabilities in an additive, backward-compatible way.
