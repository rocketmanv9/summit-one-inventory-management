-- Add support for transfer corrections (undo ship, reverse receipt)
-- These are accounting corrections, NOT physical movements

-- Add columns to track corrections
ALTER TABLE inventory.transfers
ADD COLUMN IF NOT EXISTS ship_undone_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS ship_undone_by_user_id UUID,
ADD COLUMN IF NOT EXISTS ship_undone_reason TEXT,
ADD COLUMN IF NOT EXISTS receipt_reversed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS receipt_reversed_by_user_id UUID,
ADD COLUMN IF NOT EXISTS receipt_reversed_reason TEXT;

COMMENT ON COLUMN inventory.transfers.ship_undone_at IS 'When shipment was undone (correction, not physical return)';
COMMENT ON COLUMN inventory.transfers.receipt_reversed_at IS 'When receipt was reversed (correction, not physical return)';

-- RPC: Undo Shipment (correction for mistaken ship click)
-- Reverts in_transit → draft, preserves history
CREATE OR REPLACE FUNCTION inventory.rpc_inv_transfer_undo_shipment(
    p_tenant_id UUID,
    p_transfer_id UUID,
    p_undone_by_user_id UUID,
    p_reason TEXT,
    p_notes TEXT DEFAULT NULL,
    p_last_event_id TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_transfer RECORD;
    v_event_id TEXT;
BEGIN
    -- Require event ID for strict idempotency
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required';
    END IF;
    v_event_id := p_last_event_id;
    
    -- Get transfer
    SELECT * INTO v_transfer
    FROM inventory.transfers
    WHERE id = p_transfer_id
    AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer not found';
    END IF;
    
    -- Can only undo shipment if in_transit
    IF v_transfer.status != 'in_transit' THEN
        RAISE EXCEPTION 'Can only undo shipment for in_transit transfers. Current status: %', v_transfer.status;
    END IF;
    
    -- Check if already undone
    IF v_transfer.ship_undone_at IS NOT NULL THEN
        RAISE EXCEPTION 'Shipment has already been undone';
    END IF;
    
    -- Require reason
    IF p_reason IS NULL OR p_reason = '' THEN
        RAISE EXCEPTION 'Reason is required for undoing shipment';
    END IF;
    
    -- Revert status to draft
    UPDATE inventory.transfers
    SET 
        status = 'draft',
        ship_undone_at = NOW(),
        ship_undone_by_user_id = p_undone_by_user_id,
        ship_undone_reason = p_reason,
        notes = CASE 
            WHEN p_notes IS NOT NULL THEN COALESCE(notes || E'\n\n', '') || 'SHIPMENT UNDONE: ' || p_notes
            ELSE notes
        END,
        updated_at = NOW()
    WHERE id = p_transfer_id;
    
    -- Publish correction event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'transfer.shipment_undone',
        p_aggregate_type => 'transfer',
        p_aggregate_id => p_transfer_id,
        p_payload => jsonb_build_object(
            'transfer_id', p_transfer_id,
            'transfer_number', v_transfer.transfer_number,
            'reason', p_reason,
            'undone_by', p_undone_by_user_id
        )
    );
    
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_transfer_undo_shipment IS 'Undoes a shipment (correction only - no physical movement). Reverts in_transit → draft.';

