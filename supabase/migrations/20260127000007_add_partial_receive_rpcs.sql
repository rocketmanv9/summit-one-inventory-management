-- Create RPC for partial receive of transfers
-- Allows receiving specific quantities for each line item

CREATE OR REPLACE FUNCTION "inventory"."rpc_inv_transfer_receive_partial"(
    "p_tenant_id" "uuid",
    "p_transfer_id" "uuid",
    "p_received_by_user_id" "uuid",
    "p_line_quantities" "jsonb", -- Array of {line_number: X, qty_received: Y}
    "p_last_event_id" "text" DEFAULT NULL::"text"
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_transfer RECORD;
    v_line RECORD;
    v_receive_qty NUMERIC;
    v_correlation_id UUID;
    v_event_id TEXT;
    v_now TIMESTAMPTZ := NOW();
    v_all_lines_complete BOOLEAN := TRUE;
BEGIN
    -- Generate event ID
    v_event_id := COALESCE(p_last_event_id, 'transfer_receive_' || gen_random_uuid()::TEXT);
    
    -- Get transfer
    SELECT * INTO v_transfer
    FROM inventory.transfers
    WHERE id = p_transfer_id
    AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer not found';
    END IF;
    
    IF v_transfer.status NOT IN ('in_transit', 'partially_received') THEN
        RAISE EXCEPTION 'Transfer cannot be received in status: %. Must be in_transit or partially_received.', v_transfer.status;
    END IF;
    
    -- Generate correlation ID for paired entries
    v_correlation_id := gen_random_uuid();
    
    -- Process each line with received quantity
    FOR v_line IN 
        SELECT tl.*, (lq.value->>'qty_received')::NUMERIC as qty_to_receive
        FROM inventory.transfer_lines tl
        JOIN jsonb_array_elements(p_line_quantities) lq ON (lq.value->>'line_number')::INTEGER = tl.line_number
        WHERE tl.transfer_id = p_transfer_id
        ORDER BY tl.line_number
    LOOP
        -- Validate received quantity
        IF v_line.qty_to_receive <= 0 THEN
            RAISE EXCEPTION 'Received quantity must be greater than 0 for line %', v_line.line_number;
        END IF;
        
        IF v_line.qty_received + v_line.qty_to_receive > v_line.qty_shipped THEN
            RAISE EXCEPTION 'Cannot receive more than shipped quantity for line %. Shipped: %, Already received: %, Trying to receive: %', 
                v_line.line_number, v_line.qty_shipped, v_line.qty_received, v_line.qty_to_receive;
        END IF;
        
        -- Debit from source location (transferred_out)
        PERFORM inventory.insert_stock_movement(
            p_tenant_id => p_tenant_id,
            p_catalog_item_id => v_line.catalog_item_id,
            p_location_id => v_transfer.from_location_id,
            p_quantity_delta => -v_line.qty_to_receive,
            p_movement_type => 'transferred_out',
            p_source_ref_type => 'transfer',
            p_source_ref_id => p_transfer_id,
            p_unit_cost => NULL,
            p_reason => 'Transfer to ' || (SELECT name FROM inventory.locations WHERE id = v_transfer.to_location_id),
            p_notes => 'Transfer #' || v_transfer.transfer_number || ' - Partial receive',
            p_correlation_id => v_correlation_id,
            p_occurred_at => v_now,
            p_created_by_user_id => p_received_by_user_id,
            p_last_event_id => v_event_id || '_out_' || v_line.line_number
        );
        
        -- Credit to destination location (transferred_in)
        PERFORM inventory.insert_stock_movement(
            p_tenant_id => p_tenant_id,
            p_catalog_item_id => v_line.catalog_item_id,
            p_location_id => v_transfer.to_location_id,
            p_quantity_delta => v_line.qty_to_receive,
            p_movement_type => 'transferred_in',
            p_source_ref_type => 'transfer',
            p_source_ref_id => p_transfer_id,
            p_unit_cost => NULL,
            p_reason => 'Transfer from ' || (SELECT name FROM inventory.locations WHERE id = v_transfer.from_location_id),
            p_notes => 'Transfer #' || v_transfer.transfer_number || ' - Partial receive',
            p_correlation_id => v_correlation_id,
            p_occurred_at => v_now,
            p_created_by_user_id => p_received_by_user_id,
            p_last_event_id => v_event_id || '_in_' || v_line.line_number
        );
        
        -- Update line quantities
        UPDATE inventory.transfer_lines
        SET qty_received = qty_received + v_line.qty_to_receive
        WHERE id = v_line.id;
    END LOOP;
    
    -- Check if all lines are fully received
    SELECT BOOL_AND(qty_received >= qty_shipped) INTO v_all_lines_complete
    FROM inventory.transfer_lines
    WHERE transfer_id = p_transfer_id;
    
    -- Update transfer status
    UPDATE inventory.transfers
    SET 
        status = CASE 
            WHEN v_all_lines_complete THEN 'completed'
            ELSE 'partially_received'
        END,
        received_by_user_id = p_received_by_user_id,
        completed_at = CASE WHEN v_all_lines_complete THEN v_now ELSE NULL END,
        updated_at = v_now
    WHERE id = p_transfer_id;
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => CASE 
            WHEN v_all_lines_complete THEN 'transfer.completed'
            ELSE 'transfer.partially_received'
        END,
        p_aggregate_type => 'transfer',
        p_aggregate_id => p_transfer_id,
        p_payload => jsonb_build_object(
            'transfer_id', p_transfer_id,
            'transfer_number', v_transfer.transfer_number,
            'from_location_id', v_transfer.from_location_id,
            'to_location_id', v_transfer.to_location_id,
            'correlation_id', v_correlation_id,
            'is_complete', v_all_lines_complete
        )
    );
    
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION "inventory"."rpc_inv_transfer_receive_partial" IS 'Receives specific quantities for transfer lines, supports partial receives and multiple receive operations';


