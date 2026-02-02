-- Fix transfer creation to support both fungible and serialized items

CREATE OR REPLACE FUNCTION "inventory"."rpc_inv_transfer_create"(
    "p_tenant_id" "uuid", 
    "p_from_location_id" "uuid", 
    "p_to_location_id" "uuid", 
    "p_lines" "jsonb", 
    "p_initiated_by_user_id" "uuid", 
    "p_notes" "text" DEFAULT NULL::"text", 
    "p_last_event_id" "text" DEFAULT NULL::"text"
) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_transfer_id UUID;
    v_transfer_number TEXT;
    v_line JSONB;
    v_line_number INTEGER := 1;
    v_event_id TEXT;
    v_stock_balance RECORD;
    v_item_name TEXT;
    v_location_name TEXT;
    v_tracking_mode TEXT;
    v_available_assets INTEGER;
BEGIN
    -- Validate tenant
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id is required';
    END IF;
    
    -- Validate locations
    IF p_from_location_id = p_to_location_id THEN
        RAISE EXCEPTION 'from_location_id and to_location_id must be different';
    END IF;
    
    -- Validate availability for all lines BEFORE creating transfer
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        -- Get item tracking mode
        SELECT tracking_mode, name INTO v_tracking_mode, v_item_name
        FROM inventory.catalog_items
        WHERE id = (v_line->>'catalog_item_id')::UUID
        AND tenant_id = p_tenant_id;
        
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Catalog item not found';
        END IF;
        
        -- Get location name for error messages
        SELECT name INTO v_location_name
        FROM inventory.locations
        WHERE id = p_from_location_id
        AND tenant_id = p_tenant_id;
        
        -- Handle based on tracking mode
        IF v_tracking_mode = 'serialized' THEN
            -- For serialized items: check if assets are available at location
            SELECT COUNT(*) INTO v_available_assets
            FROM inventory.assets
            WHERE tenant_id = p_tenant_id
            AND catalog_item_id = (v_line->>'catalog_item_id')::UUID
            AND location_id = p_from_location_id
            AND status IN ('available', 'assigned'); -- Both available and assigned can be transferred
            
            IF v_available_assets < (v_line->>'qty')::INTEGER THEN
                RAISE EXCEPTION 'Insufficient assets for item "%" at location "%". Available: %, Requested: %',
                    v_item_name,
                    v_location_name,
                    v_available_assets,
                    (v_line->>'qty')::INTEGER;
            END IF;
        ELSE
            -- For fungible/stock items: check stock balance
            SELECT sb.qty_on_hand, sb.qty_reserved, ci.name
            INTO v_stock_balance
            FROM inventory.stock_balances sb
            JOIN inventory.catalog_items ci ON sb.catalog_item_id = ci.id
            WHERE sb.tenant_id = p_tenant_id
            AND sb.catalog_item_id = (v_line->>'catalog_item_id')::UUID
            AND sb.location_id = p_from_location_id;
            
            -- If no stock balance exists, item is not at this location
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Item "%" has no inventory at location "%". Cannot create transfer.', 
                    v_item_name, v_location_name;
            END IF;
            
            -- Check if sufficient qty_on_hand is available
            IF v_stock_balance.qty_on_hand < (v_line->>'qty')::NUMERIC THEN
                RAISE EXCEPTION 'Insufficient stock for item "%" at location "%". Available: %, Requested: %', 
                    v_stock_balance.name, 
                    v_location_name, 
                    v_stock_balance.qty_on_hand,
                    (v_line->>'qty')::NUMERIC;
            END IF;
        END IF;
    END LOOP;
    
    -- Require event ID for strict idempotency
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required';
    END IF;
    v_event_id := p_last_event_id;
    
    -- Generate transfer number using a more robust method to avoid race conditions
    v_transfer_number := 'TRF-' || to_char(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0') || SUBSTRING(gen_random_uuid()::TEXT, 1, 4);
    
    -- Try to insert, and if number collision, retry with new random number
    LOOP
        BEGIN
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
            
            -- If we got an ID, break out of loop
            IF v_transfer_id IS NOT NULL THEN
                EXIT;
            END IF;
            
            -- If no ID returned, transfer already exists (idempotency via last_event_id)
            SELECT id INTO v_transfer_id
            FROM inventory.transfers
            WHERE tenant_id = p_tenant_id
            AND last_event_id = v_event_id;
            
            IF v_transfer_id IS NOT NULL THEN
                RETURN v_transfer_id;
            END IF;
            
        EXCEPTION
            WHEN unique_violation THEN
                -- If it's a transfer_number collision, generate new number and retry
                IF SQLERRM LIKE '%transfers_tenant_transfer_number_unique%' THEN
                    v_transfer_number := 'TRF-' || to_char(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0') || SUBSTRING(gen_random_uuid()::TEXT, 1, 4);
                    CONTINUE;
                ELSE
                    RAISE;
                END IF;
        END;
    END LOOP;
    
    -- Insert lines
    v_line_number := 1;
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
        p_scope => 'tenant',
        p_event_type => 'transfer.created',
        p_aggregate_type => 'transfer',
        p_aggregate_id => v_transfer_id,
        p_payload => jsonb_build_object(
            'transfer_id', v_transfer_id,
            'from_location_id', p_from_location_id,
            'to_location_id', p_to_location_id,
            'line_count', jsonb_array_length(p_lines)
        )
    );
    
    RETURN v_transfer_id;
END;
$$;

COMMENT ON FUNCTION "inventory"."rpc_inv_transfer_create" IS 'Creates transfer in draft status with validation for both fungible (stock) and serialized (assets) items';
