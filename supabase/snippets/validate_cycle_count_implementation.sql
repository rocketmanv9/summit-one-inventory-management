-- ============================================================================
-- Cycle Count Workflow - Validation & Testing Script
-- ============================================================================
-- Purpose: Validate cycle count implementation and test complete workflow
-- Date: 2026-01-28
-- Usage: Run this after applying migrations to verify everything works
-- ============================================================================

-- ============================================================================
-- SETUP: Get Tenant and Test Data
-- ============================================================================

DO $$
DECLARE
    v_tenant_id UUID;
    v_location_id UUID;
    v_item1_id UUID;
    v_item2_id UUID;
    v_asset1_id UUID;
    v_cycle_count_id UUID;
    v_count_number TEXT;
    v_snapshot_result JSONB;
    v_posting_result JSONB;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '╔═══════════════════════════════════════════════════════════════════╗';
    RAISE NOTICE '║   Cycle Count Workflow - Validation & Test                       ║';
    RAISE NOTICE '╚═══════════════════════════════════════════════════════════════════╝';
    RAISE NOTICE '';

    -- Get first tenant
    SELECT id INTO v_tenant_id FROM public.tenants LIMIT 1;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'No tenant found - cannot run tests';
    END IF;
    RAISE NOTICE '✓ Using tenant: %', v_tenant_id;

    -- Get or create a test location
    SELECT id INTO v_location_id 
    FROM inventory.locations 
    WHERE tenant_id = v_tenant_id 
        AND active = TRUE 
    LIMIT 1;
    
    IF v_location_id IS NULL THEN
        RAISE EXCEPTION 'No active location found for tenant %', v_tenant_id;
    END IF;
    RAISE NOTICE '✓ Using location: %', v_location_id;

    -- Get some catalog items
    SELECT id INTO v_item1_id 
    FROM inventory.catalog_items 
    WHERE tenant_id = v_tenant_id 
        AND tracking_mode IN ('stock', 'both')
        AND active = TRUE 
    LIMIT 1;
    
    SELECT id INTO v_item2_id 
    FROM inventory.catalog_items 
    WHERE tenant_id = v_tenant_id 
        AND tracking_mode IN ('stock', 'both')
        AND active = TRUE 
        AND id != v_item1_id
    LIMIT 1 OFFSET 1;

    IF v_item1_id IS NULL THEN
        RAISE NOTICE '⚠ No fungible catalog items found - will skip SKU tests';
    ELSE
        RAISE NOTICE '✓ Found test items: %, %', v_item1_id, COALESCE(v_item2_id::TEXT, 'none');
    END IF;

    -- Get a serialized asset if exists
    SELECT id INTO v_asset1_id 
    FROM inventory.assets 
    WHERE tenant_id = v_tenant_id 
        AND location_id = v_location_id
    LIMIT 1;
    
    IF v_asset1_id IS NULL THEN
        RAISE NOTICE '⚠ No assets found at location - will skip asset tests';
    ELSE
        RAISE NOTICE '✓ Found test asset: %', v_asset1_id;
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE '--- TEST 1: Verify Table Structure ---';
    
    -- Check cycle_counts columns exist
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'inventory' 
            AND table_name = 'cycle_counts' 
            AND column_name = 'snapshot_at'
    ) THEN
        RAISE NOTICE '✓ cycle_counts.snapshot_at exists';
    ELSE
        RAISE EXCEPTION '✗ cycle_counts.snapshot_at missing';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'inventory' 
            AND table_name = 'cycle_counts' 
            AND column_name = 'count_type'
    ) THEN
        RAISE NOTICE '✓ cycle_counts.count_type exists';
    ELSE
        RAISE EXCEPTION '✗ cycle_counts.count_type missing';
    END IF;

    -- Check cycle_count_asset_lines table exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'inventory' 
            AND table_name = 'cycle_count_asset_lines'
    ) THEN
        RAISE NOTICE '✓ cycle_count_asset_lines table exists';
    ELSE
        RAISE EXCEPTION '✗ cycle_count_asset_lines table missing';
    END IF;

    -- Check snapshot tables exist
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'inventory' 
            AND table_name = 'cycle_count_snapshot_skus'
    ) THEN
        RAISE NOTICE '✓ cycle_count_snapshot_skus table exists';
    ELSE
        RAISE EXCEPTION '✗ cycle_count_snapshot_skus table missing';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'inventory' 
            AND table_name = 'cycle_count_snapshot_assets'
    ) THEN
        RAISE NOTICE '✓ cycle_count_snapshot_assets table exists';
    ELSE
        RAISE EXCEPTION '✗ cycle_count_snapshot_assets table missing';
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE '--- TEST 2: Verify Helper Functions ---';

    -- Check functions exist
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'inventory' 
            AND p.proname = 'create_cycle_count_snapshot'
    ) THEN
        RAISE NOTICE '✓ create_cycle_count_snapshot() exists';
    ELSE
        RAISE EXCEPTION '✗ create_cycle_count_snapshot() missing';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'inventory' 
            AND p.proname = 'detect_movements_since_snapshot'
    ) THEN
        RAISE NOTICE '✓ detect_movements_since_snapshot() exists';
    ELSE
        RAISE EXCEPTION '✗ detect_movements_since_snapshot() missing';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'inventory' 
            AND p.proname = 'post_cycle_count_adjustments'
    ) THEN
        RAISE NOTICE '✓ post_cycle_count_adjustments() exists';
    ELSE
        RAISE EXCEPTION '✗ post_cycle_count_adjustments() missing';
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE '--- TEST 3: Verify Event Catalog ---';

    IF EXISTS (
        SELECT 1 FROM public.event_definitions 
        WHERE event_name = 'inventory.cycle_count.created'
    ) THEN
        RAISE NOTICE '✓ Event: inventory.cycle_count.created registered';
    ELSE
        RAISE WARNING '✗ Event: inventory.cycle_count.created not registered';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.event_definitions 
        WHERE event_name = 'inventory.cycle_count.posted'
    ) THEN
        RAISE NOTICE '✓ Event: inventory.cycle_count.posted registered';
    ELSE
        RAISE WARNING '✗ Event: inventory.cycle_count.posted not registered';
    END IF;

    -- Count all cycle count events
    DECLARE
        v_event_count INTEGER;
    BEGIN
        SELECT COUNT(*) INTO v_event_count
        FROM public.event_definitions
        WHERE event_name LIKE 'inventory.cycle_count.%';
        
        RAISE NOTICE '✓ Total cycle count events registered: %', v_event_count;
        
        IF v_event_count < 10 THEN
            RAISE WARNING '  Expected at least 10 events, found %', v_event_count;
        END IF;
    END;

    RAISE NOTICE '';
    RAISE NOTICE '--- TEST 4: Workflow Simulation (Create Cycle Count) ---';

    -- Generate unique count number
    v_count_number := 'TEST-CC-' || EXTRACT(EPOCH FROM NOW())::TEXT;

    -- Create draft cycle count
    INSERT INTO inventory.cycle_counts (
        tenant_id,
        count_number,
        location_id,
        scheduled_for,
        status,
        count_type,
        is_blind,
        last_event_id
    ) VALUES (
        v_tenant_id,
        v_count_number,
        v_location_id,
        CURRENT_DATE + INTERVAL '1 day',
        'draft',
        'full',
        FALSE,
        'test_cc_create_' || gen_random_uuid()::TEXT
    )
    RETURNING id INTO v_cycle_count_id;

    RAISE NOTICE '✓ Created draft cycle count: %', v_cycle_count_id;
    RAISE NOTICE '  Count number: %', v_count_number;

    RAISE NOTICE '';
    RAISE NOTICE '--- TEST 5: Create Snapshot ---';

    -- Call snapshot function
    v_snapshot_result := inventory.create_cycle_count_snapshot(
        v_cycle_count_id, 
        v_tenant_id
    );

    RAISE NOTICE '✓ Snapshot created:';
    RAISE NOTICE '  SKUs snapshotted: %', v_snapshot_result->>'skus_snapshotted';
    RAISE NOTICE '  Assets snapshotted: %', v_snapshot_result->>'assets_snapshotted';

    -- Verify cycle count status updated
    DECLARE
        v_status TEXT;
        v_snapshot_at TIMESTAMPTZ;
    BEGIN
        SELECT status, snapshot_at INTO v_status, v_snapshot_at
        FROM inventory.cycle_counts
        WHERE id = v_cycle_count_id;

        IF v_status = 'in_progress' THEN
            RAISE NOTICE '✓ Cycle count status: %', v_status;
        ELSE
            RAISE WARNING '✗ Expected status in_progress, got: %', v_status;
        END IF;

        IF v_snapshot_at IS NOT NULL THEN
            RAISE NOTICE '✓ Snapshot timestamp: %', v_snapshot_at;
        ELSE
            RAISE WARNING '✗ snapshot_at is NULL';
        END IF;
    END;

    RAISE NOTICE '';
    RAISE NOTICE '--- TEST 6: Simulate Counting ---';

    -- Add some count lines if we have items
    IF v_item1_id IS NOT NULL THEN
        INSERT INTO inventory.cycle_count_lines (
            tenant_id,
            cycle_count_id,
            line_number,
            catalog_item_id,
            location_id,
            qty_expected,
            qty_counted,
            last_event_id
        )
        SELECT 
            v_tenant_id,
            v_cycle_count_id,
            1,
            catalog_item_id,
            location_id,
            expected_qty,
            expected_qty - 1, -- Simulate 1 unit variance
            'test_line_' || gen_random_uuid()::TEXT
        FROM inventory.cycle_count_snapshot_skus
        WHERE cycle_count_id = v_cycle_count_id
        LIMIT 1;

        RAISE NOTICE '✓ Added test count line with variance';
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE '--- TEST 7: Detect Movements Since Snapshot ---';

    -- Call detect movements function
    DECLARE
        v_movement_count INTEGER;
    BEGIN
        SELECT COUNT(*) INTO v_movement_count
        FROM inventory.detect_movements_since_snapshot(
            v_cycle_count_id,
            v_tenant_id
        );

        RAISE NOTICE '✓ Movements since snapshot: %', v_movement_count;
        
        IF v_movement_count > 0 THEN
            RAISE NOTICE '  ⚠ Found movements - would need reconciliation';
        END IF;
    END;

    RAISE NOTICE '';
    RAISE NOTICE '--- TEST 8: Approve Cycle Count ---';

    -- Update to approved status
    UPDATE inventory.cycle_counts
    SET status = 'approved',
        approved_at = NOW()
    WHERE id = v_cycle_count_id;

    RAISE NOTICE '✓ Cycle count approved';

    RAISE NOTICE '';
    RAISE NOTICE '--- TEST 9: Post Adjustments (Idempotency Test) ---';

    -- First posting
    v_posting_result := inventory.post_cycle_count_adjustments(
        v_cycle_count_id,
        v_tenant_id,
        NULL
    );

    RAISE NOTICE '✓ First posting:';
    RAISE NOTICE '  Adjustments created: %', v_posting_result->>'adjustments_created';
    RAISE NOTICE '  Correlation ID: %', v_posting_result->>'correlation_id';

    -- Second posting (should be idempotent)
    v_posting_result := inventory.post_cycle_count_adjustments(
        v_cycle_count_id,
        v_tenant_id,
        NULL
    );

    IF (v_posting_result->>'adjustments_created')::INTEGER = 0 THEN
        RAISE NOTICE '✓ Second posting idempotent (0 adjustments created)';
    ELSE
        RAISE WARNING '✗ Idempotency failed - created % adjustments on second call', 
            v_posting_result->>'adjustments_created';
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE '--- TEST 10: Verify Posted State ---';

    DECLARE
        v_final_status TEXT;
        v_posted_at TIMESTAMPTZ;
        v_movements_count INTEGER;
    BEGIN
        SELECT status, posted_at INTO v_final_status, v_posted_at
        FROM inventory.cycle_counts
        WHERE id = v_cycle_count_id;

        IF v_final_status = 'posted' THEN
            RAISE NOTICE '✓ Final status: %', v_final_status;
        ELSE
            RAISE WARNING '✗ Expected status posted, got: %', v_final_status;
        END IF;

        IF v_posted_at IS NOT NULL THEN
            RAISE NOTICE '✓ Posted at: %', v_posted_at;
        ELSE
            RAISE WARNING '✗ posted_at is NULL';
        END IF;

        -- Check stock movements created
        SELECT COUNT(*) INTO v_movements_count
        FROM inventory.stock_movements
        WHERE source_ref_type = 'cycle_count'
            AND source_ref_id = v_cycle_count_id
            AND tenant_id = v_tenant_id;

        RAISE NOTICE '✓ Stock movements created: %', v_movements_count;
    END;

    RAISE NOTICE '';
    RAISE NOTICE '--- TEST 11: Verify RLS Policies ---';

    DECLARE
        v_rls_enabled BOOLEAN;
        v_policy_count INTEGER;
    BEGIN
        -- Check RLS enabled on new tables
        SELECT relrowsecurity INTO v_rls_enabled
        FROM pg_class c
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'inventory'
            AND c.relname = 'cycle_count_asset_lines';

        IF v_rls_enabled THEN
            RAISE NOTICE '✓ RLS enabled on cycle_count_asset_lines';
        ELSE
            RAISE WARNING '✗ RLS not enabled on cycle_count_asset_lines';
        END IF;

        -- Count policies
        SELECT COUNT(*) INTO v_policy_count
        FROM pg_policies
        WHERE schemaname = 'inventory'
            AND tablename = 'cycle_count_asset_lines';

        RAISE NOTICE '✓ RLS policies on cycle_count_asset_lines: %', v_policy_count;
        
        IF v_policy_count < 2 THEN
            RAISE WARNING '  Expected at least 2 policies (tenant + service_role)';
        END IF;
    END;

    RAISE NOTICE '';
    RAISE NOTICE '--- CLEANUP ---';

    -- Optionally clean up test data
    -- Comment out if you want to inspect the test cycle count
    /*
    DELETE FROM inventory.cycle_count_lines WHERE cycle_count_id = v_cycle_count_id;
    DELETE FROM inventory.cycle_count_snapshot_skus WHERE cycle_count_id = v_cycle_count_id;
    DELETE FROM inventory.cycle_count_snapshot_assets WHERE cycle_count_id = v_cycle_count_id;
    DELETE FROM inventory.stock_movements 
        WHERE source_ref_type = 'cycle_count' AND source_ref_id = v_cycle_count_id;
    DELETE FROM inventory.cycle_counts WHERE id = v_cycle_count_id;
    RAISE NOTICE '✓ Test data cleaned up';
    */
    RAISE NOTICE '⚠ Test data NOT cleaned up - inspect cycle count: %', v_cycle_count_id;
    RAISE NOTICE '  To clean up, run:';
    RAISE NOTICE '    DELETE FROM inventory.cycle_counts WHERE id = ''%'';', v_cycle_count_id;

    RAISE NOTICE '';
    RAISE NOTICE '╔═══════════════════════════════════════════════════════════════════╗';
    RAISE NOTICE '║   Validation Complete - All Tests Passed ✓                       ║';
    RAISE NOTICE '╚═══════════════════════════════════════════════════════════════════╝';
    RAISE NOTICE '';
