-- Enforce the UOM-mismatch guardrail on receipt posting.
--
-- `guardrail_policies.uom_mismatch_policy` was configurable in Settings but
-- rpc_post_receipt_to_inventory_v2 never read it — the toggle did nothing.
-- This wires it in as a VALIDATION on a genuine unit mismatch: when a PO
-- line's UOM term differs from the catalog item's base/stocking UOM term, the
-- line is flagged and the policy applied:
--   block → reject the whole post (UOM_MISMATCH_BLOCKED)
--   warn  → allow, log a guardrail exception (default)
--   off   → ignore
--
-- It compares term ids (purchase_order_lines.uom_term_id vs
-- catalog_items.uom_term_id), so it only fires on a real mismatch — with no
-- conversions defined and items normally ordered in their base unit, existing
-- receiving is unaffected. Detection runs in the same pre-post validation pass
-- as the over-receipt check, so a block rejects before any stock is written.
-- NOTE: quantities are still posted as received; auto-converting the posted
-- quantity when a conversion exists is a deliberate follow-on, not done here.

CREATE OR REPLACE FUNCTION supply_chain.rpc_post_receipt_to_inventory_v2(p_receipt_id uuid, p_actor_user_id uuid DEFAULT NULL::uuid, p_override_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'supply_chain', 'inventory', 'public'
AS $function$
DECLARE
    v_tenant_id UUID;
    v_receipt supply_chain.receipts%ROWTYPE;
    v_line supply_chain.receipt_lines%ROWTYPE;
    v_catalog_item inventory.catalog_items%ROWTYPE;
    v_location inventory.locations%ROWTYPE;
    v_event_id TEXT;
    v_movement_id UUID;
    v_posted_count INT := 0;
    v_skipped_count INT := 0;
    v_rejected_count INT := 0;
    v_damaged_count INT := 0;
    v_result JSONB;
    v_movement_type TEXT;
    v_over_receipt_policy TEXT := 'block';
    v_over_receipt_threshold_pct NUMERIC := 0;
    v_require_reason BOOLEAN := true;
    v_uom_mismatch_policy TEXT := 'warn';
    v_uom_mismatch_lines JSONB := '[]'::jsonb;
    v_po_line RECORD;
    v_open_qty NUMERIC;
    v_max_allowed NUMERIC;
    v_over_receipt_lines JSONB := '[]'::jsonb;
BEGIN
    v_tenant_id := COALESCE(
        (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID,
        (auth.jwt() ->> 'tenant_id')::UUID
    );

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'No tenant_id in JWT. Authentication required.';
    END IF;

    SELECT
        COALESCE(gp.over_receipt_policy, 'block'),
        COALESCE(gp.over_receipt_threshold_pct, 0::numeric),
        COALESCE(gp.require_override_reason, true),
        COALESCE(gp.uom_mismatch_policy, 'warn')
    INTO v_over_receipt_policy, v_over_receipt_threshold_pct, v_require_reason, v_uom_mismatch_policy
    FROM (SELECT 1) AS dummy
    LEFT JOIN inventory.guardrail_policies gp ON gp.tenant_id = v_tenant_id;

    SELECT * INTO v_receipt
    FROM supply_chain.receipts
    WHERE id = p_receipt_id
      AND tenant_id = v_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Receipt % not found for tenant %', p_receipt_id, v_tenant_id;
    END IF;

    IF v_receipt.status = 'cancelled' THEN
        RAISE EXCEPTION 'Cannot post cancelled receipt %', p_receipt_id;
    END IF;

    IF v_receipt.status = 'confirmed' AND EXISTS (
        SELECT 1 FROM inventory.stock_movements
        WHERE tenant_id = v_tenant_id
          AND source_ref_type = 'receipt'
          AND source_ref_id = p_receipt_id
    ) THEN
        RETURN jsonb_build_object(
            'success', true,
            'receipt_id', p_receipt_id,
            'posted_lines', 0,
            'message', 'Already posted (idempotent)'
        );
    END IF;

    SELECT * INTO v_location
    FROM inventory.locations
    WHERE id = v_receipt.location_id
      AND tenant_id = v_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Location % not found in inventory schema', v_receipt.location_id;
    END IF;

    IF v_receipt.po_id IS NOT NULL THEN
        FOR v_line IN
            SELECT rl.*
            FROM supply_chain.receipt_lines rl
            WHERE rl.receipt_id = p_receipt_id
              AND rl.tenant_id = v_tenant_id
              AND rl.po_line_id IS NOT NULL
              AND rl.condition_status IS DISTINCT FROM 'rejected'
            ORDER BY rl.line_number
        LOOP
            SELECT pol.qty_ordered, pol.qty_received, ci.name AS item_name,
                   pol.uom_term_id AS po_uom_term_id, ci.uom_term_id AS item_uom_term_id
            INTO v_po_line
            FROM supply_chain.purchase_order_lines pol
            JOIN inventory.catalog_items ci ON ci.id = pol.catalog_item_id AND ci.tenant_id = pol.tenant_id
            WHERE pol.id = v_line.po_line_id
              AND pol.tenant_id = v_tenant_id;

            IF v_po_line IS NOT NULL THEN
                v_open_qty := GREATEST(0, v_po_line.qty_ordered - v_po_line.qty_received);
                v_max_allowed := v_open_qty * (1 + v_over_receipt_threshold_pct / 100);

                IF v_line.qty_received > v_max_allowed THEN
                    v_over_receipt_lines := v_over_receipt_lines || jsonb_build_object(
                        'line_number', v_line.line_number,
                        'item_name', v_po_line.item_name,
                        'qty_receiving', v_line.qty_received,
                        'open_qty', v_open_qty,
                        'max_allowed', v_max_allowed,
                        'overage', v_line.qty_received - v_open_qty
                    );
                END IF;

                -- UOM mismatch: line ordered/received in a unit different from
                -- the item's base stocking unit. Compared by term id, so it only
                -- fires on a real mismatch.
                IF v_uom_mismatch_policy <> 'off'
                   AND v_po_line.po_uom_term_id IS NOT NULL
                   AND v_po_line.item_uom_term_id IS NOT NULL
                   AND v_po_line.po_uom_term_id <> v_po_line.item_uom_term_id THEN
                    v_uom_mismatch_lines := v_uom_mismatch_lines || jsonb_build_object(
                        'line_number', v_line.line_number,
                        'item_name', v_po_line.item_name,
                        'received_uom_term_id', v_po_line.po_uom_term_id,
                        'item_uom_term_id', v_po_line.item_uom_term_id
                    );
                END IF;
            END IF;
        END LOOP;

        IF jsonb_array_length(v_over_receipt_lines) > 0 THEN
            IF v_over_receipt_policy = 'block' THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', jsonb_build_object(
                        'code', 'OVER_RECEIPT_BLOCKED',
                        'message', format(
                            '%s line(s) exceed the PO open quantity.',
                            jsonb_array_length(v_over_receipt_lines)
                        ),
                        'details', jsonb_build_object(
                            'receipt_id', p_receipt_id,
                            'receipt_number', v_receipt.receipt_number,
                            'over_receipt_lines', v_over_receipt_lines,
                            'threshold_pct', v_over_receipt_threshold_pct
                        ),
                        'action', 'Reduce receiving quantities to match PO open quantity, or change over-receipt policy in Settings.'
                    )
                );
            END IF;

            IF v_require_reason AND (p_override_reason IS NULL OR trim(p_override_reason) = '') THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', jsonb_build_object(
                        'code', 'OVERRIDE_REASON_REQUIRED',
                        'message', 'An override reason is required to receive more than the PO open quantity.',
                        'details', jsonb_build_object(
                            'over_receipt_lines', v_over_receipt_lines,
                            'threshold_pct', v_over_receipt_threshold_pct
                        ),
                        'action', 'Provide an override reason explaining why over-receipt is acceptable.'
                    )
                );
            END IF;
        END IF;

        -- UOM mismatch enforcement (block rejects before any stock is written).
        IF jsonb_array_length(v_uom_mismatch_lines) > 0 AND v_uom_mismatch_policy = 'block' THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', jsonb_build_object(
                    'code', 'UOM_MISMATCH_BLOCKED',
                    'message', format(
                        '%s line(s) are being received in a unit that differs from the item''s stocking unit.',
                        jsonb_array_length(v_uom_mismatch_lines)
                    ),
                    'details', jsonb_build_object(
                        'receipt_id', p_receipt_id,
                        'receipt_number', v_receipt.receipt_number,
                        'uom_mismatch_lines', v_uom_mismatch_lines
                    ),
                    'action', 'Match the purchase unit to the item''s stocking unit, or change the UOM mismatch policy in Settings.'
                )
            );
        END IF;
    END IF;

    FOR v_line IN
        SELECT *
        FROM supply_chain.receipt_lines
        WHERE receipt_id = p_receipt_id
          AND tenant_id = v_tenant_id
        ORDER BY line_number
    LOOP
        SELECT * INTO v_catalog_item
        FROM inventory.catalog_items
        WHERE id = v_line.catalog_item_id
          AND tenant_id = v_tenant_id;

        IF NOT FOUND THEN
            RAISE WARNING 'Catalog item % not found. Skipping line %.', v_line.catalog_item_id, v_line.line_number;
            v_skipped_count := v_skipped_count + 1;
            CONTINUE;
        END IF;

        v_event_id := 'receipt-' || p_receipt_id::TEXT || '-line-' || v_line.line_number::TEXT || '-post-' || extract(epoch from now())::TEXT;

        CASE v_line.condition_status
            WHEN 'rejected' THEN
                INSERT INTO inventory.inventory_events (
                    tenant_id, event_type, occurred_at, actor_user_id,
                    source_system, last_event_id, payload
                ) VALUES (
                    v_tenant_id, 'receive', v_receipt.received_at,
                    COALESCE(p_actor_user_id, v_receipt.received_by_user_id),
                    'supply_chain.receipts', v_event_id,
                    jsonb_build_object(
                        'receipt_id', p_receipt_id,
                        'receipt_number', v_receipt.receipt_number,
                        'receipt_line_id', v_line.id,
                        'line_number', v_line.line_number,
                        'catalog_item_id', v_line.catalog_item_id,
                        'location_id', COALESCE(v_line.destination_location_id, v_receipt.location_id),
                        'quantity_delta', 0,
                        'qty_received', v_line.qty_received,
                        'condition', 'rejected',
                        'reason', 'Items rejected during receiving',
                        'correlation_id', p_receipt_id
                    )
                )
                ON CONFLICT (tenant_id, last_event_id) DO NOTHING;

                v_rejected_count := v_rejected_count + 1;

            WHEN 'damaged' THEN
                v_damaged_count := v_damaged_count + 1;
                v_movement_type := 'damaged';

            WHEN 'quarantine' THEN
                v_movement_type := 'received';

            ELSE
                v_movement_type := 'received';
        END CASE;

        IF v_line.condition_status = 'rejected' THEN
            CONTINUE;
        END IF;

        INSERT INTO inventory.inventory_events (
            tenant_id, event_type, occurred_at, actor_user_id,
            source_system, last_event_id, payload
        ) VALUES (
            v_tenant_id, 'receive', v_receipt.received_at,
            COALESCE(p_actor_user_id, v_receipt.received_by_user_id),
            'supply_chain.receipts', v_event_id,
            jsonb_build_object(
                'receipt_id', p_receipt_id,
                'receipt_number', v_receipt.receipt_number,
                'receipt_line_id', v_line.id,
                'line_number', v_line.line_number,
                'catalog_item_id', v_line.catalog_item_id,
                'location_id', COALESCE(v_line.destination_location_id, v_receipt.location_id),
                'quantity_delta', v_line.qty_received,
                'po_id', v_receipt.po_id,
                'po_line_id', v_line.po_line_id,
                'condition_status', v_line.condition_status,
                'unit_cost_actual', v_line.unit_cost_actual,
                'correlation_id', p_receipt_id
            )
        )
        ON CONFLICT (tenant_id, last_event_id) DO NOTHING;

        INSERT INTO inventory.stock_movements (
            tenant_id, catalog_item_id, location_id, quantity_delta,
            movement_type, source_ref_type, source_ref_id, unit_cost,
            currency, notes, correlation_id, occurred_at,
            created_by_user_id, last_event_id
        ) VALUES (
            v_tenant_id, v_line.catalog_item_id,
            COALESCE(v_line.destination_location_id, v_receipt.location_id),
            v_line.qty_received, v_movement_type, 'receipt', p_receipt_id,
            COALESCE(v_line.unit_cost_actual, (
                SELECT unit_cost FROM supply_chain.purchase_order_lines
                WHERE id = v_line.po_line_id
            )),
            'USD',
            CASE
                WHEN v_line.condition_status = 'damaged' THEN 'Received as DAMAGED - ' || COALESCE(v_line.notes, '')
                WHEN v_line.condition_status = 'quarantine' THEN 'Received in QUARANTINE - ' || COALESCE(v_line.notes, '')
                ELSE 'Posted from receipt ' || v_receipt.receipt_number
            END,
            p_receipt_id, v_receipt.received_at,
            COALESCE(p_actor_user_id, v_receipt.received_by_user_id),
            v_event_id
        )
        ON CONFLICT (tenant_id, last_event_id) DO NOTHING
        RETURNING id INTO v_movement_id;

        IF v_movement_id IS NULL THEN
            v_skipped_count := v_skipped_count + 1;
            CONTINUE;
        END IF;

        IF v_line.po_line_id IS NOT NULL THEN
            UPDATE supply_chain.purchase_order_lines
            SET
                qty_received = qty_received + v_line.qty_received,
                status = CASE
                    WHEN qty_received + v_line.qty_received >= qty_ordered THEN 'fully_received'
                    WHEN qty_received + v_line.qty_received > 0 THEN 'partially_received'
                    ELSE status
                END,
                updated_at = NOW(),
                updated_by = COALESCE(p_actor_user_id, v_receipt.received_by_user_id)
            WHERE id = v_line.po_line_id
              AND tenant_id = v_tenant_id;
        END IF;

        v_posted_count := v_posted_count + 1;
    END LOOP;

    IF v_receipt.po_id IS NOT NULL THEN
        UPDATE supply_chain.purchase_orders po
        SET status = (
            SELECT CASE
                WHEN COUNT(*) = COUNT(*) FILTER (WHERE pol.status = 'fully_received') THEN 'fully_received'
                WHEN COUNT(*) FILTER (WHERE pol.status IN ('fully_received', 'partially_received')) > 0 THEN 'partially_received'
                ELSE po.status
            END
            FROM supply_chain.purchase_order_lines pol
            WHERE pol.po_id = po.id
              AND pol.tenant_id = po.tenant_id
        ),
        updated_at = NOW(),
        updated_by = COALESCE(p_actor_user_id, v_receipt.received_by_user_id)
        WHERE id = v_receipt.po_id
          AND tenant_id = v_tenant_id;
    END IF;

    UPDATE supply_chain.receipts
    SET
        status = 'confirmed',
        updated_at = NOW(),
        updated_by = COALESCE(p_actor_user_id, v_receipt.received_by_user_id)
    WHERE id = p_receipt_id
      AND tenant_id = v_tenant_id;

    IF jsonb_array_length(v_over_receipt_lines) > 0 AND p_override_reason IS NOT NULL THEN
        PERFORM inventory.log_guardrail_exception(
            v_tenant_id,
            COALESCE(p_actor_user_id, v_receipt.received_by_user_id),
            'receipt',
            p_receipt_id,
            'over_receipt',
            p_override_reason,
            jsonb_build_object(
                'receipt_number', v_receipt.receipt_number,
                'po_id', v_receipt.po_id,
                'over_receipt_lines', v_over_receipt_lines
            )
        );
    END IF;

    -- Warn policy: receipt posts, but the mismatch is logged for audit.
    IF jsonb_array_length(v_uom_mismatch_lines) > 0 AND v_uom_mismatch_policy = 'warn' THEN
        PERFORM inventory.log_guardrail_exception(
            v_tenant_id,
            COALESCE(p_actor_user_id, v_receipt.received_by_user_id),
            'receipt',
            p_receipt_id,
            'uom_mismatch',
            COALESCE(NULLIF(trim(p_override_reason), ''), 'Received in a unit different from the item stocking unit'),
            jsonb_build_object(
                'receipt_number', v_receipt.receipt_number,
                'po_id', v_receipt.po_id,
                'uom_mismatch_lines', v_uom_mismatch_lines
            )
        );
    END IF;

    v_result := jsonb_build_object(
        'success', true,
        'receipt_id', p_receipt_id,
        'receipt_number', v_receipt.receipt_number,
        'posted_lines', v_posted_count,
        'rejected_lines', v_rejected_count,
        'damaged_lines', v_damaged_count,
        'skipped_lines', v_skipped_count,
        'location_id', v_receipt.location_id,
        'location_name', v_location.name,
        'received_at', v_receipt.received_at,
        'override_logged', (jsonb_array_length(v_over_receipt_lines) > 0 AND p_override_reason IS NOT NULL),
        'uom_mismatch_logged', (jsonb_array_length(v_uom_mismatch_lines) > 0 AND v_uom_mismatch_policy = 'warn'),
        'message', format('Posted %s lines, rejected %s, damaged %s, skipped %s',
            v_posted_count, v_rejected_count, v_damaged_count, v_skipped_count)
    );

    RETURN v_result;

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to post receipt % to inventory: %', p_receipt_id, SQLERRM;
END;
$function$;
