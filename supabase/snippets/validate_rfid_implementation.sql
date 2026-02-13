-- ============================================================================
-- RFID Implementation Validation Script
-- ============================================================================
-- Purpose: Verify RFID infrastructure is correctly deployed
-- Date: 2026-01-28
-- ============================================================================

\echo ''
\echo '╔═══════════════════════════════════════════════════════════════════╗'
\echo '║   RFID Infrastructure Validation                                 ║'
\echo '╚═══════════════════════════════════════════════════════════════════╝'
\echo ''

-- ============================================================================
-- 1. Verify Tables Exist
-- ============================================================================
\echo '1. Verifying RFID Tables...'
\echo ''

SELECT 
    tablename AS table_name,
    schemaname AS schema
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename LIKE 'rfid_%'
ORDER BY tablename;

\echo ''
\echo '✓ Expected: 8 tables (rfid_devices, rfid_tags, rfid_tag_assignment_history,'
\echo '            rfid_bulk_assignment_sessions, rfid_cycle_count_submissions,'
\echo '            rfid_epc_captures, rfid_portal_observations, rfid_portal_movement_events)'
\echo ''

-- ============================================================================
-- 2. Verify RLS Policies
-- ============================================================================
\echo '2. Verifying Row Level Security (RLS) Policies...'
\echo ''

SELECT 
    tablename,
    policyname,
    cmd AS operation,
    CASE WHEN qual IS NOT NULL THEN 'Yes' ELSE 'No' END AS has_using_clause,
    CASE WHEN with_check IS NOT NULL THEN 'Yes' ELSE 'No' END AS has_check_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename LIKE 'rfid_%'
ORDER BY tablename, policyname;

\echo ''
\echo '✓ Expected: Each table has SELECT and INSERT/UPDATE/DELETE policies'
\echo ''

-- ============================================================================
-- 3. Verify Indexes
-- ============================================================================
\echo '3. Verifying Indexes...'
\echo ''

SELECT 
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename LIKE 'rfid_%'
ORDER BY tablename, indexname;

\echo ''
\echo '✓ Expected: Performance indexes on tenant_id, epc, device_code, etc.'
\echo ''

-- ============================================================================
-- 4. Verify RPC Functions
-- ============================================================================
\echo '4. Verifying RPC Functions...'
\echo ''

SELECT 
    p.proname AS function_name,
    pg_catalog.pg_get_function_arguments(p.oid) AS parameters,
    t.typname AS return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
LEFT JOIN pg_type t ON p.prorettype = t.oid
WHERE n.nspname = 'public'
  AND p.proname LIKE 'rfid_%'
ORDER BY p.proname;

\echo ''
\echo '✓ Expected: 15 functions (device management, cycle count workflow, tag assignment)'
\echo ''

-- ============================================================================
-- 5. Verify Events Registered
-- ============================================================================
\echo '5. Verifying RFID Events in Event Catalog...'
\echo ''

SELECT 
    event_name,
    version,
    producer,
    status,
    created_at
FROM public.event_definitions
WHERE event_name LIKE 'inventory.rfid.%'
ORDER BY event_name;

\echo ''
\echo '✓ Expected: 11 events (device_registered, device_heartbeat, tag_assigned,'
\echo '            tag_reassigned, tag_retired, cycle_count_submission_uploaded,'
\echo '            cycle_count_submission_committed, bulk_assignment_session_completed,'
\echo '            portal_observation_received, portal_movement_derived, portal_movement_applied)'
\echo ''

-- ============================================================================
-- 6. Test Device Registration (Dry Run)
-- ============================================================================
\echo '6. Testing Device Registration Function (DRY RUN)...'
\echo ''

-- Don't actually register, just verify function exists and can be called
DO $$
BEGIN
    RAISE NOTICE 'Function rfid_register_device() is callable: %', 
        (SELECT proname FROM pg_proc WHERE proname = 'rfid_register_device') IS NOT NULL;
END $$;

\echo ''

-- ============================================================================
-- 7. Verify Foreign Key Constraints
-- ============================================================================
\echo '7. Verifying Foreign Key Constraints...'
\echo ''

SELECT 
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name LIKE 'rfid_%'
ORDER BY tc.table_name, kcu.column_name;

\echo ''
\echo '✓ Expected: FKs to assets, catalog_items, locations, cycle_counts'
\echo ''

-- ============================================================================
-- 8. Verify Unique Constraints (Idempotency)
-- ============================================================================
\echo '8. Verifying Unique Constraints (Idempotency Enforcement)...'
\echo ''

SELECT 
    tc.table_name,
    tc.constraint_name,
    string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
WHERE tc.constraint_type = 'UNIQUE'
  AND tc.table_schema = 'public'
  AND tc.table_name LIKE 'rfid_%'
GROUP BY tc.table_name, tc.constraint_name
ORDER BY tc.table_name;

\echo ''
\echo '✓ Expected: (tenant_id, epc), (tenant_id, device_code), (tenant_id, client_submission_id)'
\echo ''

-- ============================================================================
-- 9. Verify Audit Triggers
-- ============================================================================
\echo '9. Verifying Audit Triggers...'
\echo ''

SELECT 
    event_object_table AS table_name,
    trigger_name,
    action_timing,
    event_manipulation AS trigger_event
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table LIKE 'rfid_%'
  AND trigger_name LIKE 'audit_%'
ORDER BY event_object_table, trigger_name;

\echo ''
\echo '✓ Expected: audit_created_at and audit_updated_at triggers on most tables'
\echo ''

-- ============================================================================
-- Summary
-- ============================================================================
\echo ''
\echo '╔═══════════════════════════════════════════════════════════════════╗'
\echo '║   Validation Complete                                            ║'
\echo '╚═══════════════════════════════════════════════════════════════════╝'
\echo ''
\echo 'Next Steps:'
\echo '  1. Review output above to ensure all components are present'
\echo '  2. Test device registration with real tenant data'
\echo '  3. Test tag assignment workflow'
\echo '  4. Test cycle count submission workflow'
\echo ''
