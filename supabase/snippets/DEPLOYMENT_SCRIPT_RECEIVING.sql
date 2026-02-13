-- =====================================================================
-- DEPLOYMENT SCRIPT - Purchase Order Receiving
-- Date: 2026-01-28
-- Description: Execute this script to deploy receiving workflow
-- =====================================================================

-- =====================================================================
-- PRE-DEPLOYMENT CHECKLIST
-- =====================================================================

-- [ ] 1. Database backup completed
-- [ ] 2. Migrations reviewed and approved
-- [ ] 3. Test environment validated
-- [ ] 4. Rollback plan prepared
-- [ ] 5. Downtime window scheduled (if needed)

-- =====================================================================
-- STEP 1: VERIFY CURRENT STATE
-- =====================================================================

-- Check current schema version
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;

-- Check existing tables
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'supply_chain' AND table_name IN ('receipts', 'receipt_lines', 'purchase_orders')
ORDER BY table_name;

-- Check existing RPCs
SELECT routine_name FROM information_schema.routines 
WHERE routine_schema = 'supply_chain' AND routine_name LIKE '%receipt%'
ORDER BY routine_name;

-- =====================================================================
-- STEP 2: APPLY MIGRATIONS (via Supabase CLI)
-- =====================================================================

-- Run from terminal:
-- cd supabase
-- npx supabase db push

-- Migrations will be applied in order:
-- 1. 20260128000000_enhance_receiving_workflow.sql
-- 2. 20260128000001_receiving_query_rpcs.sql
-- 3. 20260128000002_enhanced_receipt_rpcs.sql

-- =====================================================================
-- STEP 3: POST-DEPLOYMENT VERIFICATION
-- =====================================================================

-- Verify new columns exist on receipts
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'supply_chain' 
  AND table_name = 'receipts'
  AND column_name IN ('status', 'vendor_id', 'packing_slip_no', 'vendor_invoice_no', 'source_type')
ORDER BY column_name;
-- Expected: 5 rows returned

-- Verify new columns exist on receipt_lines
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'supply_chain' 
  AND table_name = 'receipt_lines'
  AND column_name IN ('condition_status', 'destination_location_id', 'unit_cost_actual', 'uom', 'notes')
ORDER BY column_name;
-- Expected: 5 rows returned

-- Verify new column exists on purchase_order_lines
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'supply_chain' 
  AND table_name = 'purchase_order_lines'
  AND column_name = 'allow_over_delivery';
-- Expected: 1 row returned

-- Verify new RPCs exist
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'supply_chain' 
  AND routine_name IN (
    'rpc_get_open_pos_for_receiving',
    'rpc_get_po_receiving_detail',
    'rpc_get_po_receipt_history',
    'rpc_get_receipt_detail',
    'rpc_create_receipt_v2',
    'rpc_post_receipt_to_inventory_v2',
    'rpc_confirm_receipt',
    'rpc_cancel_receipt',
    'rpc_validate_receipt'
  )
ORDER BY routine_name;
-- Expected: 9 rows returned

-- Verify triggers exist
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE event_object_schema = 'supply_chain'
  AND trigger_name IN ('trigger_auto_populate_vendor', 'trigger_auto_populate_destination')
ORDER BY trigger_name;
-- Expected: 2 rows returned

-- Verify constraints exist
SELECT constraint_name, constraint_type, table_name
FROM information_schema.table_constraints
WHERE constraint_schema = 'supply_chain'
  AND table_name IN ('receipts', 'receipt_lines', 'purchase_order_lines')
  AND constraint_name IN (
    'receipts_status_check',
    'receipts_source_type_check',
    'receipt_lines_condition_check',
    'chk_po_line_quantities_with_override'
  )
ORDER BY constraint_name;
-- Expected: 4 rows returned

-- Verify indexes exist
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'supply_chain'
  AND indexname IN (
    'idx_receipts_vendor_id',
    'idx_receipts_status',
    'idx_receipts_packing_slip',
    'idx_receipt_lines_condition',
    'idx_receipt_lines_destination'
  )
ORDER BY indexname;
-- Expected: 5 rows returned

-- =====================================================================
-- STEP 4: SMOKE TESTS
-- =====================================================================

-- Test 1: Query open POs (should return empty or existing POs)
SELECT COUNT(*) AS open_po_count
FROM supply_chain.rpc_get_open_pos_for_receiving();

-- Test 2: Create test receipt (replace UUIDs with actual values)
DO $$
DECLARE
  v_tenant_id UUID := 'YOUR-TENANT-ID';  -- Replace
  v_location_id UUID;
  v_catalog_item_id UUID;
  v_result JSONB;
