# Summit Publisher Protocol v1.2 - EXACT Implementation

## ⚠️ BREAKING CHANGES APPLIED

This migration **replaces** your existing event infrastructure to match the Summit Publisher Protocol v1.2 exactly.

## What Changed

❌ **REPLACED**: `event_catalog` VIEW → Now a **TABLE**
❌ **REPLACED**: `summit_config` structured table → Now **key-value store**
❌ **REPLACED**: `emit_event()` function → New signature, writes to `public.events_outbox`
✅ **ADDED**: `public.events_outbox` - Exact protocol spec
✅ **ADDED**: `summit_bot` user with password
✅ **ADDED**: `register_event()` - Upsert event definitions
✅ **ADDED**: `update_event_catalog_item()` - Dashboard editing

## Connection Details for Summit Core

**For the screenshot you showed:**

- **HOST:PORT**: `db.cwmsvmywairkwdmvkdmw.supabase.co:5432`
- **DB NAME**: `postgres`
- **USER**: `summit_bot`
- **PASSWORD**: `03d70dd00ecbabe9443ffae9`

## Updated Function Signatures

### emit_event() - NEW SIGNATURE
```sql
-- Old (no longer valid):
SELECT public.emit_event(
  p_event_type := 'inventory.stock.adjusted',
  p_payload := {...},
  p_tenant_id := tenant_id,
  p_scope := 'tenant'  -- ❌ scope parameter removed
);

-- New (exact protocol):
SELECT public.emit_event(
  p_type := 'inventory.stock.adjusted',
  p_payload := {...}::jsonb,
  p_tenant_id := tenant_id,
  p_actor_id := user_id,          -- NEW
  p_trace_id := trace_id,         -- NEW
  p_correlation_id := corr_id,    -- NEW
  p_aggregate_id := agg_id        -- NEW
);
-- Writes to: public.events_outbox
```

### register_event() - Register Events in Catalog
```sql
SELECT register_event(
  p_key := 'inventory.stock.adjusted',
  p_name := 'Stock Adjusted',
  p_desc := 'Emitted when stock quantity is adjusted',
  p_example := '{"item_id": "123", "quantity": 50}'::jsonb,
  p_schema := {...}::jsonb,  -- JSON Schema
  p_agg_type := 'inventory'
);
```

## Migration Impact

### Code That Will Break

**All existing emit_event() calls need updating:**

```typescript
// ❌ OLD - Will fail (wrong parameters)
await supabase.rpc('emit_event', {
  p_event_type: 'inventory.stock.adjusted',
  p_payload: data,
  p_tenant_id: tenantId,
  p_scope: 'tenant'
});

// ✅ NEW - Correct
await supabase.rpc('emit_event', {
  p_type: 'inventory.stock.adjusted',  // Changed: p_event_type → p_type
  p_payload: data,
  p_tenant_id: tenantId,
  p_actor_id: userId,                   // New parameter
  p_trace_id: traceId,                  // New (optional)
  p_correlation_id: correlationId       // New (optional)
});
```

### Event Catalog Updates

The `event_catalog` is now a **table**, not a view. You need to register events:

```sql
-- Register all your inventory events
SELECT register_event(
  'inventory.stock.adjusted',
  'Stock Adjusted',
  'Stock quantity was adjusted',
  '{"item_id": "uuid", "old_qty": 10, "new_qty": 50}'::jsonb
);

SELECT register_event(
  'inventory.item.created',
  'Item Created',
  'New catalog item was created',
  '{"item_id": "uuid", "sku": "ABC-123"}'::jsonb
);

-- ... register all your events
```

## Rolling Back (If Needed)

⚠️ **This will restore your old structure but lose protocol compliance:**

```sql
-- 1. Drop the new structures
DROP TABLE public.event_catalog CASCADE;
DROP TABLE public.events_outbox CASCADE;
DROP TABLE public.summit_config CASCADE;
DROP FUNCTION emit_event CASCADE;
DROP FUNCTION register_event CASCADE;
DROP USER summit_bot;

-- 2. Restore from backup or recreate old structures
-- (You'll need to manually recreate event_catalog as VIEW)
```

## Testing the Installation

```sql
-- 1. Verify tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('events_outbox', 'event_catalog', 'summit_config');

-- 2. Check summit_bot user
SELECT rolname FROM pg_roles WHERE rolname = 'summit_bot';

-- 3. Register a test event
SELECT register_event(
  'test.connection',
  'Test Event',
  'Testing Summit Protocol',
  '{"test": true}'::jsonb
);

-- 4. Emit a test event
SELECT public.emit_event(
  p_type := 'test.connection',
  p_payload := '{"test": true, "timestamp": "2026-02-12"}'::jsonb,
  p_tenant_id := '00000000-0000-0000-0000-000000000000'::uuid
);

-- 5. Verify it was created
SELECT * FROM public.events_outbox ORDER BY created_at DESC LIMIT 1;
```

## Next Steps

1. **Apply the migration**: `npx supabase db push`
2. **Register all your events**: Use `register_event()` for each event type
3. **Update all emit_event() calls**: Change parameter names and add new ones
4. **Test locally first**: Use a dev environment before production
5. **Connect Summit Core**: Use credentials shown above