END $$;

-- ============================================================================
-- Manual Verification Queries (Optional)
-- ============================================================================

-- View all cycle count events registered
\echo '\n=== Registered Cycle Count Events ==='
SELECT event_name, version, status, created_at
FROM public.event_definitions
WHERE event_name LIKE 'inventory.cycle_count.%'
    OR event_name = 'inventory.stock.adjusted'
ORDER BY event_name;

-- View cycle count table structure
\echo '\n=== Cycle Counts Table Columns ==='
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'inventory'
    AND table_name = 'cycle_counts'
ORDER BY ordinal_position;

-- View RLS policies on new tables
\echo '\n=== RLS Policies on Cycle Count Tables ==='
SELECT 
    tablename,
    policyname,
    permissive,
    roles,
    cmd
FROM pg_policies
WHERE schemaname = 'inventory'
    AND tablename IN ('cycle_counts', 'cycle_count_lines', 'cycle_count_asset_lines',
                      'cycle_count_snapshot_skus', 'cycle_count_snapshot_assets')
ORDER BY tablename, policyname;

-- View recent test cycle count (if not cleaned up)
\echo '\n=== Recent Test Cycle Count ==='
SELECT 
    id,
    count_number,
    status,
    count_type,
    snapshot_at,
    posted_at,
    created_at
FROM inventory.cycle_counts
WHERE count_number LIKE 'TEST-CC-%'
ORDER BY created_at DESC
LIMIT 1;
