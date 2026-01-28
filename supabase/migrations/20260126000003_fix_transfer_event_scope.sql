-- Fix: Transfer creation event scope should be 'tenant' not 'inventory'
-- The events_outbox_scope_check constraint only allows: 'tenant', 'profile', 'global'

CREATE OR REPLACE FUNCTION "inventory"."rpc_inv_transfer_create"("p_tenant_id" "uuid", "p_from_location_id" "uuid", "p_to_location_id" "uuid", "p_lines" "jsonb", "p_initiated_by_user_id" "uuid", "p_notes" "text" DEFAULT NULL::"text", "p_last_event_id" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
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
    
    -- Publish event (FIXED: scope changed from 'inventory' to 'tenant')
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
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

COMMENT ON FUNCTION "inventory"."rpc_inv_transfer_create" IS 'Creates transfer in draft status (idempotent) - Fixed scope constraint issue';