-- RPC: Reverse Receipt (correction for mistaken receive)
-- Reverts completed/partially_received → in_transit, negates stock movements
CREATE OR REPLACE FUNCTION inventory.rpc_inv_transfer_reverse_receipt(
    p_tenant_id UUID,
    p_transfer_id UUID,
    p_reversed_by_user_id UUID,
    p_reason TEXT,
    p_notes TEXT DEFAULT NULL,
    p_last_event_id TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_transfer RECORD;
    v_line RECORD;
    v_event_id TEXT;
    v_correlation_id UUID;
BEGIN
    -- Require event ID for strict idempotency
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required';
    END IF;
    v_event_id := p_last_event_id;
    v_correlation_id := gen_random_uuid();
    
    -- Get transfer
    SELECT * INTO v_transfer
    FROM inventory.transfers
    WHERE id = p_transfer_id
    AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer not found';
    END IF;
    
    -- Can only reverse receipt if completed or partially_received
    IF v_transfer.status NOT IN ('completed', 'partially_received') THEN
        RAISE EXCEPTION 'Can only reverse receipt for completed/partially_received transfers. Current status: %', v_transfer.status;
    END IF;
    
    -- Check if already reversed
    IF v_transfer.receipt_reversed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Receipt has already been reversed';
    END IF;
    
    -- Require reason
    IF p_reason IS NULL OR p_reason = '' THEN
        RAISE EXCEPTION 'Reason is required for reversing receipt';
    END IF;
    
    -- Create corrective stock movements (negate the original receive)
    FOR v_line IN 
        SELECT * FROM inventory.transfer_lines
        WHERE transfer_id = p_transfer_id
        AND qty_received > 0
    LOOP
        -- Debit from destination (negate the credit from receive)
        PERFORM inventory.insert_stock_movement(
            p_tenant_id => p_tenant_id,
            p_catalog_item_id => v_line.catalog_item_id,
            p_location_id => v_transfer.to_location_id,
            p_quantity_delta => -v_line.qty_received,
            p_movement_type => 'correction',
            p_source_ref_type => 'transfer',
            p_source_ref_id => p_transfer_id,
            p_unit_cost => NULL,
            p_reason => 'Receipt reversal: ' || p_reason,
            p_notes => 'Corrective entry - negating transfer #' || v_transfer.transfer_number,
            p_correlation_id => v_correlation_id,
            p_occurred_at => NOW(),
            p_created_by_user_id => p_reversed_by_user_id,
            p_last_event_id => v_event_id || '_to_' || v_line.line_number
        );
        
        -- Credit back to source (negate the debit from receive)
        PERFORM inventory.insert_stock_movement(
            p_tenant_id => p_tenant_id,
            p_catalog_item_id => v_line.catalog_item_id,
            p_location_id => v_transfer.from_location_id,
            p_quantity_delta => v_line.qty_received,
            p_movement_type => 'correction',
            p_source_ref_type => 'transfer',
            p_source_ref_id => p_transfer_id,
            p_unit_cost => NULL,
            p_reason => 'Receipt reversal: ' || p_reason,
            p_notes => 'Corrective entry - negating transfer #' || v_transfer.transfer_number,
            p_correlation_id => v_correlation_id,
            p_occurred_at => NOW(),
            p_created_by_user_id => p_reversed_by_user_id,
            p_last_event_id => v_event_id || '_from_' || v_line.line_number
        );
    END LOOP;
    
    -- Reset qty_received to 0 on all lines
    UPDATE inventory.transfer_lines
    SET qty_received = 0
    WHERE transfer_id = p_transfer_id;
    
    -- Revert status to in_transit
    UPDATE inventory.transfers
    SET 
        status = 'in_transit',
        completed_at = NULL,
        receipt_reversed_at = NOW(),
        receipt_reversed_by_user_id = p_reversed_by_user_id,
        receipt_reversed_reason = p_reason,
        notes = CASE 
            WHEN p_notes IS NOT NULL THEN COALESCE(notes || E'\n\n', '') || 'RECEIPT REVERSED: ' || p_notes
            ELSE notes
        END,
        updated_at = NOW()
    WHERE id = p_transfer_id;
    
    -- Publish correction event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'transfer.receipt_reversed',
        p_aggregate_type => 'transfer',
        p_aggregate_id => p_transfer_id,
        p_payload => jsonb_build_object(
            'transfer_id', p_transfer_id,
            'transfer_number', v_transfer.transfer_number,
            'reason', p_reason,
            'reversed_by', p_reversed_by_user_id,
            'correlation_id', v_correlation_id
        )
    );
    
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_transfer_reverse_receipt IS 'Reverses a receipt (correction only - no physical movement). Creates corrective stock movements and reverts to in_transit.';
