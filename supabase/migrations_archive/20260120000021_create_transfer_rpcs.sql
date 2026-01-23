-- ============================================================================
-- PHASE 3: TRANSFER RPCs
-- ============================================================================
-- Business logic for creating and executing transfers

-- =====================================================
-- Create Transfer (Draft)
-- =====================================================
CREATE OR REPLACE FUNCTION inventory.rpc_inv_transfer_create(
    p_tenant_id UUID,
    p_from_location_id UUID,
    p_to_location_id UUID,
    p_lines JSONB, -- [{"catalog_item_id": "uuid", "qty": 10}, ...]
    p_initiated_by_user_id UUID,
    p_notes TEXT DEFAULT NULL,
    p_last_event_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_transfer_id UUID;
    v_transfer_number TEXT;
    v_line JSONB;
    v_line_number INTEGER := 1;
    v_event_id TEXT;
BEGIN
    -- Validate tenant
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id is required';
    END IF;
    
    -- Validate locations
    IF p_from_location_id = p_to_location_id THEN
        RAISE EXCEPTION 'from_location_id and to_location_id must be different';
    END IF;
    
    -- Generate event ID if not provided
    v_event_id := COALESCE(p_last_event_id, 'transfer_create_' || gen_random_uuid()::TEXT);
    
    -- Generate transfer number
    SELECT 'TRF-' || to_char(NOW(), 'YYYYMMDD') || '-' || LPAD((
        SELECT COUNT(*) + 1 
        FROM inventory.transfers 
        WHERE tenant_id = p_tenant_id
        AND created_at::DATE = CURRENT_DATE
    )::TEXT, 4, '0')
    INTO v_transfer_number;
    
    -- Insert transfer header (idempotent)
    INSERT INTO inventory.transfers (
        tenant_id,
        transfer_number,
        from_location_id,
        to_location_id,
        status,
        initiated_by_user_id,
        notes,
        last_event_id
    ) VALUES (
        p_tenant_id,
        v_transfer_number,
        p_from_location_id,
        p_to_location_id,
        'draft',
        p_initiated_by_user_id,
        p_notes,
        v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_transfer_id;
    
    -- If no ID returned, transfer already exists (idempotency)
    IF v_transfer_id IS NULL THEN
        SELECT id INTO v_transfer_id
        FROM inventory.transfers
        WHERE tenant_id = p_tenant_id
        AND last_event_id = v_event_id;
        
        RETURN v_transfer_id;
    END IF;
    
    -- Insert lines
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        INSERT INTO inventory.transfer_lines (
            tenant_id,
            transfer_id,
            line_number,
            catalog_item_id,
            qty,
            last_event_id
        ) VALUES (
            p_tenant_id,
            v_transfer_id,
            v_line_number,
            (v_line->>'catalog_item_id')::UUID,
            (v_line->>'qty')::NUMERIC,
            v_event_id || '_line_' || v_line_number
        );
        
        v_line_number := v_line_number + 1;
    END LOOP;
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'inventory',
        p_event_type => 'transfer.created',
        p_aggregate_type => 'transfer',
        p_aggregate_id => v_transfer_id,
        p_payload => jsonb_build_object(
            'transfer_id', v_transfer_id,
            'transfer_number', v_transfer_number,
            'from_location_id', p_from_location_id,
            'to_location_id', p_to_location_id,
            'line_count', jsonb_array_length(p_lines)
        )
    );
    
    RETURN v_transfer_id;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_transfer_create IS 
    'Creates transfer in draft status (idempotent)';

-- =====================================================
-- Execute Transfer (Write Ledger Entries)
-- =====================================================
CREATE OR REPLACE FUNCTION inventory.rpc_inv_transfer_execute(
    p_tenant_id UUID,
    p_transfer_id UUID,
    p_received_by_user_id UUID,
    p_last_event_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
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
        p_scope => 'inventory',
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

COMMENT ON FUNCTION inventory.rpc_inv_transfer_execute IS 
    'Executes transfer by writing paired ledger entries (idempotent)';

-- =====================================================
-- Cancel Transfer
-- =====================================================
CREATE OR REPLACE FUNCTION inventory.rpc_inv_transfer_cancel(
    p_tenant_id UUID,
    p_transfer_id UUID,
    p_cancellation_reason TEXT,
    p_cancelled_by_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_transfer RECORD;
BEGIN
    SELECT * INTO v_transfer
    FROM inventory.transfers
    WHERE id = p_transfer_id
    AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer not found';
    END IF;
    
    IF v_transfer.status NOT IN ('draft', 'in_transit') THEN
        RAISE EXCEPTION 'Transfer cannot be cancelled in status: %', v_transfer.status;
    END IF;
    
    UPDATE inventory.transfers
    SET 
        status = 'cancelled',
        cancellation_reason = p_cancellation_reason,
        cancelled_at = NOW(),
        updated_at = NOW()
    WHERE id = p_transfer_id;
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'inventory',
        p_event_type => 'transfer.cancelled',
        p_aggregate_type => 'transfer',
        p_aggregate_id => p_transfer_id,
        p_payload => jsonb_build_object(
            'transfer_id', p_transfer_id,
            'transfer_number', v_transfer.transfer_number,
            'reason', p_cancellation_reason
        )
    );
    
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_transfer_cancel IS 
    'Cancels a draft or in-transit transfer';

DO $$ BEGIN
    RAISE NOTICE '✅ Transfer RPCs created';
END $$;

