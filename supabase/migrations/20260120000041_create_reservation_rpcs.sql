-- ============================================================================
-- PHASE 5: RESERVATION RPCs
-- ============================================================================
-- Dispatch-safe reservation create/fulfill/release

-- =====================================================
-- Create Reservation
-- =====================================================
CREATE OR REPLACE FUNCTION inventory.rpc_inv_reserve(
    p_tenant_id UUID,
    p_catalog_item_id UUID,
    p_location_id UUID,
    p_qty NUMERIC,
    p_allocation_type TEXT DEFAULT NULL,
    p_job_ref JSONB DEFAULT NULL,
    p_external_order_ref TEXT DEFAULT NULL,
    p_needed_by DATE DEFAULT NULL,
    p_expiration_date DATE DEFAULT NULL,
    p_last_event_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_reservation_id UUID;
    v_event_id TEXT;
    v_available_qty NUMERIC;
BEGIN
    -- Validate
    IF p_tenant_id IS NULL OR p_catalog_item_id IS NULL OR p_location_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id, catalog_item_id, and location_id are required';
    END IF;
    
    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'qty must be greater than 0';
    END IF;
    
    -- Generate event ID
    v_event_id := COALESCE(p_last_event_id, 'reserve_' || gen_random_uuid()::TEXT);
    
    -- Check available quantity
    SELECT COALESCE(qty_available, 0) INTO v_available_qty
    FROM inventory.stock_balances
    WHERE tenant_id = p_tenant_id
    AND catalog_item_id = p_catalog_item_id
    AND location_id = p_location_id;
    
    IF v_available_qty < p_qty THEN
        RAISE EXCEPTION 'Insufficient available quantity: % available, % requested', 
            v_available_qty, p_qty;
    END IF;
    
    -- Create reservation (idempotent)
    INSERT INTO inventory.reservations (
        tenant_id,
        catalog_item_id,
        location_id,
        qty,
        status,
        allocation_type,
        job_ref,
        external_order_ref,
        needed_by,
        expiration_date,
        last_event_id
    ) VALUES (
        p_tenant_id,
        p_catalog_item_id,
        p_location_id,
        p_qty,
        'active',
        p_allocation_type,
        p_job_ref,
        p_external_order_ref,
        p_needed_by,
        p_expiration_date,
        v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_reservation_id;
    
    -- If no ID returned, reservation already exists
    IF v_reservation_id IS NULL THEN
        SELECT id INTO v_reservation_id
        FROM inventory.reservations
        WHERE tenant_id = p_tenant_id
        AND last_event_id = v_event_id;
        
        RETURN v_reservation_id;
    END IF;
    
    -- Update stock_balances.qty_reserved
    UPDATE inventory.stock_balances
    SET 
        qty_reserved = qty_reserved + p_qty,
        updated_at = NOW()
    WHERE tenant_id = p_tenant_id
    AND catalog_item_id = p_catalog_item_id
    AND location_id = p_location_id;
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'inventory',
        p_event_type => 'reservation.created',
        p_aggregate_type => 'reservation',
        p_aggregate_id => v_reservation_id,
        p_payload => jsonb_build_object(
            'reservation_id', v_reservation_id,
            'catalog_item_id', p_catalog_item_id,
            'location_id', p_location_id,
            'qty', p_qty,
            'allocation_type', p_allocation_type,
            'external_order_ref', p_external_order_ref
        )
    );
    
    RETURN v_reservation_id;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_reserve IS 
    'Creates inventory reservation (idempotent, checks availability)';

-- =====================================================
-- Release/Cancel Reservation
-- =====================================================
CREATE OR REPLACE FUNCTION inventory.rpc_inv_release_reservation(
    p_tenant_id UUID,
    p_reservation_id UUID,
    p_cancelled_by_user_id UUID,
    p_last_event_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_reservation RECORD;
    v_event_id TEXT;
BEGIN
    v_event_id := COALESCE(p_last_event_id, 'release_' || gen_random_uuid()::TEXT);
    
    -- Get reservation
    SELECT * INTO v_reservation
    FROM inventory.reservations
    WHERE id = p_reservation_id
    AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reservation not found';
    END IF;
    
    IF v_reservation.status != 'active' THEN
        RAISE EXCEPTION 'Reservation cannot be cancelled in status: %', v_reservation.status;
    END IF;
    
    -- Update reservation
    UPDATE inventory.reservations
    SET 
        status = 'cancelled',
        cancelled_by_user_id = p_cancelled_by_user_id,
        updated_at = NOW()
    WHERE id = p_reservation_id;
    
    -- Release from stock_balances.qty_reserved
    UPDATE inventory.stock_balances
    SET 
        qty_reserved = qty_reserved - v_reservation.qty,
        updated_at = NOW()
    WHERE tenant_id = p_tenant_id
    AND catalog_item_id = v_reservation.catalog_item_id
    AND location_id = v_reservation.location_id;
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'inventory',
        p_event_type => 'reservation.cancelled',
        p_aggregate_type => 'reservation',
        p_aggregate_id => p_reservation_id,
        p_payload => jsonb_build_object(
            'reservation_id', p_reservation_id,
            'catalog_item_id', v_reservation.catalog_item_id,
            'location_id', v_reservation.location_id,
            'qty', v_reservation.qty
        )
    );
    
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_release_reservation IS 
    'Cancels reservation and releases reserved quantity';

-- =====================================================
-- Fulfill Reservation (Issue Stock)
-- =====================================================
CREATE OR REPLACE FUNCTION inventory.rpc_inv_fulfill_reservation_issue(
    p_tenant_id UUID,
    p_reservation_id UUID,
    p_fulfilled_by_user_id UUID,
    p_last_event_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_reservation RECORD;
    v_movement_id UUID;
    v_event_id TEXT;
BEGIN
    v_event_id := COALESCE(p_last_event_id, 'fulfill_' || gen_random_uuid()::TEXT);
    
    -- Get reservation
    SELECT * INTO v_reservation
    FROM inventory.reservations
    WHERE id = p_reservation_id
    AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reservation not found';
    END IF;
    
    IF v_reservation.status != 'active' THEN
        RAISE EXCEPTION 'Reservation cannot be fulfilled in status: %', v_reservation.status;
    END IF;
    
    -- Write stock movement (issue)
    v_movement_id := inventory.insert_stock_movement(
        p_tenant_id => p_tenant_id,
        p_catalog_item_id => v_reservation.catalog_item_id,
        p_location_id => v_reservation.location_id,
        p_quantity_delta => -v_reservation.qty,
        p_movement_type => 'issued',
        p_source_ref_type => 'reservation',
        p_source_ref_id => p_reservation_id,
        p_unit_cost => NULL,
        p_reason => 'Fulfill reservation',
        p_notes => 'Reservation fulfilled for: ' || COALESCE(v_reservation.external_order_ref, 'N/A'),
        p_correlation_id => NULL,
        p_occurred_at => NOW(),
        p_created_by_user_id => p_fulfilled_by_user_id,
        p_last_event_id => v_event_id || '_movement'
    );
    
    -- Update reservation
    UPDATE inventory.reservations
    SET 
        status = 'fulfilled',
        fulfilled_by_user_id = p_fulfilled_by_user_id,
        fulfilled_at = NOW(),
        updated_at = NOW()
    WHERE id = p_reservation_id;
    
    -- Release from stock_balances.qty_reserved (movement already reduced qty_on_hand)
    UPDATE inventory.stock_balances
    SET 
        qty_reserved = qty_reserved - v_reservation.qty,
        updated_at = NOW()
    WHERE tenant_id = p_tenant_id
    AND catalog_item_id = v_reservation.catalog_item_id
    AND location_id = v_reservation.location_id;
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'inventory',
        p_event_type => 'reservation.fulfilled',
        p_aggregate_type => 'reservation',
        p_aggregate_id => p_reservation_id,
        p_payload => jsonb_build_object(
            'reservation_id', p_reservation_id,
            'catalog_item_id', v_reservation.catalog_item_id,
            'location_id', v_reservation.location_id,
            'qty', v_reservation.qty,
            'movement_id', v_movement_id
        )
    );
    
    RETURN v_movement_id;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_fulfill_reservation_issue IS 
    'Fulfills reservation by issuing stock (writes ledger entry)';

DO $$ BEGIN
    RAISE NOTICE '✅ Reservation RPCs created';
END $$;

