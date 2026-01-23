-- Migration: Add stock movement reversal capability
-- Non-negotiable: Multitenancy, RLS, Idempotency

-- =====================================================
-- 1. ADD REVERSAL COLUMNS (if not exist)
-- =====================================================

-- posting_status already exists, verified in schema check
-- Add reversal_ref_id to link reversals to originals

ALTER TABLE inventory.stock_movements
ADD COLUMN IF NOT EXISTS reversal_ref_id UUID REFERENCES inventory.stock_movements(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_stock_movements_reversal_ref 
ON inventory.stock_movements(reversal_ref_id) 
WHERE reversal_ref_id IS NOT NULL;

COMMENT ON COLUMN inventory.stock_movements.reversal_ref_id IS 
'For reversed movements, references the original movement being reversed';

-- =====================================================
-- 2. REVERSAL RPC
-- =====================================================

CREATE OR REPLACE FUNCTION inventory.rpc_reverse_stock_movement(
    p_tenant_id UUID,
    p_movement_id UUID,
    p_reason TEXT,
    p_user_id UUID DEFAULT NULL,
    p_last_event_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, public
AS $$
DECLARE
    v_movement RECORD;
    v_reversal_id UUID;
    v_event_id TEXT;
BEGIN
    v_event_id := COALESCE(p_last_event_id, 'reversal_' || gen_random_uuid()::TEXT);
    
    -- Get original movement
    SELECT * INTO v_movement
    FROM inventory.stock_movements
    WHERE id = p_movement_id
      AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock movement not found';
    END IF;
    
    -- Validate can be reversed
    IF v_movement.posting_status = 'reversed' THEN
        RAISE EXCEPTION 'Movement already reversed';
    END IF;
    
    IF v_movement.posting_status = 'pending' THEN
        RAISE EXCEPTION 'Cannot reverse pending movement, delete it instead';
    END IF;
    
    -- Check if already has reversal
    IF EXISTS (
        SELECT 1 FROM inventory.stock_movements 
        WHERE reversal_ref_id = p_movement_id 
        AND posting_status = 'posted'
    ) THEN
        RAISE EXCEPTION 'Movement already has an active reversal';
    END IF;
    
    -- Create offsetting movement
    v_reversal_id := inventory.insert_stock_movement(
        p_tenant_id => p_tenant_id,
        p_catalog_item_id => v_movement.catalog_item_id,
        p_location_id => v_movement.location_id,
        p_quantity_delta => -v_movement.quantity_delta,  -- Negate original delta
        p_movement_type => 'adjusted',
        p_source_ref_type => 'reversal',
        p_source_ref_id => p_movement_id,
        p_unit_cost => v_movement.unit_cost,
        p_reason => 'REVERSAL: ' || COALESCE(p_reason, 'Correcting erroneous movement'),
        p_notes => 'Reverses movement ' || p_movement_id::TEXT || '. Original: ' || COALESCE(v_movement.notes, 'N/A'),
        p_correlation_id => v_movement.correlation_id,
        p_occurred_at => NOW(),
        p_created_by_user_id => p_user_id,
        p_last_event_id => v_event_id
    );
    
    -- Update reversal reference
    UPDATE inventory.stock_movements
    SET reversal_ref_id = p_movement_id
    WHERE id = v_reversal_id;
    
    -- Mark original as reversed
    UPDATE inventory.stock_movements
    SET posting_status = 'reversed'
    WHERE id = p_movement_id;
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'stock_movement.reversed',
        p_aggregate_type => 'stock_movement',
        p_aggregate_id => p_movement_id,
        p_payload => jsonb_build_object(
            'original_movement_id', p_movement_id,
            'reversal_movement_id', v_reversal_id,
            'catalog_item_id', v_movement.catalog_item_id,
            'location_id', v_movement.location_id,
            'original_delta', v_movement.quantity_delta,
            'reversal_delta', -v_movement.quantity_delta,
            'reason', p_reason
        ),
        p_metadata => jsonb_build_object(
            'reversed_by_user_id', p_user_id,
            'reversed_at', NOW()
        )
    );
    
    RETURN v_reversal_id;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION inventory.rpc_reverse_stock_movement TO authenticated;

COMMENT ON FUNCTION inventory.rpc_reverse_stock_movement IS 
'Reverses a stock movement by creating an offsetting entry. Original marked as reversed, new movement references original. Idempotent via last_event_id.';
