-- =====================================================
-- EVENT VERIFICATION TEST SCRIPT
-- =====================================================
-- Tests that all events are properly registered and
-- emission is working correctly after schema separation
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '=== TESTING EVENT SYSTEM ===';
END $$;

-- =====================================================
-- TEST 1: Verify Event Definitions Count
-- =====================================================

DO $$ 
DECLARE
    active_count INTEGER;
    supply_chain_count INTEGER;
    inventory_count INTEGER;
    deprecated_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO active_count 
    FROM public.event_definitions 
    WHERE status = 'active';
    
    SELECT COUNT(*) INTO supply_chain_count 
    FROM public.event_definitions 
    WHERE event_name LIKE 'supply_chain.%' AND status = 'active';
    
    SELECT COUNT(*) INTO inventory_count 
    FROM public.event_definitions 
    WHERE (event_name LIKE 'inventory.%' OR event_name NOT LIKE '%.%') 
    AND status = 'active'
    AND event_name NOT LIKE 'supply_chain.%';
    
    SELECT COUNT(*) INTO deprecated_count 
    FROM public.event_definitions 
    WHERE status = 'deprecated';
    
    RAISE NOTICE '✓ TEST 1: Event Definitions Count';
    RAISE NOTICE '  Active events: % (expected: 46)', active_count;
    RAISE NOTICE '  Supply chain events: % (expected: 12)', supply_chain_count;
    RAISE NOTICE '  Inventory events: % (expected: 34)', inventory_count;
    RAISE NOTICE '  Deprecated events: % (expected: 13)', deprecated_count;
    
    IF active_count = 46 AND supply_chain_count = 12 AND deprecated_count = 13 THEN
        RAISE NOTICE '  ✅ PASS';
    ELSE
        RAISE WARNING '  ⚠️  FAIL: Count mismatch';
    END IF;
END $$;

-- =====================================================
-- TEST 2: Verify Producer Alignment
-- =====================================================

DO $$ 
DECLARE
    misaligned_count INTEGER;
BEGIN
    -- Check for inventory producer on supply_chain events
    SELECT COUNT(*) INTO misaligned_count
    FROM public.event_definitions
    WHERE event_name LIKE 'supply_chain.%' 
    AND producer != 'supply_chain'
    AND status = 'active';
    
    RAISE NOTICE '✓ TEST 2: Producer Alignment';
    RAISE NOTICE '  Misaligned supply_chain events: % (expected: 0)', misaligned_count;
    
    IF misaligned_count = 0 THEN
        RAISE NOTICE '  ✅ PASS';
    ELSE
        RAISE WARNING '  ⚠️  FAIL: Some supply_chain events have wrong producer';
        
        -- Show the misaligned events
        RAISE NOTICE '  Misaligned events:';
        FOR rec IN 
            SELECT event_name, producer 
            FROM public.event_definitions
            WHERE event_name LIKE 'supply_chain.%' 
            AND producer != 'supply_chain'
            AND status = 'active'
        LOOP
            RAISE NOTICE '    - %: %', rec.event_name, rec.producer;
        END LOOP;
    END IF;
END $$;

-- =====================================================
-- TEST 3: Test Vendor Event Emission
-- =====================================================

DO $$ 
DECLARE
    v_test_vendor_id UUID;
    v_event_count INTEGER;
BEGIN
    RAISE NOTICE '✓ TEST 3: Vendor Event Emission';
    
    -- Insert test vendor
    INSERT INTO supply_chain.vendors (
        id, name, code, tenant_id
    ) VALUES (
        gen_random_uuid(),
        'TEST VENDOR - DELETE ME',
        'TEST001',
        'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd'
    )
    RETURNING id INTO v_test_vendor_id;
    
    -- Check if event was emitted
    SELECT COUNT(*) INTO v_event_count
    FROM inventory.events_outbox
    WHERE event_name = 'supply_chain.vendor.created'
    AND (payload->>'vendor_id')::uuid = v_test_vendor_id;
    
    IF v_event_count >= 1 THEN
        RAISE NOTICE '  ✅ PASS: Vendor created event emitted';
    ELSE
        RAISE WARNING '  ⚠️  FAIL: Vendor created event NOT emitted';
    END IF;
    
    -- Cleanup
    DELETE FROM supply_chain.vendors WHERE id = v_test_vendor_id;
    RAISE NOTICE '  Cleaned up test vendor';
END $$;

-- =====================================================
-- TEST 4: Test Purchase Order Event Emission
-- =====================================================

DO $$ 
DECLARE
    v_test_po_id UUID;
    v_test_vendor_id UUID;
    v_test_location_id UUID;
    v_event_count INTEGER;
