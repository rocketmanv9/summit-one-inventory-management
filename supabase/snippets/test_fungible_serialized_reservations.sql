-- =====================================================
-- Test Suite for Fungible vs Serialized Reservations
-- =====================================================
-- Execute these tests to validate the implementation

-- Setup: Get tenant_id
DO $$
DECLARE
    v_tenant_id UUID := 'ae837809-1a24-4ab5-ba06-34fd98c05f48';
BEGIN
    RAISE NOTICE 'Testing with tenant_id: %', v_tenant_id;
END $$;

-- =====================================================
-- TEST 1: Fungible Reservation (6 Rakes)
-- =====================================================

-- Find a fungible item
SELECT 
    id AS catalog_item_id,
    sku,
    name,
    tracking_mode
FROM inventory.catalog_items
WHERE tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
  AND tracking_mode IN ('stock', 'fungible')
  AND deleted_at IS NULL
LIMIT 5;

-- Find a location with stock
SELECT 
    sb.location_id,
    l.name AS location_name,
    sb.catalog_item_id,
    ci.name AS item_name,
    sb.qty_on_hand,
    sb.qty_reserved,
    sb.qty_available
FROM inventory.stock_balances sb
JOIN inventory.locations l ON l.id = sb.location_id
JOIN inventory.catalog_items ci ON ci.id = sb.catalog_item_id
WHERE sb.tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
  AND sb.qty_available >= 6
LIMIT 5;

-- Test: Validate fungible availability
SELECT * FROM inventory.validate_fungible_reservation_availability(
    p_tenant_id := 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
    p_catalog_item_id := (
        SELECT sb.catalog_item_id 
        FROM inventory.stock_balances sb
        WHERE sb.tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
          AND sb.qty_available >= 6
        LIMIT 1
    ),
    p_location_id := (
        SELECT sb.location_id 
        FROM inventory.stock_balances sb
        WHERE sb.tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
          AND sb.qty_available >= 6
        LIMIT 1
    ),
    p_qty := 6
);

-- Test: Create fungible reservation
DO $$
DECLARE
    v_reservation_id UUID;
    v_catalog_item_id UUID;
    v_location_id UUID;
BEGIN
    -- Get item and location with stock
    SELECT sb.catalog_item_id, sb.location_id
    INTO v_catalog_item_id, v_location_id
    FROM inventory.stock_balances sb
    WHERE sb.tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
      AND sb.qty_available >= 6
    LIMIT 1;
    
    IF v_catalog_item_id IS NULL THEN
        RAISE NOTICE '❌ No items with sufficient stock found. Create some stock first.';
        RETURN;
    END IF;
    
    -- Create reservation
    SELECT inventory.rpc_inv_reserve_fungible(
        p_tenant_id := 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
        p_catalog_item_id := v_catalog_item_id,
        p_location_id := v_location_id,
        p_qty := 6,
        p_allocation_type := 'job',
        p_external_order_ref := 'TEST-JOB-123',
        p_notes := 'Test fungible reservation',
        p_last_event_id := 'test_fungible_' || gen_random_uuid()::TEXT
    ) INTO v_reservation_id;
    
    RAISE NOTICE '✓ Created fungible reservation: %', v_reservation_id;
    
    -- Verify
    PERFORM 1
    FROM inventory.reservations
    WHERE id = v_reservation_id
      AND reservation_type = 'fungible'
      AND qty = 6
      AND asset_id IS NULL;
    
    IF FOUND THEN
        RAISE NOTICE '✓ Fungible reservation validated';
    ELSE
        RAISE NOTICE '❌ Fungible reservation validation failed';
    END IF;
END $$;


-- =====================================================
-- TEST 2: Serialized Asset Reservation
-- =====================================================

-- Find serialized assets
SELECT 
    a.id AS asset_id,
    a.asset_tag,
    a.serial_number,
    a.status,
    ci.name AS item_type,
    l.name AS location_name
