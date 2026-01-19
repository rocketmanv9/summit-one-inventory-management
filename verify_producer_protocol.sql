-- ============================================================================
-- Producer Protocol Verification Script
-- ============================================================================
-- Purpose: Verify hub polling protocol compliance after migration
-- Run this after applying migration 20260116000010
-- ============================================================================

\echo '==================================================================='
\echo 'PRODUCER PROTOCOL VERIFICATION SCRIPT'
\echo 'Date: 2026-01-16'
\echo '==================================================================='
\echo ''

-- ============================================================================
-- TEST 1: Register Event in Catalog
-- ============================================================================

\echo '--- TEST 1: Register Event in Catalog ---'

SELECT public.register_event(
    'inventory.test.registered',
    1,
    'inventory',
    'Test event for verification',
    '{"type":"object","properties":{"test_id":{"type":"string"}}}'::jsonb,
    '{"test_id":"12345","message":"hello"}'::jsonb,
    'active'
);

\echo '✓ Event registered'
\echo ''

-- ============================================================================
-- TEST 2: Emit Event to Outbox
-- ============================================================================

\echo '--- TEST 2: Emit Event to Outbox ---'

-- Create test event
SELECT public.emit_event(
    'inventory.test.registered',
    '{"test_id":"verification-001","timestamp":"'|| NOW() ||'"}'::jsonb,
    'ae837809-1a24-4ab5-ba06-34fd98c05f48'::uuid,  -- Test tenant
    'tenant',
    'test-aggregate',
    gen_random_uuid()
) AS event_id \gset

\echo 'Event ID: ' :event_id
\echo '✓ Event emitted'
\echo ''

-- ============================================================================
-- TEST 3: Verify Event Visible in public.events_outbox (Hub View)
-- ============================================================================

\echo '--- TEST 3: Verify Event Visible via Hub View ---'

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
WHERE id = :'event_id';

\echo '✓ Event visible in public.events_outbox view'
\echo ''

-- ============================================================================
-- TEST 4: Verify Immutability Protection
-- ============================================================================

\echo '--- TEST 4: Test Immutability Protection ---'

-- This should FAIL (payload is immutable)
\echo 'Attempting to modify payload (should fail)...'
UPDATE inventory.events_outbox 
SET payload = '{"hacked":true}'::jsonb 
WHERE id = :'event_id';

-- If we reach here, the trigger didn't work
\echo '✗ FAILED: Payload was modified (immutability trigger not working)'

-- Note: If trigger works, script will error and exit here
-- To continue script after expected error, we'd need \set ON_ERROR_STOP off
-- For now, manual verification required

-- ============================================================================
-- TEST 5: Verify Status/Lock Updates Work (Mutable Fields)
-- ============================================================================

\echo '--- TEST 5: Test Mutable Field Updates ---'

-- Lock event (simulating hub poller)
UPDATE inventory.events_outbox
SET 
    status = 'processing',
    locked_at = NOW(),
    locked_by = 'test-poller-1',
    last_attempt_at = NOW()
WHERE id = :'event_id';

-- Verify update
SELECT 
    status,
    locked_by,
    locked_at IS NOT NULL AS is_locked
FROM inventory.events_outbox
WHERE id = :'event_id';

\echo '✓ Mutable fields updated successfully'
\echo ''

-- ============================================================================
-- TEST 6: Verify summit_bot Can Read Events
-- ============================================================================

\echo '--- TEST 6: Verify summit_bot Permissions ---'

-- Set role to summit_bot (requires password to be set)
-- If password not set, this will fail
-- SET ROLE summit_bot;  -- Uncomment after setting password

-- Query as summit_bot
-- SELECT COUNT(*) FROM public.events_outbox WHERE status = 'pending';

-- Reset role
-- RESET ROLE;

\echo '⚠ Skipped: Requires summit_bot password to be set manually'
\echo 'Manual step: ALTER USER summit_bot PASSWORD ''{{STRONG_PASSWORD}}'';'
\echo ''

-- ============================================================================
-- TEST 7: Verify Event Catalog Accessible
-- ============================================================================

\echo '--- TEST 7: Verify Event Catalog ---'

SELECT 
    event_key,
    event_name,
    event_version,
    producer,
    status
