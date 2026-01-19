# Producer-Side Event Publisher Protocol Audit

**Date**: January 16, 2026  
**Database**: Summit One Inventory Management  
**Purpose**: Align with Command Center Hub polling requirements

---

## 1. Audit Findings

### ✅ Partial Compliance - Existing Tables

#### inventory.events_outbox (EXISTS - WRONG SCHEMA)
- **Location**: `inventory` schema (Hub requires `public` schema)
- **Status**: Needs migration to `public.events_outbox`
- **Current Columns**:
  - ✅ `id` uuid PRIMARY KEY with gen_random_uuid()
  - ✅ `tenant_id` uuid NOT NULL
  - ✅ `event_type` text NOT NULL
  - ✅ `payload` jsonb NOT NULL
  - ✅ `created_at` timestamptz with default now()
  - ✅ `status` text (pending/published/failed)
  - ✅ `retry_count` integer default 0
  - ✅ `published_at` timestamptz
  - ✅ `last_error` text
  - ⚠️ Additional columns: scope, aggregate_type, aggregate_id, actor_user_id, metadata, event_name, event_version
  - ❌ **MISSING**: `next_attempt_at` (for retry scheduling)
  - ❌ **MISSING**: `locked_at`, `locked_by` (for concurrent poller safety)
  - ❌ **MISSING**: `last_attempt_at` (for tracking)

#### public.event_definitions (EXISTS - WRONG NAME)
- **Location**: `public` schema ✅
- **Status**: Needs rename/alias to `public.event_catalog`
- **Current Columns**:
  - ✅ `event_name` text (matches event_type)
  - ✅ `version` integer
  - ✅ `description` text
  - ✅ `payload_schema` jsonb
  - ✅ `example_payload` jsonb
  - ✅ `status` text (draft/active/deprecated)
  - ⚠️ `id` uuid (Hub prefers event_key/event_name as PK)
  - ❌ **MISSING**: explicit `event_key` text PRIMARY KEY
  - ✅ Unique constraint on (event_name, version)

### ❌ Missing Tables

#### public.summit_config (NOT EXISTS)
**Purpose**: Metadata about this producer for hub discovery
- Should contain:
  - `publisher_id` uuid (unique identifier for this service)
  - `environment` text (dev/staging/prod)
  - `protocol_version` text (e.g., "1.0")
  - `service_name` text
  - `last_polled_at` timestamptz
  - `config` jsonb (flexible metadata)

#### public.events_dead_letter (NOT EXISTS)
**Purpose**: Dead letter queue for events that exceed retry limits
- Should contain:
  - Same schema as events_outbox
  - `original_event_id` uuid (references original outbox event)
  - `dead_lettered_at` timestamptz
  - `final_error` text
  - `total_attempts` integer

### ❌ Missing Role

#### summit_bot (NOT EXISTS)
**Purpose**: Dedicated role for Command Center hub to poll events
- Needs:
  - SELECT on `public.events_outbox`
  - UPDATE on `public.events_outbox` (status, locked_*, attempts, error fields only)
  - SELECT on `public.event_catalog`
  - SELECT on `public.summit_config`
  - No access to `inventory.*` tables
  - No DDL permissions

---

## 2. Schema Mismatches vs Requirements

| Requirement | Current State | Action Needed |
|-------------|---------------|---------------|
| Table: `public.events_outbox` | `inventory.events_outbox` | Create view or migrate |
| Column: `next_attempt_at` | Missing | Add column |
| Column: `locked_at` | Missing | Add column |
| Column: `locked_by` | Missing | Add column |
| Column: `last_attempt_at` | Missing | Add column |
| Table: `public.event_catalog` | `public.event_definitions` | Create view/alias |
| Column: `event_key` as PK | `id` uuid as PK | Add or use view |
| Table: `public.summit_config` | Missing | Create table |
| Table: `public.events_dead_letter` | Missing | Create table |
| Role: `summit_bot` | Missing | Create role + grants |
| Index: polling efficiency | Partial | Add composite index |

---

## 3. Function Inventory

