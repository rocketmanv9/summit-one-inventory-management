-- Add undo functions for reservation fulfill and release operations

-- 1. Undo Fulfill: Reverse a fulfilled reservation back to active
CREATE OR REPLACE FUNCTION inventory.rpc_inv_undo_fulfill_reservation(
    p_tenant_id UUID,
    p_reservation_id UUID,
    p_user_id UUID,
    p_last_event_id TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_reservation RECORD;
    v_movement_id UUID;
    v_event_id TEXT;
BEGIN
    v_event_id := COALESCE(p_last_event_id, 'undo_fulfill_' || gen_random_uuid()::TEXT);
    
    -- Get reservation
    SELECT * INTO v_reservation
    FROM inventory.reservations
    WHERE id = p_reservation_id
    AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reservation not found';
    END IF;
    
    IF v_reservation.status != 'fulfilled' THEN
        RAISE EXCEPTION 'Can only undo fulfilled reservations. Current status: %', v_reservation.status;
    END IF;
    
    -- Handle based on reservation type
    IF v_reservation.reservation_type = 'fungible' THEN
        -- Fungible: reverse the stock movement and restore reservation
        
        -- Add stock back (reverse the issue)
        v_movement_id := inventory.insert_stock_movement(
            p_tenant_id => p_tenant_id,
            p_catalog_item_id => v_reservation.catalog_item_id,
            p_location_id => v_reservation.location_id,
            p_quantity_delta => v_reservation.qty,
            p_movement_type => 'adjustment',
            p_source_ref_type => 'reservation',
            p_source_ref_id => p_reservation_id,
            p_unit_cost => NULL,
            p_reason => 'Undo fulfillment',
            p_notes => 'Reversed fulfillment - restoring stock and reservation',
            p_correlation_id => NULL,
            p_occurred_at => NOW(),
            p_created_by_user_id => p_user_id,
            p_last_event_id => v_event_id || '_movement'
        );
        
        -- Restore qty_reserved
        UPDATE inventory.stock_balances
        SET 
            qty_reserved = qty_reserved + v_reservation.qty,
            updated_at = NOW()
        WHERE tenant_id = p_tenant_id
        AND catalog_item_id = v_reservation.catalog_item_id
        AND location_id = v_reservation.location_id;
        
    ELSIF v_reservation.reservation_type = 'serialized' THEN
        -- Serialized: asset is still 'assigned', no status change needed
        -- (Asset remains assigned to the reservation)
        NULL;
    ELSE
        RAISE EXCEPTION 'Unknown reservation_type: %', v_reservation.reservation_type;
    END IF;
    
    -- Update reservation back to active
    UPDATE inventory.reservations
    SET 
        status = 'active',
        fulfilled_by_user_id = NULL,
        fulfilled_at = NULL,
        updated_at = NOW()
    WHERE id = p_reservation_id;
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'reservation.fulfill_undone',
        p_aggregate_type => 'reservation',
        p_aggregate_id => p_reservation_id,
        p_payload => jsonb_build_object(
            'reservation_id', p_reservation_id,
            'reservation_type', v_reservation.reservation_type,
            'catalog_item_id', v_reservation.catalog_item_id,
            'asset_id', v_reservation.asset_id,
            'qty', v_reservation.qty
        )
    );
    
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_undo_fulfill_reservation IS
'Reverses a fulfilled reservation back to active status. For fungible: adds stock back and restores qty_reserved. For serialized: keeps asset assigned.';


-- 2. Undo Release: Reverse a released reservation back to active
CREATE OR REPLACE FUNCTION inventory.rpc_inv_undo_release_reservation(
    p_tenant_id UUID,
    p_reservation_id UUID,
    p_user_id UUID,
    p_last_event_id TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_reservation RECORD;
    v_event_id TEXT;
    v_current_qty_available NUMERIC;
BEGIN
    v_event_id := COALESCE(p_last_event_id, 'undo_release_' || gen_random_uuid()::TEXT);
    
    -- Get reservation
    SELECT * INTO v_reservation
    FROM inventory.reservations
    WHERE id = p_reservation_id
    AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reservation not found';
    END IF;
    
    IF v_reservation.status != 'released' THEN
        RAISE EXCEPTION 'Can only undo released reservations. Current status: %', v_reservation.status;
    END IF;
    
    -- Handle based on reservation type
    IF v_reservation.reservation_type = 'fungible' THEN
        -- Fungible: check if sufficient stock is available to re-reserve
        SELECT COALESCE(qty_available, 0) INTO v_current_qty_available
        FROM inventory.stock_balances
        WHERE tenant_id = p_tenant_id
        AND catalog_item_id = v_reservation.catalog_item_id
        AND location_id = v_reservation.location_id;
        
        IF v_current_qty_available < v_reservation.qty THEN
            RAISE EXCEPTION 'Insufficient stock available to restore reservation. Available: %, Required: %', 
                v_current_qty_available, v_reservation.qty;
        END IF;
        
        -- Restore qty_reserved
        UPDATE inventory.stock_balances
        SET 
            qty_reserved = qty_reserved + v_reservation.qty,
            updated_at = NOW()
        WHERE tenant_id = p_tenant_id
        AND catalog_item_id = v_reservation.catalog_item_id
        AND location_id = v_reservation.location_id;
        
    ELSIF v_reservation.reservation_type = 'serialized' THEN
        -- Serialized: verify asset is available before re-assigning
        DECLARE
            v_asset_status TEXT;
        BEGIN
            SELECT status INTO v_asset_status
            FROM inventory.assets
            WHERE id = v_reservation.asset_id
            AND tenant_id = p_tenant_id;
            
            IF v_asset_status IS NULL THEN
                RAISE EXCEPTION 'Asset not found';
            END IF;
            
            IF v_asset_status != 'available' THEN
                RAISE EXCEPTION 'Asset is not available. Current status: %', v_asset_status;
            END IF;
            
            -- Re-assign asset
            UPDATE inventory.assets
            SET 
                status = 'assigned',
                updated_at = NOW()
            WHERE id = v_reservation.asset_id
            AND tenant_id = p_tenant_id;
        END;
    ELSE
        RAISE EXCEPTION 'Unknown reservation_type: %', v_reservation.reservation_type;
    END IF;
    
    -- Update reservation back to active
    UPDATE inventory.reservations
    SET 
        status = 'active',
        updated_at = NOW()
    WHERE id = p_reservation_id;
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'reservation.release_undone',
        p_aggregate_type => 'reservation',
        p_aggregate_id => p_reservation_id,
        p_payload => jsonb_build_object(
            'reservation_id', p_reservation_id,
            'reservation_type', v_reservation.reservation_type,
            'catalog_item_id', v_reservation.catalog_item_id,
            'asset_id', v_reservation.asset_id,
            'qty', v_reservation.qty
        )
    );
    
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_undo_release_reservation IS
'Reverses a released reservation back to active status. For fungible: restores qty_reserved. For serialized: re-assigns asset.';
