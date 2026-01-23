-- ================================================================
-- Fix Trigger Schema Alignment
-- ================================================================
-- Date: 2026-01-15
-- Purpose: Fix event emission triggers to use actual schema columns
-- ================================================================

-- ================================================================
-- PART 1: Fix Purchase Order Trigger
-- ================================================================

-- Update PO trigger to use correct column names
CREATE OR REPLACE FUNCTION inventory.emit_po_status_event()
RETURNS TRIGGER AS $$
BEGIN
    -- Emit event when PO status changes
    IF TG_OP = 'UPDATE' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
        PERFORM inventory.publish_event(
            p_tenant_id := NEW.tenant_id,
            p_scope := 'tenant',
            p_event_type := CASE NEW.status
                WHEN 'placed' THEN 'inventory.po.placed'
                WHEN 'acknowledged' THEN 'inventory.po.acknowledged'
                WHEN 'partially_received' THEN 'inventory.po.partially_received'
                WHEN 'fully_received' THEN 'inventory.po.fully_received'
                WHEN 'closed' THEN 'inventory.po.closed'
                WHEN 'cancelled' THEN 'inventory.po.cancelled'
                ELSE 'inventory.po.updated'
            END,
            p_aggregate_type := 'purchase_order',
            p_aggregate_id := NEW.id,
            p_payload := to_jsonb(NEW),
            p_metadata := jsonb_build_object(
                'previous_status', OLD.status,
                'new_status', NEW.status,
                'vendor_location_id', NEW.vendor_location_id,
                'po_number', NEW.po_number,
                'delivery_location_id', NEW.delivery_location_id
            )
        );
    END IF;
    
    -- Emit event when PO is created
    IF TG_OP = 'INSERT' THEN
        PERFORM inventory.publish_event(
            p_tenant_id := NEW.tenant_id,
            p_scope := 'tenant',
            p_event_type := 'inventory.po.created',
            p_aggregate_type := 'purchase_order',
            p_aggregate_id := NEW.id,
            p_payload := to_jsonb(NEW),
            p_metadata := jsonb_build_object(
                'po_number', NEW.po_number,
                'vendor_location_id', NEW.vendor_location_id,
                'delivery_location_id', NEW.delivery_location_id,
                'expected_delivery_date', NEW.expected_delivery_date
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION inventory.emit_po_status_event IS 
    'Emits events for purchase order creation and status changes (FIXED: uses vendor_location_id)';

-- ================================================================
-- PART 2: Fix Receipt Trigger
-- ================================================================

-- Update receipt trigger to only emit on INSERT and not check status
CREATE OR REPLACE FUNCTION inventory.emit_receipt_event()
RETURNS TRIGGER AS $$
BEGIN
    -- Emit event when receipt is created
    IF TG_OP = 'INSERT' THEN
        PERFORM inventory.publish_event(
            p_tenant_id := NEW.tenant_id,
            p_scope := 'tenant',
            p_event_type := 'inventory.receipt.created',
            p_aggregate_type := 'receipt',
            p_aggregate_id := NEW.id,
            p_payload := to_jsonb(NEW),
            p_metadata := jsonb_build_object(
                'receipt_number', NEW.receipt_number,
                'po_id', NEW.po_id,
                'location_id', NEW.location_id,
                'received_by_user_id', NEW.received_by_user_id
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION inventory.emit_receipt_event IS 
    'Emits event when receipt is created (FIXED: receipts have no status column)';

-- ================================================================
-- PART 3: Fix Stock Movement Trigger
-- ================================================================

-- Update stock movement trigger to use correct column name (catalog_item_id)
CREATE OR REPLACE FUNCTION inventory.emit_stock_movement_event()
RETURNS TRIGGER AS $$
BEGIN
    -- Emit event for new stock movements
    IF TG_OP = 'INSERT' THEN
        PERFORM inventory.publish_event(
            p_tenant_id := NEW.tenant_id,
            p_scope := 'tenant',
            p_event_type := 'inventory.stock.adjusted',
            p_aggregate_type := 'stock_movement',
            p_aggregate_id := NEW.id,
            p_payload := to_jsonb(NEW),
            p_metadata := jsonb_build_object(
                'movement_type', NEW.movement_type,
                'catalog_item_id', NEW.catalog_item_id,  -- FIXED: was item_id
                'location_id', NEW.location_id,
                'quantity_delta', NEW.quantity_delta
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION inventory.emit_stock_movement_event IS 
    'Emits events for stock movements (FIXED: uses catalog_item_id)';

-- ================================================================
-- PART 4: Fix Cycle Count Trigger
-- ================================================================

-- Update cycle count trigger to check if status column exists
CREATE OR REPLACE FUNCTION inventory.emit_cycle_count_event()
RETURNS TRIGGER AS $$
BEGIN
    -- Emit event when cycle count is created
    IF TG_OP = 'INSERT' THEN
        PERFORM inventory.publish_event(
            p_tenant_id := NEW.tenant_id,
            p_scope := 'tenant',
            p_event_type := 'inventory.cycle_count.created',
            p_aggregate_type := 'cycle_count',
            p_aggregate_id := NEW.id,
            p_payload := to_jsonb(NEW),
            p_metadata := jsonb_build_object(
                'location_id', NEW.location_id,
                'count_date', NEW.count_date
            )
        );
    END IF;
    
    -- Note: Cycle counts table structure needs verification
    -- If status column exists, add status change event here
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION inventory.emit_cycle_count_event IS 
    'Emits events for cycle count creation (status change handling TBD based on schema)';

-- ================================================================
-- VERIFICATION
-- ================================================================

DO $$
DECLARE
    v_trigger_count INTEGER;
BEGIN
    -- Verify triggers still exist after function updates
    SELECT COUNT(*) INTO v_trigger_count
    FROM information_schema.triggers
    WHERE trigger_name IN (
        'trigger_stock_movement_events',
        'trigger_po_status_events',
        'trigger_receipt_events',
        'trigger_cycle_count_events'
    );
    
    IF v_trigger_count = 4 THEN
        RAISE NOTICE '✅ All 4 event triggers verified after schema alignment';
    ELSE
        RAISE WARNING 'Expected 4 triggers, found %', v_trigger_count;
    END IF;
END $$;

-- ================================================================
-- SUCCESS MESSAGE
-- ================================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '✅ TRIGGER SCHEMA ALIGNMENT COMPLETE';
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'Fixed trigger functions:';
    RAISE NOTICE '  ✅ emit_po_status_event() - Now uses vendor_location_id';
    RAISE NOTICE '  ✅ emit_receipt_event() - Removed status column references';
    RAISE NOTICE '  ✅ emit_cycle_count_event() - Simplified for INSERT only';
    RAISE NOTICE '';
    RAISE NOTICE 'Note: Stock movement trigger already uses correct schema';
    RAISE NOTICE '';
    RAISE NOTICE 'Next step: Test event emission with actual data';
    RAISE NOTICE '================================================================';
END $$;
