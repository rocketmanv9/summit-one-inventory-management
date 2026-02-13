-- =====================================================
-- Clear All Data (Preserves Schema)
-- =====================================================
-- This script deletes all transactional data for the tenant
-- while keeping the database schema intact
-- =====================================================

DO $$
DECLARE
    v_tenant_id UUID := 'ae837809-1a24-4ab5-ba06-34fd98c05f48';
    v_deleted_count INT;
BEGIN
    RAISE NOTICE 'Starting data cleanup for tenant: %', v_tenant_id;
    
    -- =====================================================
    -- Step 1: Delete dependent/child records first
    -- =====================================================
    
    -- Events outbox
    DELETE FROM inventory.events_outbox WHERE tenant_id = v_tenant_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % events_outbox records', v_deleted_count;
    
    -- Stock movements
    DELETE FROM inventory.stock_movements WHERE tenant_id = v_tenant_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % stock_movements records', v_deleted_count;
    
    -- Reservations
    DELETE FROM inventory.reservations WHERE tenant_id = v_tenant_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % reservations records', v_deleted_count;
    
    -- Transfer lines (child of transfers)
    DELETE FROM inventory.transfer_lines 
    WHERE transfer_id IN (
        SELECT id FROM inventory.transfers WHERE tenant_id = v_tenant_id
    );
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % transfer_lines records', v_deleted_count;
    
    -- Transfers
    DELETE FROM inventory.transfers WHERE tenant_id = v_tenant_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % transfers records', v_deleted_count;
    
    -- Purchase order lines (if exists)
    DELETE FROM supply_chain.purchase_order_lines 
    WHERE po_id IN (
        SELECT id FROM supply_chain.purchase_orders WHERE tenant_id = v_tenant_id
    );
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % purchase_order_lines records', v_deleted_count;
    
    -- Purchase orders
    DELETE FROM supply_chain.purchase_orders WHERE tenant_id = v_tenant_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % purchase_orders records', v_deleted_count;
    
    -- Stock balances
    DELETE FROM inventory.stock_balances WHERE tenant_id = v_tenant_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % stock_balances records', v_deleted_count;
    
    -- =====================================================
    -- Step 2: Delete master/parent records
    -- =====================================================
    
    -- Assets
    DELETE FROM inventory.assets WHERE tenant_id = v_tenant_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % assets records', v_deleted_count;
    
    -- Catalog items
    DELETE FROM inventory.catalog_items WHERE tenant_id = v_tenant_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % catalog_items records', v_deleted_count;
    
    -- Item categories
    DELETE FROM inventory.item_categories WHERE tenant_id = v_tenant_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % item_categories records', v_deleted_count;
    
    -- Locations
    DELETE FROM inventory.locations WHERE tenant_id = v_tenant_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % locations records', v_deleted_count;
    
    -- Vendors
    DELETE FROM supply_chain.vendors WHERE tenant_id = v_tenant_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % vendors records', v_deleted_count;
    
    -- =====================================================
    -- Step 3: Delete configuration data
    -- =====================================================
    
    -- Dashboards
    DELETE FROM public.dashboards WHERE tenant_id = v_tenant_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % dashboards records', v_deleted_count;
    
    -- Dashboard widgets
    DELETE FROM public.dashboard_widgets WHERE tenant_id = v_tenant_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % dashboard_widgets records', v_deleted_count;
    
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ Data cleanup complete!';
    RAISE NOTICE 'All transactional data has been deleted.';
    RAISE NOTICE 'Schema and structure remain intact.';
    RAISE NOTICE '========================================';
    
END $$;