BEGIN
  -- Get first location
  SELECT id INTO v_location_id FROM inventory.locations WHERE tenant_id = v_tenant_id LIMIT 1;
  
  -- Get first catalog item
  SELECT id INTO v_catalog_item_id FROM inventory.catalog_items WHERE tenant_id = v_tenant_id LIMIT 1;
  
  -- Create test receipt
  IF v_location_id IS NOT NULL AND v_catalog_item_id IS NOT NULL THEN
    v_result := supply_chain.rpc_create_receipt_v2(
      p_receipt_number := 'DEPLOY-SMOKE-TEST-' || extract(epoch from now())::TEXT,
      p_location_id := v_location_id,
      p_po_id := NULL,  -- Quick receive
      p_status := 'draft',  -- Don't post to inventory
      p_auto_post := false,
      p_lines := jsonb_build_array(
        jsonb_build_object(
          'catalog_item_id', v_catalog_item_id,
          'qty_received', 1,
          'condition_status', 'accepted'
        )
      )
    );
    
    RAISE NOTICE 'Smoke test receipt created: %', v_result;
    
    -- Clean up test receipt
    DELETE FROM supply_chain.receipts 
    WHERE tenant_id = v_tenant_id 
      AND receipt_number LIKE 'DEPLOY-SMOKE-TEST-%';
    
    RAISE NOTICE 'Smoke test receipt cleaned up';
  ELSE
    RAISE NOTICE 'Skipping smoke test - no locations or catalog items found';
  END IF;
END $$;

-- =====================================================================
-- STEP 5: GRANT PERMISSIONS (if needed)
-- =====================================================================

-- Verify authenticated users have access to new RPCs
SELECT 
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
  array_to_string(p.proacl, ', ') AS permissions
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'supply_chain'
  AND p.proname LIKE '%receipt%'
ORDER BY p.proname;

-- If permissions missing, grant them:
-- GRANT EXECUTE ON FUNCTION supply_chain.rpc_create_receipt_v2 TO authenticated;
-- (etc. for each RPC)

-- =====================================================================
-- STEP 6: UPDATE EXISTING DATA (if needed)
-- =====================================================================

-- Set status on existing receipts
UPDATE supply_chain.receipts
SET status = 'confirmed'
WHERE status IS NULL;

-- Set condition_status on existing receipt_lines
UPDATE supply_chain.receipt_lines
SET condition_status = 'accepted'
WHERE condition_status IS NULL;

-- Set allow_over_delivery on approximate qty PO lines
UPDATE supply_chain.purchase_order_lines
SET allow_over_delivery = true
WHERE is_approximate_qty = true
  AND allow_over_delivery IS NULL;

-- =====================================================================
-- STEP 7: MONITOR FOR ERRORS
-- =====================================================================

-- Check for RLS policy violations
SELECT * FROM inventory.events_outbox
WHERE status = 'failed'
  AND event_name LIKE '%receipt%'
ORDER BY created_at DESC
LIMIT 10;

-- Check for constraint violations (should be empty)
-- (These would be in application logs, not queryable)

-- =====================================================================
-- STEP 8: PERFORMANCE BASELINE
-- =====================================================================

-- Analyze tables to update statistics
ANALYZE supply_chain.receipts;
ANALYZE supply_chain.receipt_lines;
ANALYZE supply_chain.purchase_orders;
ANALYZE supply_chain.purchase_order_lines;
ANALYZE inventory.stock_balances;
ANALYZE inventory.stock_movements;

-- Check index usage (run after some activity)
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan AS index_scans,
  idx_tup_read AS tuples_read,
  idx_tup_fetch AS tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'supply_chain'
  AND tablename IN ('receipts', 'receipt_lines', 'purchase_orders', 'purchase_order_lines')
ORDER BY tablename, indexname;

-- =====================================================================
-- DEPLOYMENT COMPLETE
-- =====================================================================

-- Final verification summary
SELECT 
  'Deployment Status' AS check_item,
  CASE 
    WHEN (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'supply_chain' AND table_name = 'receipts' AND column_name = 'status') = 1
     AND (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'supply_chain' AND routine_name = 'rpc_create_receipt_v2') = 1
    THEN 'SUCCESS ✅'
    ELSE 'FAILED ❌'
  END AS status;

-- =====================================================================
-- ROLLBACK PLAN (if needed)
-- =====================================================================

-- If deployment fails, rollback steps:
-- 1. Restore database from backup
-- 2. Or manually drop new columns:
--    ALTER TABLE supply_chain.receipts DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS vendor_id, ...;
--    ALTER TABLE supply_chain.receipt_lines DROP COLUMN IF EXISTS condition_status, ...;
--    DROP FUNCTION IF EXISTS supply_chain.rpc_create_receipt_v2(...);
--    (etc. for all new RPCs)

-- =====================================================================
-- POST-DEPLOYMENT TASKS
-- =====================================================================

-- [ ] 1. Monitor error logs for 24 hours
-- [ ] 2. Verify API endpoints responding correctly
-- [ ] 3. Run full test suite (seed_receiving_tests.sql)
-- [ ] 4. Update frontend to use new endpoints
-- [ ] 5. Train users on new receiving workflow
-- [ ] 6. Update documentation site (if applicable)

-- =====================================================================
-- END OF DEPLOYMENT SCRIPT
-- =====================================================================