BEGIN
    RAISE NOTICE '✓ TEST 4: Purchase Order Event Emission';
    
    -- Get or create test vendor
    SELECT id INTO v_test_vendor_id
    FROM supply_chain.vendors
    WHERE tenant_id = 'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd'
    LIMIT 1;
    
    IF v_test_vendor_id IS NULL THEN
        INSERT INTO supply_chain.vendors (name, code, tenant_id)
        VALUES ('Test Vendor', 'TV001', 'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd')
        RETURNING id INTO v_test_vendor_id;
    END IF;
    
    -- Get test location
    SELECT id INTO v_test_location_id
    FROM inventory.locations
    WHERE tenant_id = 'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd'
    AND active = true
    LIMIT 1;
    
    -- Insert test PO
    INSERT INTO supply_chain.purchase_orders (
        po_number,
        vendor_location_id,
        delivery_location_id,
        order_date,
        status,
        tenant_id
    ) VALUES (
        'TEST-PO-001',
        v_test_vendor_id,
        v_test_location_id,
        CURRENT_DATE,
        'draft',
        'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd'
    )
    RETURNING id INTO v_test_po_id;
    
    -- Check if event was emitted
    SELECT COUNT(*) INTO v_event_count
    FROM inventory.events_outbox
    WHERE event_name = 'supply_chain.purchase_order.created'
    AND (payload->>'po_id')::uuid = v_test_po_id;
    
    IF v_event_count >= 1 THEN
        RAISE NOTICE '  ✅ PASS: PO created event emitted';
    ELSE
        RAISE WARNING '  ⚠️  FAIL: PO created event NOT emitted';
    END IF;
    
    -- Cleanup
    DELETE FROM supply_chain.purchase_orders WHERE id = v_test_po_id;
    RAISE NOTICE '  Cleaned up test PO';
END $$;

-- =====================================================
-- TEST 5: Test Receipt Event Emission
-- =====================================================

DO $$ 
DECLARE
    v_test_receipt_id UUID;
    v_test_location_id UUID;
    v_event_count INTEGER;
BEGIN
    RAISE NOTICE '✓ TEST 5: Receipt Event Emission';
    
    -- Get test location
    SELECT id INTO v_test_location_id
    FROM inventory.locations
    WHERE tenant_id = 'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd'
    AND active = true
    LIMIT 1;
    
    -- Insert test receipt
    INSERT INTO supply_chain.receipts (
        receipt_number,
        location_id,
        received_at,
        tenant_id
    ) VALUES (
        'TEST-RCV-001',
        v_test_location_id,
        NOW(),
        'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd'
    )
    RETURNING id INTO v_test_receipt_id;
    
    -- Check if event was emitted
    SELECT COUNT(*) INTO v_event_count
    FROM inventory.events_outbox
    WHERE event_name = 'supply_chain.receipt.created'
    AND (payload->>'receipt_id')::uuid = v_test_receipt_id;
    
    IF v_event_count >= 1 THEN
        RAISE NOTICE '  ✅ PASS: Receipt created event emitted';
    ELSE
        RAISE WARNING '  ⚠️  FAIL: Receipt created event NOT emitted';
    END IF;
    
    -- Cleanup
    DELETE FROM supply_chain.receipts WHERE id = v_test_receipt_id;
    RAISE NOTICE '  Cleaned up test receipt';
END $$;

-- =====================================================
-- TEST 6: Verify No Orphaned Events in Outbox
-- =====================================================

DO $$ 
DECLARE
    orphaned_count INTEGER;
BEGIN
    RAISE NOTICE '✓ TEST 6: Orphaned Events Check';
    
    -- Check for events with names not in event_definitions
    SELECT COUNT(*) INTO orphaned_count
    FROM inventory.events_outbox eo
    WHERE NOT EXISTS (
        SELECT 1 
        FROM public.event_definitions ed
        WHERE ed.event_name = eo.event_name
    );
    
    RAISE NOTICE '  Orphaned events in outbox: % (expected: 0)', orphaned_count;
    
    IF orphaned_count = 0 THEN
        RAISE NOTICE '  ✅ PASS';
    ELSE
        RAISE WARNING '  ⚠️  FAIL: Found events without definitions';
    END IF;
END $$;

-- =====================================================
-- FINAL SUMMARY
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== EVENT SYSTEM VERIFICATION COMPLETE ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Manual Verification Recommended:';
  RAISE NOTICE '1. Check frontend subscriptions for new event names';
  RAISE NOTICE '2. Update webhook consumers within 90 days';
  RAISE NOTICE '3. Monitor events_outbox for stuck events';
  RAISE NOTICE '4. Review EVENT_CATALOG.md for integration guide';
END $$;