FROM inventory.assets a
LEFT JOIN inventory.catalog_items ci ON ci.id = a.catalog_item_id
LEFT JOIN inventory.locations l ON l.id = a.location_id
WHERE a.tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
  AND a.status IN ('available', 'assigned')
LIMIT 10;

-- Test: Find available assets
SELECT * FROM inventory.rpc_inv_find_available_assets(
    p_tenant_id := 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
    p_catalog_item_id := (
        SELECT catalog_item_id 
        FROM inventory.assets 
        WHERE tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
        LIMIT 1
    ),
    p_reserved_from := NOW(),
    p_reserved_until := NOW() + INTERVAL '4 hours',
    p_limit := 10
);

-- Test: Validate asset availability
SELECT * FROM inventory.validate_asset_reservation_availability(
    p_tenant_id := 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
    p_asset_id := (
        SELECT id 
        FROM inventory.assets 
        WHERE tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
          AND status = 'available'
        LIMIT 1
    ),
    p_reserved_from := NOW(),
    p_reserved_until := NOW() + INTERVAL '4 hours'
);

-- Test: Create serialized asset reservation
DO $$
DECLARE
    v_reservation_id UUID;
    v_asset_id UUID;
BEGIN
    -- Get an available asset
    SELECT id INTO v_asset_id
    FROM inventory.assets
    WHERE tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
      AND status = 'available'
    LIMIT 1;
    
    IF v_asset_id IS NULL THEN
        RAISE NOTICE '❌ No available assets found. Create some assets first.';
        RETURN;
    END IF;
    
    -- Create reservation
    SELECT inventory.rpc_inv_reserve_asset(
        p_tenant_id := 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
        p_asset_id := v_asset_id,
        p_allocation_type := 'job',
        p_external_order_ref := 'TEST-JOB-456',
        p_reserved_from := NOW(),
        p_reserved_until := NOW() + INTERVAL '4 hours',
        p_notes := 'Test serialized asset reservation',
        p_last_event_id := 'test_asset_' || gen_random_uuid()::TEXT
    ) INTO v_reservation_id;
    
    RAISE NOTICE '✓ Created serialized reservation: %', v_reservation_id;
    
    -- Verify
    PERFORM 1
    FROM inventory.reservations
    WHERE id = v_reservation_id
      AND reservation_type = 'serialized'
      AND asset_id = v_asset_id
      AND qty = 1;
    
    IF FOUND THEN
        RAISE NOTICE '✓ Serialized reservation validated';
    ELSE
        RAISE NOTICE '❌ Serialized reservation validation failed';
    END IF;
END $$;


-- =====================================================
-- TEST 3: Double-Booking Prevention
-- =====================================================

-- Test: Try to reserve same asset in overlapping time window
DO $$
DECLARE
    v_asset_id UUID;
    v_reservation_id_1 UUID;
    v_reservation_id_2 UUID;
BEGIN
    -- Get an available asset
    SELECT id INTO v_asset_id
    FROM inventory.assets
    WHERE tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
      AND status = 'available'
      AND NOT EXISTS (
          SELECT 1 FROM inventory.reservations r
          WHERE r.asset_id = assets.id AND r.status = 'active'
      )
    LIMIT 1;
    
    IF v_asset_id IS NULL THEN
        RAISE NOTICE '❌ No unreserved assets found';
        RETURN;
    END IF;
    
    -- First reservation
    BEGIN
        SELECT inventory.rpc_inv_reserve_asset(
            p_tenant_id := 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
            p_asset_id := v_asset_id,
            p_reserved_from := NOW() + INTERVAL '1 hour',
            p_reserved_until := NOW() + INTERVAL '5 hours',
            p_external_order_ref := 'TEST-OVERLAP-1',
            p_last_event_id := 'test_overlap_1_' || gen_random_uuid()::TEXT
        ) INTO v_reservation_id_1;
        
        RAISE NOTICE '✓ First reservation created: %', v_reservation_id_1;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE '❌ First reservation failed: %', SQLERRM;
            RETURN;
    END;
    
    -- Second reservation (overlapping)
    BEGIN
        SELECT inventory.rpc_inv_reserve_asset(
            p_tenant_id := 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
            p_asset_id := v_asset_id,
            p_reserved_from := NOW() + INTERVAL '3 hours',
            p_reserved_until := NOW() + INTERVAL '7 hours',
            p_external_order_ref := 'TEST-OVERLAP-2',
            p_last_event_id := 'test_overlap_2_' || gen_random_uuid()::TEXT
        ) INTO v_reservation_id_2;
        
        RAISE NOTICE '❌ Second reservation should have failed but succeeded: %', v_reservation_id_2;
    EXCEPTION
        WHEN check_violation THEN
            RAISE NOTICE '✓ Double-booking prevented: %', SQLERRM;
        WHEN OTHERS THEN
            RAISE NOTICE '❌ Unexpected error: %', SQLERRM;
    END;