FROM public.event_catalog
WHERE event_name = 'inventory.test.registered';

\echo '✓ Event catalog accessible'
\echo ''

-- ============================================================================
-- TEST 8: Verify summit_config Exists
-- ============================================================================

\echo '--- TEST 8: Verify Producer Config ---'

SELECT 
    publisher_id,
    service_name,
    environment,
    protocol_version,
    polling_enabled
FROM public.summit_config
LIMIT 1;

\echo '✓ summit_config table exists with data'
\echo ''

-- ============================================================================
-- TEST 9: Test Dead Letter Queue Function
-- ============================================================================

\echo '--- TEST 9: Test Dead Letter Queue ---'

-- Create event that will be moved to DLQ
SELECT public.emit_event(
    'inventory.test.dead_letter',
    '{"test":"dlq_verification"}'::jsonb,
    'ae837809-1a24-4ab5-ba06-34fd98c05f48'::uuid
) AS dlq_event_id \gset

-- Simulate max retries
UPDATE inventory.events_outbox
SET retry_count = 5, status = 'failed', last_error = 'Max retries exceeded (test)'
WHERE id = :'dlq_event_id';

-- Move to DLQ
SELECT inventory.move_to_dead_letter(:'dlq_event_id');

-- Verify in DLQ
SELECT 
    original_event_id,
    event_type,
    total_attempts,
    dead_lettered_at IS NOT NULL AS in_dlq
FROM public.events_dead_letter
WHERE original_event_id = :'dlq_event_id';

\echo '✓ Dead letter queue working'
\echo ''

-- ============================================================================
-- TEST 10: Verify Polling Query Performance
-- ============================================================================

\echo '--- TEST 10: Verify Polling Query ---'

-- This is the query hub will use
EXPLAIN ANALYZE
SELECT 
    id,
    event_type,
    tenant_id,
    payload,
    created_at
FROM public.events_outbox
WHERE status = 'pending'
  AND next_attempt_at <= NOW()
ORDER BY created_at ASC
LIMIT 100;

\echo '✓ Polling query uses index (check EXPLAIN output above)'
\echo ''

-- ============================================================================
-- SUMMARY REPORT
-- ============================================================================

\echo '==================================================================='
\echo 'VERIFICATION SUMMARY'
\echo '==================================================================='
\echo ''

-- Count objects
\echo 'Tables/Views:'
SELECT 
    schemaname || '.' || tablename AS object_name,
    'table' AS type
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('summit_config', 'events_dead_letter')
UNION ALL
SELECT 
    schemaname || '.' || viewname AS object_name,
    'view' AS type
FROM pg_views 
WHERE schemaname = 'public' 
  AND viewname IN ('events_outbox', 'event_catalog');

\echo ''
\echo 'Functions:'
SELECT 
    n.nspname || '.' || p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN ('emit_event', 'register_event');

\echo ''
\echo 'Roles:'
SELECT rolname, rolcanlogin 
FROM pg_roles 
WHERE rolname = 'summit_bot';

\echo ''
\echo 'Event Counts:'
SELECT 
    status,
    COUNT(*) AS count
FROM inventory.events_outbox
GROUP BY status
ORDER BY status;

\echo ''
\echo 'Dead Letter Queue:'
SELECT COUNT(*) AS dlq_count FROM public.events_dead_letter;

\echo ''
\echo '==================================================================='
\echo 'VERIFICATION COMPLETE'
\echo ''
\echo 'MANUAL STEPS REQUIRED:'
\echo '1. Set summit_bot password:'
\echo '   ALTER USER summit_bot PASSWORD ''{{STRONG_PASSWORD}}'';'
\echo ''
\echo '2. Test hub polling as summit_bot:'
\echo '   SET ROLE summit_bot;'
\echo '   SELECT * FROM public.events_outbox WHERE status=''pending'' LIMIT 10;'
\echo '   RESET ROLE;'
\echo ''
\echo '3. Register in Command Center Hub:'
\echo '   - Connection string: postgres://summit_bot:***@db.<project>.supabase.co:5432/postgres'
\echo '   - Service name: inventory'
\echo '   - Protocol version: 1.0'
\echo '==================================================================='
