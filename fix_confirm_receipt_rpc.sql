-- Fix rpc_confirm_receipt to process receipt lines and update inventory
DROP FUNCTION IF EXISTS supply_chain.rpc_confirm_receipt CASCADE;

CREATE OR REPLACE FUNCTION supply_chain.rpc_confirm_receipt(
    p_tenant_id UUID,
    p_user_id UUID,
    p_receipt_id UUID,
    p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
DECLARE
    v_receipt RECORD;
    v_line JSONB;
    v_line_id UUID;
    v_line_number INT := 0;
    v_result JSONB;
BEGIN
    -- Validate inputs
    IF p_tenant_id IS NULL OR p_user_id IS NULL OR p_receipt_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id, user_id, and receipt_id are required';
    END IF;

    -- Get and validate receipt
    SELECT * INTO v_receipt
    FROM supply_chain.receipts
    WHERE id = p_receipt_id
      AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Receipt not found';
    END IF;

    IF v_receipt.status != 'draft' THEN
        RAISE EXCEPTION 'Can only confirm draft receipts. Current status: %', v_receipt.status;
    END IF;

    -- Process each receipt line
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        -- Skip lines with 0 quantity
        IF (v_line->>'qty_received')::NUMERIC <= 0 THEN
            CONTINUE;
        END IF;

        -- Increment line number
        v_line_number := v_line_number + 1;

        -- Create receipt line
        INSERT INTO supply_chain.receipt_lines (
            tenant_id,
            receipt_id,
            po_line_id,
            line_number,
            catalog_item_id,
            qty_received,
            condition_status,
            destination_location_id,
            unit_cost_actual,
            notes,
            last_event_id,
            created_by
        ) VALUES (
            p_tenant_id,
            p_receipt_id,
            (v_line->>'po_line_id')::UUID,
            v_line_number,
            (v_line->>'catalog_item_id')::UUID,
            (v_line->>'qty_received')::NUMERIC,
            COALESCE(v_line->>'condition_status', 'accepted'),
            COALESCE((v_line->>'destination_location_id')::UUID, v_receipt.location_id),
            (v_line->>'unit_cost_actual')::NUMERIC,
            v_line->>'notes',
            'rcl-' || extract(epoch from now())::bigint || '-' || substr(md5(random()::text), 1, 6),
            p_user_id
        )
        RETURNING id INTO v_line_id;

        -- Update PO line qty_received (trigger will update status)
        UPDATE supply_chain.purchase_order_lines
        SET 
            qty_received = qty_received + (v_line->>'qty_received')::NUMERIC,
            updated_at = NOW(),
            updated_by = p_user_id
        WHERE id = (v_line->>'po_line_id')::UUID
          AND tenant_id = p_tenant_id;

        -- Update inventory for accepted items only
        IF COALESCE(v_line->>'condition_status', 'accepted') = 'accepted' THEN
            -- Upsert stock balance (qty_available is auto-calculated)
            INSERT INTO inventory.stock_balances (
                tenant_id,
                catalog_item_id,
                location_id,
                qty_on_hand
            ) VALUES (
                p_tenant_id,
                (v_line->>'catalog_item_id')::UUID,
                COALESCE((v_line->>'destination_location_id')::UUID, v_receipt.location_id),
                (v_line->>'qty_received')::NUMERIC
            )
            ON CONFLICT (tenant_id, catalog_item_id, location_id)
            DO UPDATE SET
                qty_on_hand = stock_balances.qty_on_hand + EXCLUDED.qty_on_hand,
                updated_at = NOW();
        END IF;
    END LOOP;

    -- Update receipt status to confirmed
    UPDATE supply_chain.receipts
    SET 
        status = 'confirmed',
        received_at = NOW(),
        received_by_user_id = p_user_id,
        updated_at = NOW()
    WHERE id = p_receipt_id
      AND tenant_id = p_tenant_id;

    -- Return success with receipt details
    SELECT jsonb_build_object(
        'success', true,
        'receipt_id', p_receipt_id,
        'status', 'confirmed'
    ) INTO v_result;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_confirm_receipt TO authenticated, service_role;
