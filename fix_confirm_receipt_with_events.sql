-- Updated rpc_confirm_receipt with inventory events
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
    v_event_id TEXT;
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

    -- Generate event ID for this receipt confirmation
    v_event_id := 'rcpt-' || extract(epoch from now())::bigint || '-' || substr(md5(random()::text), 1, 8);

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
            v_event_id,
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

            -- CREATE INVENTORY EVENT for the receipt
            INSERT INTO inventory.inventory_events (
                tenant_id,
                event_type,
                occurred_at,
                actor_user_id,
                source_system,
                last_event_id,
                payload
            ) VALUES (
                p_tenant_id,
                'receive',
                NOW(),
                p_user_id,
                'receiving',
                v_event_id || '-' || v_line_number,
                jsonb_build_object(
                    'receipt_id', p_receipt_id,
                    'receipt_number', v_receipt.receipt_number,
                    'po_id', v_receipt.po_id,
                    'receipt_line_id', v_line_id,
                    'catalog_item_id', v_line->>'catalog_item_id',
                    'location_id', COALESCE(v_line->>'destination_location_id', v_receipt.location_id::text),
                    'qty', (v_line->>'qty_received')::NUMERIC,
                    'condition_status', COALESCE(v_line->>'condition_status', 'accepted'),
                    'unit_cost', (v_line->>'unit_cost_actual')::NUMERIC,
                    'reference', v_receipt.receipt_number,
                    'notes', v_line->>'notes'
                )
            );
        END IF;
    END LOOP;

    -- Update receipt status and event tracking
    UPDATE supply_chain.receipts
    SET 
        status = 'confirmed',
        last_event_id = v_event_id,
        updated_at = NOW(),
        updated_by = p_user_id
    WHERE id = p_receipt_id
      AND tenant_id = p_tenant_id;

    -- Also update PO's last_event_id
    UPDATE supply_chain.purchase_orders
    SET 
        last_event_id = v_event_id,
        updated_at = NOW(),
        updated_by = p_user_id
    WHERE id = v_receipt.po_id
      AND tenant_id = p_tenant_id;

    -- Return success
    SELECT jsonb_build_object(
        'success', true,
        'receipt_id', p_receipt_id,
        'status', 'confirmed',
        'event_id', v_event_id
    ) INTO v_result;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_confirm_receipt TO authenticated, service_role;
