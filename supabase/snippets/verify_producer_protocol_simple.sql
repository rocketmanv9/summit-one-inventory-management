-- ============================================================================
-- Producer Protocol Quick Verification
-- ============================================================================
-- Run this directly against your database to verify compliance
-- Usage: docker exec -i supabase_db_summit-one-inventory-management psql -U postgres -d postgres -f verify_producer_protocol_simple.sql
-- ============================================================================

-- TEST 1: Register event in catalog
SELECT public.register_event(
    'inventory.test.registered',
    1,
    'inventory',
    'Test event for verification',
    '{"type":"object","properties":{"test_id":{"type":"string"}}}'::jsonb,
    '{"test_id":"12345","message":"hello"}'::jsonb,
    'active'
) AS registration_id;

-- TEST 2: Emit event to outbox
SELECT public.emit_event(
    'inventory.test.registered',
    '{"test_id":"verification-001","timestamp":"'|| NOW() ||'"}'::jsonb,
    'ae837809-1a24-4ab5-ba06-34fd98c05f48'::uuid,  -- Test tenant
    'tenant',
    'test-aggregate',
    gen_random_uuid()
) AS event_id;

-- TEST 3: Verify event visible in public.events_outbox (hub view)
SELECT 
    id,
    event_type,
    tenant_id,
    status,
    attempts,
    locked_at,
    locked_by,
    next_attempt_at IS NOT NULL AS has_next_attempt,
    created_at
FROM public.events_outbox
WHERE event_type = 'inventory.test.registered'
ORDER BY created_at DESC
LIMIT 1;

-- TEST 4: Verify catalog entry
SELECT 
    event_key,
    event_name,
    event_version,
    producer,
    status
FROM public.event_catalog
WHERE event_name = 'inventory.test.registered';

-- TEST 5: Verify summit_config
SELECT 
    publisher_id,
    service_name,
    environment,
    protocol_version,
    polling_enabled
FROM public.summit_config;

-- TEST 6: Simulate hub polling query
SELECT 
    id,
    event_type,
    tenant_id,
    jsonb_typeof(payload) AS payload_type,
    status,
    attempts,
    created_at
FROM public.events_outbox
WHERE status = 'pending'
  AND next_attempt_at <= NOW()
ORDER BY created_at ASC
LIMIT 10;

-- TEST 7: Verify immutability (should work - update status)
UPDATE inventory.events_outbox
SET status = 'processing',
    locked_at = NOW(),
    locked_by = 'test-poller'
WHERE event_type = 'inventory.test.registered'
  AND status = 'pending'
RETURNING id, status, locked_by;

-- TEST 8: Try to update immutable field (should FAIL with error)
-- Uncomment to test:
-- UPDATE inventory.events_outbox
-- SET payload = '{"hacked":true}'::jsonb
-- WHERE event_type = 'inventory.test.registered';
-- Expected error: "payload cannot be modified after insert"

-- SUMMARY
SELECT 
    'Tables' AS category,
    COUNT(*) AS count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('summit_config', 'events_dead_letter')

UNION ALL

SELECT 
    'Views',
    COUNT(*)
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name IN ('events_outbox', 'event_catalog')

UNION ALL

SELECT 
    'Functions',
    COUNT(*)
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN ('emit_event', 'register_event')

UNION ALL

SELECT 
    'Roles',
    COUNT(*)
FROM pg_roles
WHERE rolname = 'summit_bot';
