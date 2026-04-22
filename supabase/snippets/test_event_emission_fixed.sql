-- ================================================================
-- Test Event Emission (Fixed Schema)
-- ================================================================

-- Test 1: Stock Movement Event
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_tenant_id UUID := 'ae837809-1a24-4ab5-ba06-34fd98c05f48';
    v_item_id UUID;
    v_location_id UUID;
    v_movement_id UUID;
BEGIN
    SELECT id INTO v_item_id 
    FROM inventory.catalog_items 
    WHERE tenant_id = v_tenant_id 
    LIMIT 1;
    
    SELECT id INTO v_location_id 
    FROM inventory.locations 
    WHERE tenant_id = v_tenant_id 
    LIMIT 1;
    
    -- Create stock movement with VALID movement_type
    INSERT INTO inventory.stock_movements (
        tenant_id,
        catalog_item_id,
        location_id,
        movement_type,
        quantity_delta,
        unit_cost,
        last_event_id,
        notes
    ) VALUES (
        v_tenant_id,
        v_item_id,
        v_location_id,
        'adjusted',  -- FIXED: Use 'adjusted' not 'adjustment'
        10,
        5.00,
        'test-' || gen_random_uuid()::text,
        'COMPLIANCE TEST: Stock adjustment event'
    ) RETURNING id INTO v_movement_id;
    
    RAISE NOTICE '✅ Created stock movement: %', v_movement_id;
END $$;

-- Test 2: Purchase Order Status Change Event
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_tenant_id UUID := 'ae837809-1a24-4ab5-ba06-34fd98c05f48';
    v_po_id UUID;
BEGIN
    SELECT id INTO v_po_id
    FROM inventory.purchase_orders
    WHERE tenant_id = v_tenant_id
    AND status = 'draft'
    LIMIT 1;
    
    IF v_po_id IS NOT NULL THEN
        UPDATE inventory.purchase_orders
        SET status = 'placed'
        WHERE id = v_po_id;
        
        RAISE NOTICE '✅ Updated PO status: %', v_po_id;
    ELSE
        RAISE NOTICE '⚠️ No draft POs found to update';
    END IF;
END $$;

-- Test 3: Receipt Creation Event
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_tenant_id UUID := 'ae837809-1a24-4ab5-ba06-34fd98c05f48';
    v_po_id UUID;
    v_location_id UUID;
    v_receipt_id UUID;
BEGIN
    SELECT id INTO v_po_id
    FROM inventory.purchase_orders
    WHERE tenant_id = v_tenant_id
    LIMIT 1;
    
    SELECT id INTO v_location_id
    FROM inventory.locations
    WHERE tenant_id = v_tenant_id
    LIMIT 1;
    
    IF v_po_id IS NOT NULL AND v_location_id IS NOT NULL THEN
        INSERT INTO inventory.receipts (
            tenant_id,
            po_id,
            receipt_number,
            location_id,
            last_event_id,
            notes
        ) VALUES (
            v_tenant_id,
            v_po_id,
            'RCV-TEST-' || gen_random_uuid()::text,
            v_location_id,
            'test-rcpt-' || gen_random_uuid()::text,
            'COMPLIANCE TEST: Receipt creation event'
        ) RETURNING id INTO v_receipt_id;
        
        RAISE NOTICE '✅ Created receipt: %', v_receipt_id;
    ELSE
        RAISE NOTICE '⚠️ Missing PO or location for receipt test';
    END IF;
END $$;

-- ================================================================
-- Verify Events in Outbox
-- ================================================================

SELECT 
    event_type,
    aggregate_type,
    status,
    retry_count,
    created_at,
    metadata->>'po_number' as po_number,
    metadata->>'receipt_number' as receipt_number,
    metadata->>'movement_type' as movement_type
FROM inventory.events_outbox
ORDER BY created_at DESC
LIMIT 10;

-- ================================================================
-- Event Summary
-- ================================================================

SELECT 
    event_type,
    COUNT(*) as event_count,
    MIN(created_at) as first_event,
    MAX(created_at) as latest_event
FROM inventory.events_outbox
GROUP BY event_type
ORDER BY event_type;