END $$;


-- =====================================================
-- TEST 4: Idempotency
-- =====================================================

-- Test: Same event_id twice
DO $$
DECLARE
    v_reservation_id_1 UUID;
    v_reservation_id_2 UUID;
    v_event_id TEXT := 'test_idempotency_' || gen_random_uuid()::TEXT;
    v_catalog_item_id UUID;
    v_location_id UUID;
BEGIN
    -- Get item and location
    SELECT sb.catalog_item_id, sb.location_id
    INTO v_catalog_item_id, v_location_id
    FROM inventory.stock_balances sb
    WHERE sb.tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
      AND sb.qty_available >= 2
    LIMIT 1;
    
    IF v_catalog_item_id IS NULL THEN
        RAISE NOTICE '❌ No stock available for test';
        RETURN;
    END IF;
    
    -- First call
    SELECT inventory.rpc_inv_reserve_fungible(
        p_tenant_id := 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
        p_catalog_item_id := v_catalog_item_id,
        p_location_id := v_location_id,
        p_qty := 2,
        p_last_event_id := v_event_id
    ) INTO v_reservation_id_1;
    
    RAISE NOTICE 'First call returned: %', v_reservation_id_1;
    
    -- Second call (same event_id)
    SELECT inventory.rpc_inv_reserve_fungible(
        p_tenant_id := 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
        p_catalog_item_id := v_catalog_item_id,
        p_location_id := v_location_id,
        p_qty := 2,
        p_last_event_id := v_event_id
    ) INTO v_reservation_id_2;
    
    RAISE NOTICE 'Second call returned: %', v_reservation_id_2;
    
    IF v_reservation_id_1 = v_reservation_id_2 THEN
        RAISE NOTICE '✓ Idempotency validated (same ID returned)';
    ELSE
        RAISE NOTICE '❌ Idempotency failed (different IDs)';
    END IF;
    
    -- Check only one reservation exists
    PERFORM 1
    FROM inventory.reservations
    WHERE tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
      AND last_event_id = v_event_id
    HAVING COUNT(*) = 1;
    
    IF FOUND THEN
        RAISE NOTICE '✓ Only one reservation created';
    ELSE
        RAISE NOTICE '❌ Multiple reservations created for same event_id';
    END IF;
END $$;


-- =====================================================
-- TEST 5: Query Summary View
-- =====================================================

SELECT 
    reservation_type,
    status,
    item_name,
    location_name,
    qty,
    asset_tag,
    external_order_ref,
    reserved_from,
    reserved_until,
    is_expired
FROM inventory.v_reservation_summary
WHERE tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
ORDER BY created_at DESC
LIMIT 20;


-- =====================================================
-- TEST 6: Cleanup Test Data
-- =====================================================

-- Uncomment to clean up test reservations
/*
DELETE FROM inventory.reservations
WHERE tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
  AND external_order_ref LIKE 'TEST-%';

RAISE NOTICE 'Test reservations cleaned up';
*/