-- Create RPC to create a reverse transfer
CREATE OR REPLACE FUNCTION "inventory"."rpc_inv_transfer_create_reversal"(
    "p_tenant_id" "uuid",
    "p_original_transfer_id" "uuid",
    "p_initiated_by_user_id" "uuid",
    "p_notes" "text" DEFAULT NULL::"text",
    "p_last_event_id" "text" DEFAULT NULL::"text"
) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_original_transfer RECORD;
    v_reversal_id UUID;
    v_transfer_number TEXT;
    v_line RECORD;
    v_line_number INTEGER := 1;
    v_event_id TEXT;
BEGIN
    -- Validate tenant
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id is required';
    END IF;
    
    -- Get original transfer
    SELECT * INTO v_original_transfer
    FROM inventory.transfers
    WHERE id = p_original_transfer_id
    AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Original transfer not found';
    END IF;
    
    -- Can only reverse completed transfers
    IF v_original_transfer.status != 'completed' THEN
        RAISE EXCEPTION 'Can only reverse completed transfers. Current status: %', v_original_transfer.status;
    END IF;
    
    -- Check if already reversed
    IF EXISTS (
        SELECT 1 FROM inventory.transfers 
        WHERE reversal_of_transfer_id = p_original_transfer_id
        AND status != 'cancelled'
    ) THEN
        RAISE EXCEPTION 'Transfer has already been reversed';
    END IF;
    
    -- Generate event ID
    v_event_id := COALESCE(p_last_event_id, 'transfer_reversal_' || gen_random_uuid()::TEXT);
    
    -- Generate transfer number
    v_transfer_number := 'REV-' || v_original_transfer.transfer_number;
    
    -- Create reversal transfer (opposite direction)
    INSERT INTO inventory.transfers (
        tenant_id,
        transfer_number,
        from_location_id,
        to_location_id,
        status,
        initiated_by_user_id,
        notes,
        last_event_id,
        reversal_of_transfer_id,
        is_reversal
    ) VALUES (
        p_tenant_id,
        v_transfer_number,
        v_original_transfer.to_location_id, -- Reverse: from becomes to
        v_original_transfer.from_location_id, -- Reverse: to becomes from
        'draft',
        p_initiated_by_user_id,
        COALESCE(p_notes, 'Reversal of transfer #' || v_original_transfer.transfer_number),
        v_event_id,
        p_original_transfer_id,
        true
    )
    RETURNING id INTO v_reversal_id;
    
    -- Copy lines from original transfer
    FOR v_line IN 
        SELECT * FROM inventory.transfer_lines
        WHERE transfer_id = p_original_transfer_id
        ORDER BY line_number
    LOOP
        INSERT INTO inventory.transfer_lines (
            tenant_id,
            transfer_id,
            line_number,
            catalog_item_id,
            qty,
            qty_shipped,
            last_event_id
        ) VALUES (
            p_tenant_id,
            v_reversal_id,
            v_line_number,
            v_line.catalog_item_id,
            v_line.qty_received, -- Reverse the received quantity
            v_line.qty_received, -- Pre-set as shipped since we know this qty exists
            v_event_id || '_line_' || v_line_number
        );
        
        v_line_number := v_line_number + 1;
    END LOOP;
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'transfer.reversal_created',
        p_aggregate_type => 'transfer',
        p_aggregate_id => v_reversal_id,
        p_payload => jsonb_build_object(
            'reversal_id', v_reversal_id,
            'reversal_number', v_transfer_number,
            'original_transfer_id', p_original_transfer_id,
            'original_transfer_number', v_original_transfer.transfer_number
        )
    );
    
    RETURN v_reversal_id;
END;
$$;

COMMENT ON FUNCTION "inventory"."rpc_inv_transfer_create_reversal" IS 'Creates a reversal transfer for a completed transfer, copying lines and reversing direction';
