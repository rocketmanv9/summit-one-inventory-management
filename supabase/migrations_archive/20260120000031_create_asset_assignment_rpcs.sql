-- ============================================================================
-- PHASE 4: ASSET ASSIGNMENT RPCs
-- ============================================================================
-- Business logic for assigning and returning assets

-- =====================================================
-- Assign Asset
-- =====================================================
CREATE OR REPLACE FUNCTION inventory.rpc_inv_asset_assign(
    p_tenant_id UUID,
    p_asset_id UUID,
    p_assigned_to_type TEXT,
    p_assigned_to_id UUID,
    p_assigned_by_user_id UUID,
    p_notes TEXT DEFAULT NULL,
    p_last_event_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_assignment_id UUID;
    v_asset RECORD;
    v_event_id TEXT;
    v_existing_assignment UUID;
BEGIN
    -- Validate
    IF p_tenant_id IS NULL OR p_asset_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id and asset_id are required';
    END IF;
    
    -- Generate event ID
    v_event_id := COALESCE(p_last_event_id, 'asset_assign_' || gen_random_uuid()::TEXT);
    
    -- Get asset
    SELECT * INTO v_asset
    FROM inventory.assets
    WHERE id = p_asset_id
    AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Asset not found';
    END IF;
    
    -- Check for existing active assignment
    SELECT id INTO v_existing_assignment
    FROM inventory.asset_assignments
    WHERE asset_id = p_asset_id
    AND tenant_id = p_tenant_id
    AND returned_at IS NULL;
    
    IF v_existing_assignment IS NOT NULL THEN
        RAISE EXCEPTION 'Asset already assigned - must return before reassigning';
    END IF;
    
    -- Create assignment (idempotent)
    INSERT INTO inventory.asset_assignments (
        tenant_id,
        asset_id,
        assigned_to_type,
        assigned_to_id,
        assigned_by_user_id,
        assigned_at,
        notes,
        last_event_id
    ) VALUES (
        p_tenant_id,
        p_asset_id,
        p_assigned_to_type,
        p_assigned_to_id,
        p_assigned_by_user_id,
        NOW(),
        p_notes,
        v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_assignment_id;
    
    -- If no ID returned, assignment already exists
    IF v_assignment_id IS NULL THEN
        SELECT id INTO v_assignment_id
        FROM inventory.asset_assignments
        WHERE tenant_id = p_tenant_id
        AND last_event_id = v_event_id;
        
        RETURN v_assignment_id;
    END IF;
    
    -- Update asset status
    UPDATE inventory.assets
    SET 
        status = 'assigned',
        updated_at = NOW()
    WHERE id = p_asset_id;
    
    -- Update asset_state read model
    INSERT INTO inventory.asset_state (
        id, tenant_id, asset_id, current_status, assigned_to_ref, last_movement_at
    ) VALUES (
        p_asset_id, p_tenant_id, p_asset_id, 'assigned',
        jsonb_build_object('type', p_assigned_to_type, 'id', p_assigned_to_id),
        NOW()
    )
    ON CONFLICT (tenant_id, asset_id) DO UPDATE
    SET 
        current_status = 'assigned',
        assigned_to_ref = jsonb_build_object('type', p_assigned_to_type, 'id', p_assigned_to_id),
        last_movement_at = NOW(),
        updated_at = NOW();
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'asset',
        p_event_type => 'asset.assigned',
        p_aggregate_type => 'asset',
        p_aggregate_id => p_asset_id,
        p_payload => jsonb_build_object(
            'asset_id', p_asset_id,
            'asset_tag', v_asset.asset_tag,
            'assignment_id', v_assignment_id,
            'assigned_to_type', p_assigned_to_type,
            'assigned_to_id', p_assigned_to_id
        )
    );
    
    RETURN v_assignment_id;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_asset_assign IS 
    'Assigns asset to employee/vehicle/job (idempotent)';

-- =====================================================
-- Return Asset
-- =====================================================
CREATE OR REPLACE FUNCTION inventory.rpc_inv_asset_return(
    p_tenant_id UUID,
    p_asset_id UUID,
    p_return_condition TEXT DEFAULT 'good',
    p_notes TEXT DEFAULT NULL,
    p_last_event_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_assignment RECORD;
    v_asset RECORD;
    v_event_id TEXT;
BEGIN
    -- Generate event ID
    v_event_id := COALESCE(p_last_event_id, 'asset_return_' || gen_random_uuid()::TEXT);
    
    -- Get active assignment
    SELECT * INTO v_assignment
    FROM inventory.asset_assignments
    WHERE asset_id = p_asset_id
    AND tenant_id = p_tenant_id
    AND returned_at IS NULL;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active assignment found for asset';
    END IF;
    
    -- Get asset
    SELECT * INTO v_asset
    FROM inventory.assets
    WHERE id = p_asset_id
    AND tenant_id = p_tenant_id;
    
    -- Update assignment (idempotent check via last_event_id in notes)
    UPDATE inventory.asset_assignments
    SET 
        returned_at = NOW(),
        return_condition = p_return_condition,
        notes = COALESCE(notes, '') || E'\nReturn: ' || COALESCE(p_notes, ''),
        updated_at = NOW()
    WHERE id = v_assignment.id
    AND returned_at IS NULL; -- Double-check it hasn't been returned
    
    -- Update asset status based on condition
    UPDATE inventory.assets
    SET 
        status = CASE p_return_condition
            WHEN 'good' THEN 'available'
            WHEN 'damaged' THEN 'in_repair'
            WHEN 'needs_repair' THEN 'in_repair'
            ELSE 'out_of_service'
        END,
        updated_at = NOW()
    WHERE id = p_asset_id;
    
    -- Update asset_state read model
    UPDATE inventory.asset_state
    SET 
        current_status = CASE p_return_condition
            WHEN 'good' THEN 'available'
            WHEN 'damaged' THEN 'in_repair'
            WHEN 'needs_repair' THEN 'in_repair'
            ELSE 'out_of_service'
        END,
        assigned_to_ref = NULL,
        last_movement_at = NOW(),
        updated_at = NOW()
    WHERE asset_id = p_asset_id
    AND tenant_id = p_tenant_id;
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'asset',
        p_event_type => 'asset.returned',
        p_aggregate_type => 'asset',
        p_aggregate_id => p_asset_id,
        p_payload => jsonb_build_object(
            'asset_id', p_asset_id,
            'asset_tag', v_asset.asset_tag,
            'assignment_id', v_assignment.id,
            'return_condition', p_return_condition,
            'days_assigned', EXTRACT(DAY FROM (NOW() - v_assignment.assigned_at))
        )
    );
    
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_asset_return IS 
    'Returns asset from assignment';

DO $$ BEGIN
    RAISE NOTICE '✅ Asset assignment RPCs created';
END $$;

