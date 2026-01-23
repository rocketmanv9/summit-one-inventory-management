-- ============================================================================
-- PHASE 1: IDEMPOTENCY VERIFICATION
-- ============================================================================
-- Creates monitoring view to track idempotency coverage across all tables

CREATE OR REPLACE VIEW inventory.v_idempotency_coverage AS
SELECT 
    table_name,
    has_tenant_id,
    has_last_event_id,
    has_unique_constraint,
    CASE 
        WHEN requires_idempotency AND has_last_event_id AND has_unique_constraint THEN '✅ COMPLIANT'
        WHEN requires_idempotency AND NOT has_last_event_id THEN '❌ MISSING last_event_id'
        WHEN requires_idempotency AND has_last_event_id AND NOT has_unique_constraint THEN '⚠️ MISSING UNIQUE constraint'
        WHEN NOT requires_idempotency THEN '✓ Not required'
        ELSE '⚠️ UNKNOWN'
    END as compliance_status
FROM (
    SELECT 
        c.table_name,
        MAX(CASE WHEN c.column_name = 'tenant_id' THEN 1 ELSE 0 END) = 1 as has_tenant_id,
        MAX(CASE WHEN c.column_name = 'last_event_id' THEN 1 ELSE 0 END) = 1 as has_last_event_id,
        EXISTS (
            SELECT 1 FROM information_schema.table_constraints tc
            WHERE tc.table_schema = 'inventory'
            AND tc.table_name = c.table_name
            AND tc.constraint_type = 'UNIQUE'
            AND tc.constraint_name LIKE '%last_event_id%'
        ) as has_unique_constraint,
        -- Tables that require idempotency (write/transaction tables)
        c.table_name IN (
            'inventory_events', 'asset_events', 'procurement_events',
            'stock_movements', 'reservations', 'receipts', 
            'purchase_orders', 'purchase_order_lines',
            'cycle_counts', 'cycle_count_lines',
            'transfers', 'transfer_lines',
            'asset_assignments'
        ) as requires_idempotency
    FROM information_schema.columns c
    WHERE c.table_schema = 'inventory'
    AND c.table_name NOT LIKE 'v_%'  -- Exclude views
    GROUP BY c.table_name
) subq
ORDER BY compliance_status, table_name;

COMMENT ON VIEW inventory.v_idempotency_coverage IS 
    'Monitors idempotency key coverage across all inventory tables';

-- Run verification and report
DO $$
DECLARE
    v_rec RECORD;
    v_non_compliant INTEGER := 0;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'IDEMPOTENCY COVERAGE REPORT';
    RAISE NOTICE '================================================================';
    
    FOR v_rec IN 
        SELECT * FROM inventory.v_idempotency_coverage 
        WHERE compliance_status LIKE '%❌%' OR compliance_status LIKE '%⚠️%'
        ORDER BY table_name
    LOOP
        RAISE NOTICE '% - %', v_rec.table_name, v_rec.compliance_status;
        IF v_rec.compliance_status LIKE '%❌%' THEN
            v_non_compliant := v_non_compliant + 1;
        END IF;
    END LOOP;
    
    IF v_non_compliant > 0 THEN
        RAISE WARNING 'Found % tables with missing idempotency', v_non_compliant;
    ELSE
        RAISE NOTICE '';
        RAISE NOTICE '✅ ALL TRANSACTION TABLES HAVE IDEMPOTENCY COVERAGE';
    END IF;
    
    RAISE NOTICE '================================================================';
END $$;

