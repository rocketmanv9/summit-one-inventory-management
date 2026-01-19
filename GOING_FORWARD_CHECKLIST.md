# Going Forward Checklist
## Event-Driven Architecture Best Practices

**Last Updated**: January 16, 2026  
**Status**: ✅ Producer Protocol Compliant

---

## 🎯 For Every New Feature/Flow

### 1. Database Schema Changes

When adding new tables or modifying existing ones:

- [ ] **Add `tenant_id` column** (UUID NOT NULL)
  ```sql
  ALTER TABLE new_table ADD COLUMN tenant_id UUID NOT NULL;
  ```

- [ ] **Add idempotency tracking** (if processing external events)
  ```sql
  ALTER TABLE new_table ADD COLUMN last_event_id TEXT UNIQUE;
  ```

- [ ] **Add audit fields**
  ```sql
  ALTER TABLE new_table 
    ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN created_by UUID REFERENCES auth.users(id),
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);
  ```

- [ ] **Enable RLS**
  ```sql
  ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;
  ```

- [ ] **Add tenant isolation policy**
  ```sql
  CREATE POLICY new_table_tenant_isolation ON new_table
    FOR ALL
    USING (tenant_id = ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')::uuid);
  ```

- [ ] **Add indexes for tenant queries**
  ```sql
  CREATE INDEX idx_new_table_tenant ON new_table(tenant_id);
  CREATE INDEX idx_new_table_tenant_created ON new_table(tenant_id, created_at DESC);
  ```

---

### 2. Event Emission

When creating domain events that should be published:

#### Step 1: Register Event in Catalog

- [ ] **Define event schema** in [EVENTS.md](EVENTS.md) or similar docs

- [ ] **Register event** using migration or manual SQL
  ```sql
  SELECT public.register_event(
    'inventory.{entity}.{action}',        -- Event name (dot notation)
    1,                                     -- Version
    'inventory',                           -- Producer name
    'Description of what happened',        -- Human-readable description
    '{"type":"object","properties":{...}}'::jsonb,  -- JSON Schema
    '{"example":"payload"}'::jsonb,        -- Example payload
    'active'                               -- Status: draft|active|deprecated
  );
  ```

#### Step 2: Emit Events from Application Code

- [ ] **Use `public.emit_event()` function**
  ```sql
  SELECT public.emit_event(
    'inventory.item.created',              -- Event type
    jsonb_build_object(
      'item_id', NEW.id,
      'sku', NEW.sku,
      'name', NEW.name,
      'tenant_id', NEW.tenant_id
    ),                                     -- Payload (JSONB)
    NEW.tenant_id,                         -- Tenant ID
    'tenant',                              -- Scope (tenant|profile|global)
    'catalog_item',                        -- Aggregate type
    NEW.id                                 -- Aggregate ID
  );
  ```

#### Step 3: Add Trigger (Optional - for automatic emission)

- [ ] **Create trigger function**
  ```sql
  CREATE OR REPLACE FUNCTION emit_new_entity_event()
  RETURNS TRIGGER AS $$
  BEGIN
    PERFORM public.emit_event(
      'inventory.entity.created',
      jsonb_build_object(
        'entity_id', NEW.id,
        'tenant_id', NEW.tenant_id,
        -- Include all relevant fields
      ),
      NEW.tenant_id
    );
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
  ```

- [ ] **Attach trigger to table**
  ```sql
  CREATE TRIGGER trigger_new_entity_events
    AFTER INSERT ON inventory.new_entity
    FOR EACH ROW
    EXECUTE FUNCTION emit_new_entity_event();
  ```

---

### 3. Event Payload Design

When designing event payloads:

- [ ] **Always include `tenant_id`** (even though it's in outbox table)
- [ ] **Include entity ID** for downstream lookups
- [ ] **Include timestamp** (`occurred_at` or similar)
- [ ] **Use semantic versioning** (increment version on breaking changes)
- [ ] **Keep payloads immutable** (no sensitive data that might change)
- [ ] **Document schema** in event catalog
- [ ] **Provide example** for documentation/testing

**Example Good Payload:**
```json
{
  "item_id": "uuid",
  "sku": "ABC-123",
  "name": "Widget",
  "quantity_change": -5,
  "new_balance": 45,
  "tenant_id": "uuid",
  "occurred_at": "2026-01-16T12:00:00Z",
  "actor_id": "uuid",
  "reason": "sale"
}
```

**Example Bad Payload:**
```json
{
  "id": "uuid",           // ❌ Ambiguous - ID of what?
  "data": {...},          // ❌ Unstructured
  "password": "***",      // ❌ Sensitive data
  // ❌ Missing tenant_id
  // ❌ Missing timestamp
}
```

---

### 4. Webhook Integration (Consuming Events)

When adding new webhook consumers:

- [ ] **Use idempotency tracking**
  ```sql
  -- Check if already processed
  SELECT 1 FROM public.processed_events WHERE delivery_id = p_delivery_id;
  
  -- Record processing
  INSERT INTO public.processed_events (delivery_id, event_type, tenant_id, payload)
  VALUES (p_delivery_id, p_event_type, p_tenant_id, p_payload);
  ```

- [ ] **Verify HMAC signature**
  ```typescript
  const signature = request.headers.get('x-event-signature');
  const hmac = createHmac('sha256', process.env.WEBHOOK_SECRET!);
  const expected = 'sha256=' + hmac.update(rawBody).digest('hex');
  if (signature !== expected) {
    return Response(401);
  }
  ```

- [ ] **Handle retries gracefully** (idempotency prevents duplicates)
- [ ] **Return 200 OK quickly** (don't block webhook sender)
- [ ] **Process async if needed** (queue for background processing)

---

### 5. Testing Event Flows

For every new event:

- [ ] **Write unit test** for event emission
  ```sql
  -- Test event gets created
  INSERT INTO inventory.test_table (...) VALUES (...);
  SELECT * FROM inventory.events_outbox WHERE event_type = 'inventory.test.created';
  ```

- [ ] **Verify event payload** matches schema
  ```sql
  SELECT payload FROM inventory.events_outbox 
  WHERE event_type = 'inventory.test.created';
  -- Manually verify against JSON Schema
  ```

- [ ] **Test immutability** (payload should be unchangeable)
  ```sql
  UPDATE inventory.events_outbox SET payload = '{}' WHERE id = '...';
  -- Should error
  ```

- [ ] **Test tenant isolation** (events filtered by tenant_id)
  ```sql
  -- As Tenant A, emit event
  -- As Tenant B, verify cannot see event
  ```

---

## 🔐 Security Checklist

For every new API endpoint or database function:

- [ ] **Validate tenant_id** from JWT claim
- [ ] **Filter all queries** by tenant_id
- [ ] **Check RLS policies** are enabled
- [ ] **Use service_role key** only server-side
- [ ] **Never expose** sensitive data in events
- [ ] **Rotate credentials** periodically (summit_bot password, webhook secrets)

---

## 📊 Monitoring Checklist

### Event Outbox Health

Check regularly:

- [ ] **Pending events count** (should drain quickly)
  ```sql
  SELECT COUNT(*) FROM public.events_outbox WHERE status = 'pending';
  ```

- [ ] **Failed events** (investigate errors)
  ```sql
  SELECT id, event_type, attempts, error_message 
  FROM public.events_outbox 
  WHERE status = 'failed'
  ORDER BY created_at DESC;
  ```

- [ ] **Dead letter queue** (requires manual intervention)
  ```sql
  SELECT COUNT(*) FROM public.events_dead_letter;
  ```

- [ ] **Old events** (archive/purge after retention period)
  ```sql
  SELECT COUNT(*) FROM public.events_outbox 
  WHERE status = 'published' AND published_at < NOW() - INTERVAL '30 days';
  ```

---

## 🚀 Deployment Checklist

Before deploying changes:

- [ ] **Run all migrations** in staging first
- [ ] **Verify event catalog** is up-to-date
- [ ] **Test event emission** with sample data
- [ ] **Check summit_bot password** is set (for hub polling)
  ```sql
  -- Verify role exists
  SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'summit_bot';
  ```
- [ ] **Update hub configuration** if event schemas changed
- [ ] **Monitor error rates** post-deployment
- [ ] **Verify downstream systems** received events

---

## 📝 Documentation Checklist

For every new event or feature:

- [ ] **Update event catalog** (register_event in migration)
- [ ] **Document payload schema** with examples
- [ ] **Update API docs** if new endpoints added
- [ ] **Add migration notes** explaining changes
- [ ] **Update README** with new features
- [ ] **Tag deprecations** (status = 'deprecated' in catalog)

---

## 🔄 Versioning Strategy

When changing events:

### Non-Breaking Changes (Same Version)
- Adding optional fields
- Adding more detailed descriptions
- Fixing typos in documentation

### Breaking Changes (Increment Version)
- Removing fields
- Renaming fields
- Changing field types
- Changing event semantics

**Process:**
1. Register new version in catalog
2. Emit both versions temporarily (dual-write)
3. Migrate consumers to new version
4. Deprecate old version (update catalog status)
5. Stop emitting old version after grace period
6. Archive old version

---

## 🎓 Reference Examples

### Complete Event Flow Example

1. **Define Event**
   ```sql
   SELECT public.register_event(
     'inventory.stock.adjusted',
     1,
     'inventory',
     'Emitted when stock levels change',
     '{"type":"object","required":["item_id","old_qty","new_qty"],...}'::jsonb,
     '{"item_id":"...","old_qty":100,"new_qty":95,...}'::jsonb,
     'active'
   );
   ```

2. **Create Trigger**
   ```sql
   CREATE TRIGGER trigger_stock_adjustments
     AFTER INSERT ON inventory.stock_movements
     FOR EACH ROW
     EXECUTE FUNCTION emit_stock_adjusted_event();
   ```

3. **Trigger Function**
   ```sql
   CREATE FUNCTION emit_stock_adjusted_event() RETURNS TRIGGER AS $$
   BEGIN
     PERFORM public.emit_event(
       'inventory.stock.adjusted',
       jsonb_build_object(
         'item_id', NEW.item_id,
         'old_qty', OLD.quantity,
         'new_qty', NEW.quantity,
         'tenant_id', NEW.tenant_id,
         'occurred_at', NEW.created_at
       ),
       NEW.tenant_id,
       'tenant',
       'stock_movement',
       NEW.id
     );
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;
   ```

4. **Test**
   ```sql
   -- Insert stock movement
   INSERT INTO inventory.stock_movements (...) VALUES (...);
   
   -- Verify event created
   SELECT * FROM public.events_outbox 
   WHERE event_type = 'inventory.stock.adjusted'
   ORDER BY created_at DESC LIMIT 1;
   ```

---

## 📞 Help & Troubleshooting

### Common Issues

**Events not being created:**
- Check trigger exists: `\dft inventory.trigger_name`
- Check function exists: `\df emit_*_event`
- Check for SQL errors in logs

**Events stuck in pending:**
- Verify hub is polling: `SELECT last_polled_at FROM public.summit_config`
- Check network connectivity
- Verify summit_bot credentials

**Payload validation failures:**
- Compare payload against catalog schema
- Check for required fields
- Verify data types match

**RLS blocking queries:**
- Verify JWT has tenant_id claim
- Check RLS policy: `SELECT * FROM pg_policies WHERE tablename = '...'`
- Use service_role key for backend operations

---

## ✅ Pre-Deployment Final Check

Run this query before deploying:

```sql
-- Comprehensive health check
SELECT 
  'Catalog Events' AS metric,
  COUNT(*)::text AS value
FROM public.event_definitions
WHERE status = 'active'

UNION ALL

SELECT 'Pending Events', COUNT(*)::text
FROM public.events_outbox WHERE status = 'pending'

UNION ALL

SELECT 'Failed Events (Last Hour)', COUNT(*)::text
FROM public.events_outbox 
WHERE status = 'failed' AND created_at > NOW() - INTERVAL '1 hour'

UNION ALL

SELECT 'Dead Letter Queue', COUNT(*)::text
FROM public.events_dead_letter

UNION ALL

SELECT 'Last Poll', 
  COALESCE(last_polled_at::text, 'Never') 
FROM public.summit_config LIMIT 1;
```

Expected results:
- ✅ Active catalog events > 0
- ✅ Pending events < 100 (or draining)
- ✅ Failed events (last hour) = 0
- ✅ DLQ = 0 (or known issues documented)
- ✅ Last poll < 5 minutes ago

---

**Next Update**: When adding first production event type
