-- Helper queries for testing and development
-- DO NOT run this as a migration - these are example queries

-- =====================================================
-- EXAMPLE: Insert a test tenant's data
-- =====================================================

-- Set a test tenant_id (replace with actual UUID)
DO $$
DECLARE
    v_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
    v_category_id UUID;
    v_item_id UUID;
    v_location_id UUID;
    v_asset_id UUID;
BEGIN
    -- Create a category
    INSERT INTO inventory.item_categories (tenant_id, name)
    VALUES (v_tenant_id, 'Equipment')
    RETURNING id INTO v_category_id;

    -- Create a catalog item
    INSERT INTO inventory.catalog_items (tenant_id, sku, name, tracking_mode, uom, category_id)
    VALUES (v_tenant_id, 'PUMP-001', 'Water Pump', 'both', 'EA', v_category_id)
    RETURNING id INTO v_item_id;

    -- Create a location
    INSERT INTO inventory.locations (tenant_id, location_type, name)
    VALUES (v_tenant_id, 'warehouse', 'Main Warehouse')
    RETURNING id INTO v_location_id;

    -- Create an asset
    INSERT INTO inventory.assets (tenant_id, catalog_item_id, asset_tag, serial_number, status, home_location_id)
    VALUES (v_tenant_id, v_item_id, 'ASSET-001', 'SN123456', 'available', v_location_id)
    RETURNING id INTO v_asset_id;

    -- Initialize stock balance
    INSERT INTO inventory.stock_balances (tenant_id, catalog_item_id, location_id, qty_on_hand)
    VALUES (v_tenant_id, v_item_id, v_location_id, 100);

    -- Initialize asset state
    INSERT INTO inventory.asset_state (id, tenant_id, asset_id, current_location_id, current_status)
    VALUES (uuid_generate_v4(), v_tenant_id, v_asset_id, v_location_id, 'available');

    RAISE NOTICE 'Test data created successfully';
END $$;

-- =====================================================
-- EXAMPLE: Insert an inventory event (idempotent)
-- =====================================================

-- Using the helper function
SELECT inventory.insert_inventory_event(
    p_tenant_id := '00000000-0000-0000-0000-000000000001'::UUID,
    p_event_type := 'receive',
    p_occurred_at := NOW(),
    p_actor_user_id := NULL,
    p_source_system := 'manual',
    p_last_event_id := 'evt_receive_001',
    p_payload := jsonb_build_object(
        'catalog_item_id', '00000000-0000-0000-0000-000000000002',
        'location_id', '00000000-0000-0000-0000-000000000003',
        'qty', 50,
        'reason', 'Initial stock'
    )
);

-- Run again - will not create duplicate due to idempotency
SELECT inventory.insert_inventory_event(
    p_tenant_id := '00000000-0000-0000-0000-000000000001'::UUID,
    p_event_type := 'receive',
    p_occurred_at := NOW(),
    p_actor_user_id := NULL,
    p_source_system := 'manual',
    p_last_event_id := 'evt_receive_001', -- Same event ID
    p_payload := jsonb_build_object(
        'catalog_item_id', '00000000-0000-0000-0000-000000000002',
        'location_id', '00000000-0000-0000-0000-000000000003',
        'qty', 50,
        'reason', 'Initial stock'
    )
);

-- =====================================================
-- USEFUL QUERIES FOR DEVELOPMENT
-- =====================================================

-- View all stock balances with item names
SELECT 
    sb.tenant_id,
    ci.sku,
    ci.name AS item_name,
    l.name AS location_name,
    sb.qty_on_hand,
    sb.qty_reserved,
    sb.qty_available,
    sb.updated_at
FROM inventory.stock_balances sb
JOIN inventory.catalog_items ci ON sb.catalog_item_id = ci.id
JOIN inventory.locations l ON sb.location_id = l.id
ORDER BY sb.updated_at DESC;

-- View all active reservations
SELECT 
    r.id,
    ci.sku,
    ci.name AS item_name,
    l.name AS location_name,
    r.qty,
    r.status,
    r.needed_by,
    r.job_ref,
    r.created_at