### Existing Functions (inventory schema)
- ✅ `inventory.publish_event()` - Inserts into inventory.events_outbox
- ⚠️ **Needs wrapper**: `public.emit_event()` for standardization

### Missing Functions
- ❌ `public.register_event()` - Upsert event catalog entries
- ❌ `public.emit_event()` - Standard event emission interface
- ❌ Immutability trigger - Prevent payload/event_type changes after insert

---

## 4. Index Assessment

### Existing Indexes on inventory.events_outbox
- ✅ `idx_outbox_pending` ON (status, created_at) WHERE status = 'pending'
- ✅ `idx_events_outbox_tenant_id` ON (tenant_id)
- ✅ `idx_events_outbox_event_type` ON (event_type)

### Needed Indexes for public.events_outbox
- ❌ Polling index: `(status, next_attempt_at, created_at)` WHERE status IN ('pending', 'processing')
- ❌ Lock cleanup: `(locked_at)` WHERE locked_at IS NOT NULL

---

## 5. Security Assessment

### Current State
- ✅ RLS enabled on inventory.events_outbox
- ✅ Tenant isolation policy exists
- ❌ No dedicated polling role (summit_bot)
- ❌ Public schema tables not created yet

### Required Actions
- Create `summit_bot` role with password placeholder
- Grant minimal permissions (SELECT outbox/catalog, UPDATE outbox status/locks only)
- Add RLS policies for authenticated dashboard access (optional)
- Ensure summit_bot can bypass RLS for polling (use SECURITY DEFINER functions)

---

## 6. Data Migration Considerations

### Current Events in inventory.events_outbox
```sql
-- Check current event count
SELECT status, COUNT(*) FROM inventory.events_outbox GROUP BY status;
```

### Migration Strategy
**Option A: Views (Non-Destructive)**
- Create `public.events_outbox` as view over `inventory.events_outbox`
- Add missing columns to `inventory.events_outbox`
- Hub polls the view

**Option B: Schema Migration (Preferred)**
- Alter `inventory.events_outbox` to add missing columns
- Create `public.events_outbox` view with exact hub-required columns only
- Keep `inventory.events_outbox` as source of truth with additional metadata
- Provides backward compatibility + hub compliance

---

## 7. Breaking Changes

### None - Additive Migration Only
- All changes are additive (new columns, tables, roles)
- Existing `inventory.publish_event()` continues to work
- New `public.emit_event()` wrapper can coexist
- Views maintain backward compatibility

---

## 8. Compliance Score

| Category | Score | Status |
|----------|-------|--------|
| Core Schema | 70% | 🟡 Needs public schema view + missing columns |
| Catalog | 85% | 🟢 event_definitions exists, needs alias |
| Security | 30% | 🔴 No summit_bot role, no grants |
| Functions | 50% | 🟡 publish_event exists, needs emit_event wrapper |
| Indexes | 75% | 🟢 Good coverage, needs polling-optimized index |
| DLQ | 0% | 🔴 No dead letter queue |
| Config | 0% | 🔴 No summit_config table |
| **Overall** | **51%** | 🟡 **Moderate - Needs Work** |

---

## 9. Recommendations

### High Priority (Blocking for Hub)
1. ✅ Add locking columns to inventory.events_outbox
2. ✅ Create public.events_outbox view
3. ✅ Create summit_bot role with grants
4. ✅ Create public.emit_event() wrapper function
5. ✅ Add polling-optimized indexes

### Medium Priority (Operational)
6. ✅ Create public.summit_config table
7. ✅ Create public.events_dead_letter table
8. ✅ Add immutability trigger
9. ✅ Create public.register_event() function

### Low Priority (Nice-to-Have)
10. Add event emission helper for common patterns
11. Create monitoring views (failed events, retry stats)
12. Add event archival/purge strategy
13. Create event catalog UI in debug page

---

## Next Steps

1. Review migration plan
2. Execute single migration with all changes
3. Run verification script
4. Test hub polling with summit_bot credentials
5. Update application code to use emit_event() for new events
