-- Phase 1 Verification Tests
-- Run these to validate all Phase 1 implementations

\echo '====================================='
\echo 'PHASE 1 VERIFICATION TESTS'
\echo '====================================='

-- Test 1: Verify PO State Transition Validation Function Exists
\echo ''
\echo 'Test 1: PO State Transition Validation'
SELECT 
    CASE 
        WHEN COUNT(*) = 1 THEN '✅ PASS: validate_po_status_transition function exists'
        ELSE '❌ FAIL: Function not found'
    END as result
FROM pg_proc 
WHERE proname = 'validate_po_status_transition' 
AND pronamespace = 'inventory'::regnamespace;

-- Test 2: Verify Expense Auto-Matching Function Exists
\echo ''
\echo 'Test 2: Expense Auto-Matching'
SELECT 
    CASE 
        WHEN COUNT(*) = 1 THEN '✅ PASS: auto_match_expenses_on_receipt function exists'
        ELSE '❌ FAIL: Function not found'
    END as result
FROM pg_proc 
WHERE proname = 'auto_match_expenses_on_receipt' 
AND pronamespace = 'inventory'::regnamespace;

-- Test 3: Verify Manual Match RPC Exists
\echo ''
\echo 'Test 3: Manual Expense Match RPC'
SELECT 
    CASE 
        WHEN COUNT(*) = 1 THEN '✅ PASS: rpc_match_expense_to_po function exists'
        ELSE '❌ FAIL: Function not found'
    END as result
FROM pg_proc 
WHERE proname = 'rpc_match_expense_to_po' 
AND pronamespace = 'inventory'::regnamespace;

-- Test 4: Verify Reversal RPC Exists
\echo ''
\echo 'Test 4: Stock Movement Reversal RPC'
SELECT 
    CASE 
        WHEN COUNT(*) = 1 THEN '✅ PASS: rpc_reverse_stock_movement function exists'
        ELSE '❌ FAIL: Function not found'
    END as result
FROM pg_proc 
WHERE proname = 'rpc_reverse_stock_movement' 
AND pronamespace = 'inventory'::regnamespace;

-- Test 5: Verify reversal_ref_id column exists
\echo ''
\echo 'Test 5: Stock Movement Reversal Column'
SELECT 
    CASE 
        WHEN COUNT(*) = 1 THEN '✅ PASS: reversal_ref_id column exists on stock_movements'
        ELSE '❌ FAIL: Column not found'
    END as result
FROM information_schema.columns 
WHERE table_schema = 'inventory' 
AND table_name = 'stock_movements' 
AND column_name = 'reversal_ref_id';

-- Test 6: Verify triggers are installed
\echo ''
\echo 'Test 6: Triggers Installed'
SELECT 
    trigger_name,
    '✅ PASS: Trigger installed' as status
FROM information_schema.triggers 
WHERE event_object_schema = 'inventory'
AND trigger_name IN (
    'validate_po_status_transition_trigger',
    'auto_match_expenses_trigger'
);

-- Test 7: Verify reservation fulfill/release RPCs still exist
\echo ''
\echo 'Test 7: Reservation RPCs (Pre-existing)'
SELECT 
    proname,
    '✅ PASS: RPC exists' as status
FROM pg_proc 
WHERE proname IN ('rpc_inv_fulfill_reservation_issue', 'rpc_inv_release_reservation')
AND pronamespace = 'inventory'::regnamespace;

\echo ''
\echo '====================================='
\echo 'VERIFICATION COMPLETE'
\echo '====================================='