FROM inventory.reservations r
JOIN inventory.catalog_items ci ON r.catalog_item_id = ci.id
JOIN inventory.locations l ON r.location_id = l.id
WHERE r.status = 'active'
ORDER BY r.needed_by NULLS LAST, r.created_at;

-- View all assets with current state
SELECT 
    a.asset_tag,
    a.serial_number,
    a.vin,
    ci.name AS item_name,
    ast.current_status,
    l.name AS current_location,
    ast.assigned_to_ref,
    ast.last_movement_at
FROM inventory.assets a
LEFT JOIN inventory.catalog_items ci ON a.catalog_item_id = ci.id
LEFT JOIN inventory.asset_state ast ON a.id = ast.asset_id
LEFT JOIN inventory.locations l ON ast.current_location_id = l.id
WHERE a.active = true
ORDER BY a.asset_tag;

-- Recent inventory events
SELECT 
    e.id,
    e.event_type,
    e.occurred_at,
    e.source_system,
    e.payload->>'catalog_item_id' AS item_id,
    e.payload->>'qty' AS qty,
    e.payload->>'location_id' AS location_id,
    e.payload->>'reason' AS reason
FROM inventory.inventory_events e
ORDER BY e.occurred_at DESC
LIMIT 100;

-- Daily activity summary
SELECT 
    dia.activity_date,
    ci.sku,
    ci.name AS item_name,
    l.name AS location_name,
    dia.qty_received,
    dia.qty_issued,
    dia.qty_adjusted,
    dia.net_change
FROM inventory.daily_item_activity dia
JOIN inventory.catalog_items ci ON dia.catalog_item_id = ci.id
LEFT JOIN inventory.locations l ON dia.location_id = l.id
WHERE dia.activity_date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY dia.activity_date DESC, ci.sku;

-- Check for low stock items (example)
SELECT 
    ci.sku,
    ci.name,
    l.name AS location_name,
    sb.qty_available,
    sb.qty_reserved
FROM inventory.stock_balances sb
JOIN inventory.catalog_items ci ON sb.catalog_item_id = ci.id
JOIN inventory.locations l ON sb.location_id = l.id
WHERE sb.qty_available < 10 -- Adjust threshold as needed
ORDER BY sb.qty_available;

-- Find items with no movement in last 90 days
SELECT 
    ci.sku,
    ci.name,
    l.name AS location_name,
    sb.qty_on_hand,
    MAX(dia.activity_date) AS last_activity_date
FROM inventory.stock_balances sb
JOIN inventory.catalog_items ci ON sb.catalog_item_id = ci.id
JOIN inventory.locations l ON sb.location_id = l.id
LEFT JOIN inventory.daily_item_activity dia ON 
    dia.catalog_item_id = ci.id AND 
    dia.location_id = l.id
WHERE sb.qty_on_hand > 0
GROUP BY ci.sku, ci.name, l.name, sb.qty_on_hand
HAVING MAX(dia.activity_date) < CURRENT_DATE - INTERVAL '90 days'
    OR MAX(dia.activity_date) IS NULL
ORDER BY last_activity_date NULLS FIRST;

-- =====================================================
-- CLEAN UP TEST DATA (use with caution!)
-- =====================================================

-- Delete all data for a specific tenant
-- UNCOMMENT TO USE - BE CAREFUL!
/*
DO $$
DECLARE
    v_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
    -- Delete in reverse order of dependencies
    DELETE FROM inventory.cycle_count_lines WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.cycle_counts WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.receipt_lines WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.receipts WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.purchase_order_lines WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.purchase_orders WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.daily_asset_metrics WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.daily_item_activity WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.asset_state WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.reservations WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.stock_balances WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.procurement_events WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.asset_events WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.inventory_events WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.identifiers WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.assets WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.locations WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.catalog_items WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.item_categories WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.dashboard_widgets WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.dashboards WHERE tenant_id = v_tenant_id;
    
    RAISE NOTICE 'Deleted all data for tenant %', v_tenant_id;
END $$;
*/
