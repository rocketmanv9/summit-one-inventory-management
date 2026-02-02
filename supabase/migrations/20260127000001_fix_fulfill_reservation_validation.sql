-- Fix: Add validation to ensure sufficient qty_on_hand before fulfilling reservation
-- This prevents the constraint violation when trying to fulfill without physical stock

CREATE OR REPLACE FUNCTION inventory.rpc_inv_fulfill_reservation_issue(
    p_tenant_id UUID,
    p_reservation_id UUID,
    p_fulfilled_by_user_id UUID,
    p_last_event_id TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_reservation RECORD;
    v_movement_id UUID;
    v_event_id TEXT;
    v_current_qty_on_hand NUMERIC;
BEGIN
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required';
    END IF;
    v_event_id := p_last_event_id;
    
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
    
    -- Check if there's sufficient qty_on_hand to fulfill
    SELECT COALESCE(qty_on_hand, 0) INTO v_current_qty_on_hand
    FROM inventory.stock_balances
    WHERE tenant_id = p_tenant_id
    AND catalog_item_id = v_reservation.catalog_item_id
    AND location_id = v_reservation.location_id;
    
    IF v_current_qty_on_hand < v_reservation.qty THEN
        RAISE EXCEPTION 'Insufficient stock on hand to fulfill reservation. Available: %, Required: %', 
            v_current_qty_on_hand, v_reservation.qty;
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
        qty_reserved = GREATEST(0, qty_reserved - v_reservation.qty),
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
    'Fulfills reservation by issuing stock (writes ledger entry). Validates sufficient qty_on_hand before fulfilling.';
