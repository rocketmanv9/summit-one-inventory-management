# Producer Protocol Quick Reference

## 🚀 Emit an Event (Application Code)

```sql
SELECT public.emit_event(
    'inventory.item.created',              -- Event type (from catalog)
    '{"item_id":"uuid","sku":"ABC-123"}'::jsonb,  -- Payload
    'tenant-uuid'::uuid,                   -- Tenant ID
    'tenant',                              -- Scope (tenant|profile|global)
    'catalog_item',                        -- Aggregate type (optional)
    'item-uuid'::uuid                      -- Aggregate ID (optional)
) AS event_id;
```

## 📋 Register New Event in Catalog

```sql
SELECT public.register_event(
    'inventory.new.event',                 -- Event name (dot notation)
    1,                                     -- Version
    'inventory',                           -- Producer
    'Description of event',                -- Human-readable
    '{"type":"object","properties":{...}}'::jsonb,  -- JSON Schema
    '{"example":"payload"}'::jsonb,        -- Example
    'active'                               -- Status (draft|active|deprecated)
);
```

## 🔐 Set summit_bot Password (REQUIRED)

```sql
ALTER USER summit_bot PASSWORD '{{GENERATE_STRONG_PASSWORD}}';
```

## 🔍 Check System Health

```sql
SELECT 
  'Active Events' AS metric, COUNT(*) FROM public.event_catalog WHERE status='active'
UNION ALL
SELECT 'Pending', COUNT(*) FROM public.events_outbox WHERE status='pending'
UNION ALL  
SELECT 'Failed', COUNT(*) FROM public.events_outbox WHERE status='failed'
UNION ALL
SELECT 'DLQ', COUNT(*) FROM public.events_dead_letter;
```

## 📊 View Event Catalog

```sql
SELECT event_name, event_version, status, producer 
FROM public.event_catalog 
ORDER BY event_name;
```

## 🔒 Hub Polling (summit_bot)

```sql
-- As summit_bot role
SELECT id, event_type, tenant_id, payload, created_at
FROM public.events_outbox
WHERE status = 'pending' AND next_attempt_at <= NOW()
ORDER BY created_at ASC
LIMIT 100;
```

## 📁 Key Files

- **Audit**: [PRODUCER_PROTOCOL_AUDIT.md](PRODUCER_PROTOCOL_AUDIT.md)
- **Summary**: [PRODUCER_IMPLEMENTATION_SUMMARY.md](PRODUCER_IMPLEMENTATION_SUMMARY.md)
- **Checklist**: [GOING_FORWARD_CHECKLIST.md](GOING_FORWARD_CHECKLIST.md)
- **Migration**: [supabase/migrations/20260116000010_producer_protocol_compliance.sql](supabase/migrations/20260116000010_producer_protocol_compliance.sql)
