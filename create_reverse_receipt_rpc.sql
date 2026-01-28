-- RPC to reverse/cancel a receipt
CREATE OR REPLACE FUNCTION supply_chain.rpc_reverse_receipt(
    p_tenant_id UUID,
    p_user_id UUID,
    p_receipt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
DECLARE
    v_receipt RECORD;
    v_line RECORD;
    v_event_id TEXT;
    v_result JSONB;
BEGIN
    -- Validate inputs
    IF p_tenant_id IS NULL OR p_user_id IS NULL OR p_receipt_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id, user_id, and receipt_id are required';
    END IF;

    -- Generate event ID for this reversal
    v_event_id := 'reverse-' || extract(epoch from now())::bigint || '-' || substr(md5(random()::text), 1, 8);

    -- Get and validate receipt
    SELECT * INTO v_receipt
    FROM supply_chain.receipts
    WHERE id = p_receipt_id
      AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Receipt not found';
    END IF;

    IF v_receipt.status != 'confirmed' THEN
        RAISE EXCEPTION 'Can only reverse confirmed receipts. Current status: %', v_receipt.status;
    END IF;

    -- Reverse each receipt line
    FOR v_line IN 
        SELECT * FROM supply_chain.receipt_lines
        WHERE receipt_id = p_receipt_id
          AND tenant_id = p_tenant_id
    LOOP
        -- Reverse PO line qty_received
        UPDATE supply_chain.purchase_order_lines
        SET 
            qty_received = qty_received - v_line.qty_received,
            updated_at = NOW(),
            updated_by = p_user_id
        WHERE id = v_line.po_line_id
          AND tenant_id = p_tenant_id;

        -- Reverse inventory for accepted items only
        IF v_line.condition_status = 'accepted' THEN
            UPDATE inventory.stock_balances
            SET 
                qty_on_hand = qty_on_hand - v_line.qty_received,
                updated_at = NOW()
            WHERE tenant_id = p_tenant_id
              AND catalog_item_id = v_line.catalog_item_id
              AND location_id = COALESCE(v_line.destination_location_id, v_receipt.location_id);

            -- CREATE INVENTORY EVENT for the reversal
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
                'adjust',
                NOW(),
                p_user_id,
                'receiving',
                v_event_id || '-' || v_line.line_number,
                jsonb_build_object(
                    'receipt_id', p_receipt_id,
                    'receipt_number', v_receipt.receipt_number,
                    'po_id', v_receipt.po_id,
                    'receipt_line_id', v_line.id,
                    'catalog_item_id', v_line.catalog_item_id::text,
                    'location_id', COALESCE(v_line.destination_location_id::text, v_receipt.location_id::text),
                    'qty', -v_line.qty_received,
                    'reason', 'receipt_reversal',
                    'reference', 'REVERSED: ' || v_receipt.receipt_number,
                    'notes', 'Receipt reversed by user'
                )
            );
        END IF;
    END LOOP;

    -- Update receipt status to cancelled
    UPDATE supply_chain.receipts
    SET 
        status = 'cancelled',
        last_event_id = v_event_id,
        updated_at = NOW(),
        updated_by = p_user_id
    WHERE id = p_receipt_id
      AND tenant_id = p_tenant_id;

    -- Return success
    SELECT jsonb_build_object(
        'success', true,
        'receipt_id', p_receipt_id,
        'status', 'cancelled'
    ) INTO v_result;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_reverse_receipt TO authenticated, service_role;
