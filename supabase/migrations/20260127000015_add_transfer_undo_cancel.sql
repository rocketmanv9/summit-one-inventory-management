-- Add undo cancel function for transfers

CREATE OR REPLACE FUNCTION inventory.rpc_inv_transfer_undo_cancel(
    p_tenant_id UUID,
    p_transfer_id UUID,
    p_user_id UUID,
    p_last_event_id TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_transfer RECORD;
    v_event_id TEXT;
BEGIN
    v_event_id := COALESCE(p_last_event_id, 'undo_cancel_' || gen_random_uuid()::TEXT);
    
    -- Get transfer
    SELECT * INTO v_transfer
    FROM inventory.transfers
    WHERE id = p_transfer_id
    AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer not found';
    END IF;
    
    IF v_transfer.status != 'cancelled' THEN
        RAISE EXCEPTION 'Can only undo cancelled transfers. Current status: %', v_transfer.status;
    END IF;
    
    -- Restore to draft status
    UPDATE inventory.transfers
    SET 
        status = 'draft',
        updated_at = NOW()
    WHERE id = p_transfer_id
    AND tenant_id = p_tenant_id;
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'transfer.cancel_undone',
        p_aggregate_type => 'transfer',
        p_aggregate_id => p_transfer_id,
        p_payload => jsonb_build_object(
            'transfer_id', p_transfer_id,
            'from_location_id', v_transfer.from_location_id,
            'to_location_id', v_transfer.to_location_id
        )
    );
    
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_transfer_undo_cancel IS 'Reverses a cancelled transfer back to draft status';
