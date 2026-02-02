-- Fix reversal RPC to handle transfers completed before qty_received tracking
-- Falls back to qty when qty_received is NULL or 0
-- Also backfills qty_shipped and qty_received for completed transfers

-- First, backfill qty_shipped and qty_received for completed transfers that don't have them
UPDATE inventory.transfer_lines
SET 
    qty_shipped = qty,
    qty_received = qty
WHERE 
    qty_shipped IS NULL OR qty_shipped = 0
    AND transfer_id IN (
        SELECT id FROM inventory.transfers 
        WHERE status IN ('completed', 'partially_received')
    );

-- Now update the reversal RPC
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
    v_reversal_qty NUMERIC;
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
    
    -- Require event ID for strict idempotency
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required';
    END IF;
    v_event_id := p_last_event_id;
    
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
        -- Use qty_received if available (and > 0), then qty_shipped if available (and > 0), otherwise fall back to qty
        -- This handles transfers completed before qty tracking was added
        v_reversal_qty := COALESCE(
            NULLIF(v_line.qty_received, 0), 
            NULLIF(v_line.qty_shipped, 0), 
            v_line.qty
        );
        
        IF v_reversal_qty <= 0 THEN
            RAISE EXCEPTION 'Cannot create reversal: line % has invalid quantity', v_line.line_number;
        END IF;
        
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
            v_reversal_qty, -- Reverse the received quantity (or original qty if not tracked)
            v_reversal_qty, -- Pre-set as shipped since we know this qty exists
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

COMMENT ON FUNCTION "inventory"."rpc_inv_transfer_create_reversal" IS 'Creates a reversal transfer for a completed transfer, copying lines and reversing direction. Handles transfers completed before qty_received tracking.';
