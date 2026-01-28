-- Update the full receive RPC to also set qty_shipped on lines when receiving

CREATE OR REPLACE FUNCTION "inventory"."rpc_inv_transfer_execute"(
    "p_tenant_id" "uuid", 
    "p_transfer_id" "uuid", 
    "p_received_by_user_id" "uuid", 
    "p_last_event_id" "text" DEFAULT NULL::"text"
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_transfer RECORD;
    v_line RECORD;
    v_correlation_id UUID;
    v_event_id TEXT;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    -- Generate event ID
    v_event_id := COALESCE(p_last_event_id, 'transfer_execute_' || gen_random_uuid()::TEXT);
    
    -- Get transfer
    SELECT * INTO v_transfer
    FROM inventory.transfers
    WHERE id = p_transfer_id
    AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer not found';
    END IF;
    
    IF v_transfer.status NOT IN ('draft', 'in_transit') THEN
        RAISE EXCEPTION 'Transfer cannot be executed in status: %', v_transfer.status;
    END IF;
    
    -- Generate correlation ID for paired entries
    v_correlation_id := gen_random_uuid();
    
    -- Process each line
    FOR v_line IN 
        SELECT * FROM inventory.transfer_lines
        WHERE transfer_id = p_transfer_id
        ORDER BY line_number
    LOOP
        -- Debit from source location (transferred_out)
        PERFORM inventory.insert_stock_movement(
            p_tenant_id => p_tenant_id,
            p_catalog_item_id => v_line.catalog_item_id,
            p_location_id => v_transfer.from_location_id,
            p_quantity_delta => -v_line.qty,
            p_movement_type => 'transferred_out',
            p_source_ref_type => 'transfer',
            p_source_ref_id => p_transfer_id,
            p_unit_cost => NULL,
            p_reason => 'Transfer to ' || (SELECT name FROM inventory.locations WHERE id = v_transfer.to_location_id),
            p_notes => 'Transfer #' || v_transfer.transfer_number,
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
            p_quantity_delta => v_line.qty,
            p_movement_type => 'transferred_in',
            p_source_ref_type => 'transfer',
            p_source_ref_id => p_transfer_id,
            p_unit_cost => NULL,
            p_reason => 'Transfer from ' || (SELECT name FROM inventory.locations WHERE id = v_transfer.from_location_id),
            p_notes => 'Transfer #' || v_transfer.transfer_number,
            p_correlation_id => v_correlation_id,
            p_occurred_at => v_now,
            p_created_by_user_id => p_received_by_user_id,
            p_last_event_id => v_event_id || '_in_' || v_line.line_number
        );
        
        -- Update line to mark as fully shipped and received
        UPDATE inventory.transfer_lines
        SET 
            qty_shipped = qty,
            qty_received = qty
        WHERE id = v_line.id;
    END LOOP;
    
    -- Update transfer status
    UPDATE inventory.transfers
    SET 
        status = 'completed',
        received_by_user_id = p_received_by_user_id,
        completed_at = v_now,
        updated_at = v_now
    WHERE id = p_transfer_id;
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'transfer.completed',
        p_aggregate_type => 'transfer',
        p_aggregate_id => p_transfer_id,
        p_payload => jsonb_build_object(
            'transfer_id', p_transfer_id,
            'transfer_number', v_transfer.transfer_number,
            'from_location_id', v_transfer.from_location_id,
            'to_location_id', v_transfer.to_location_id,
            'correlation_id', v_correlation_id
        )
    );
    
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION "inventory"."rpc_inv_transfer_execute" IS 'Executes full transfer by writing paired ledger entries and marking lines as shipped/received (idempotent)';
