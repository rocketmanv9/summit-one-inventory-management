-- ================================================================
-- Test Event Emission
-- ================================================================
-- This script tests the compliance remediation by creating sample
-- business events and verifying they appear in the events_outbox
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
    -- Get first catalog item and location
    SELECT id INTO v_item_id 
    FROM inventory.catalog_items 
    WHERE tenant_id = v_tenant_id 
    LIMIT 1;
    
    SELECT id INTO v_location_id 
    FROM inventory.locations 
    WHERE tenant_id = v_tenant_id 
    LIMIT 1;
    
    -- Create stock movement (should trigger event)
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
        'adjustment',
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
    -- Get first PO in draft status
    SELECT id INTO v_po_id
    FROM inventory.purchase_orders
    WHERE tenant_id = v_tenant_id
    AND status = 'draft'
    LIMIT 1;
    
    IF v_po_id IS NOT NULL THEN
        -- Update PO status (should trigger event)
        UPDATE inventory.purchase_orders
        SET status = 'placed'
        WHERE id = v_po_id;
        
        RAISE NOTICE '✅ Updated PO status: %', v_po_id;
    ELSE
        RAISE NOTICE '⚠️ No draft POs found to update';
    END IF;
END $$;

-- Test 3: Receipt Completion Event
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_tenant_id UUID := 'ae837809-1a24-4ab5-ba06-34fd98c05f48';
    v_receipt_id UUID;
BEGIN
    -- Get first receipt in receiving status
    SELECT id INTO v_receipt_id
    FROM inventory.receipts
    WHERE tenant_id = v_tenant_id
    AND status = 'receiving'
    LIMIT 1;
    
    IF v_receipt_id IS NOT NULL THEN
        -- Complete receipt (should trigger event)
        UPDATE inventory.receipts
        SET status = 'completed'
        WHERE id = v_receipt_id;
        
        RAISE NOTICE '✅ Completed receipt: %', v_receipt_id;
    ELSE
        RAISE NOTICE '⚠️ No receipts in receiving status found';
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
    metadata->>'item_id' as item_id,
    metadata->>'previous_status' as prev_status,
    metadata->>'new_status' as new_status
FROM inventory.events_outbox
ORDER BY created_at DESC
LIMIT 10;

-- ================================================================
-- Verify Event Counts
-- ================================================================

SELECT 
    event_type,
    status,
    COUNT(*) as event_count
FROM inventory.events_outbox
GROUP BY event_type, status
ORDER BY event_type, status;
