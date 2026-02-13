-- Check if migration 20260121000007 has been applied
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM supabase_migrations.schema_migrations 
            WHERE version = '20260121000007'
        ) THEN 'MIGRATION APPLIED ✓'
        ELSE 'MIGRATION NOT APPLIED ✗'
    END as migration_status;

-- Check for key objects created by the migration
SELECT 
    'Trigger: validate_reservation_availability' as check_item,
    CASE 
        WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'validate_reservation_availability')
        THEN 'EXISTS ✓' 
        ELSE 'MISSING ✗' 
    END as status
UNION ALL
SELECT 
    'Trigger: validate_single_active_assignment',
    CASE 
        WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'validate_single_active_assignment')
        THEN 'EXISTS ✓' 
        ELSE 'MISSING ✗' 
    END
UNION ALL
SELECT 
    'Column: catalog_items.deleted_at',
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'inventory' 
            AND table_name = 'catalog_items' 
            AND column_name = 'deleted_at'
        )
        THEN 'EXISTS ✓' 
        ELSE 'MISSING ✗' 
    END
UNION ALL
SELECT 
    'Column: events_outbox.retry_count',
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'inventory' 
            AND table_name = 'events_outbox' 
            AND column_name = 'retry_count'
        )
        THEN 'EXISTS ✓' 
        ELSE 'MISSING ✗' 
    END
UNION ALL
SELECT 
    'Materialized View: mv_inventory_summary',
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_matviews 
            WHERE schemaname = 'inventory' 
            AND matviewname = 'mv_inventory_summary'
        )
        THEN 'EXISTS ✓' 
        ELSE 'MISSING ✗' 
    END
UNION ALL
SELECT 
    'View: v_events_stuck',
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.views 
            WHERE table_schema = 'inventory' 
            AND table_name = 'v_events_stuck'
        )
        THEN 'EXISTS ✓' 
        ELSE 'MISSING ✗' 
    END
UNION ALL
SELECT 
    'Index: idx_stock_balances_tenant_location',
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE schemaname = 'inventory' 
            AND indexname = 'idx_stock_balances_tenant_location'
        )
        THEN 'EXISTS ✓' 
        ELSE 'MISSING ✗' 
    END;
