-- ============================================================================
-- Settings cleanup & enforcement (2026-07-07)
--
-- 1. Assignment types: auto-seed defaults per tenant (the validate trigger on
--    asset_assignments rejects any type not present + active, so an unseeded
--    tenant could never assign an asset). Seeds existing tenants and makes the
--    trigger self-healing for future tenants.
-- 2. Delete protection: BEFORE DELETE triggers on assignment_types and
--    reservation_types — system/global rows and in-use types can't be deleted
--    (ERRCODE 23001 so the API maps it to a friendly 409).
-- 3. UoM conversions: actually apply them. rpc_post_receipt_to_inventory_v2
--    now converts received quantities (and unit costs) to the item's stocking
--    unit when a conversion path exists in inventory.uom_conversions; the
--    uom_mismatch guardrail policy only applies when NO conversion exists.
--    Conversions are logged to guardrail_exceptions with rule 'uom_converted'.
-- ============================================================================

-- ── 1a. Fix the seed function: it omitted last_event_id (NOT NULL), so it
--        could never insert a row — which is why assignment_types was empty
--        and asset assignment was un-usable on a fresh tenant.
CREATE OR REPLACE FUNCTION inventory.seed_default_assignment_types(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $$
BEGIN
    -- Only seed if tenant has no assignment types
    IF NOT EXISTS (SELECT 1 FROM inventory.assignment_types WHERE tenant_id = p_tenant_id) THEN
        INSERT INTO inventory.assignment_types (tenant_id, type_key, display_name, icon, is_system, sort_order, description, last_event_id) VALUES
            (p_tenant_id, 'employee', 'Employee', '👤', true, 10, 'Assign to individual employee', 'seed-assign-type-employee-' || p_tenant_id),
            (p_tenant_id, 'crew', 'Crew', '👥', false, 20, 'Assign to work crew or team', 'seed-assign-type-crew-' || p_tenant_id),
            (p_tenant_id, 'vehicle', 'Vehicle', '🚛', true, 30, 'Assign to company vehicle or truck', 'seed-assign-type-vehicle-' || p_tenant_id),
            (p_tenant_id, 'job', 'Job Site', '🏗️', true, 40, 'Assign to specific job or project', 'seed-assign-type-job-' || p_tenant_id),
            (p_tenant_id, 'yard', 'Yard/Location', '📍', true, 50, 'Assign to yard, warehouse, or storage location', 'seed-assign-type-yard-' || p_tenant_id),
            (p_tenant_id, 'department', 'Department', '🏢', false, 60, 'Assign to department or division', 'seed-assign-type-department-' || p_tenant_id);

        RAISE NOTICE 'Seeded default assignment types for tenant %', p_tenant_id;
    END IF;
END;
$$;

-- ── 1b. Seed default assignment types for every existing tenant ────────────
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT DISTINCT tenant_id FROM public.local_users WHERE tenant_id IS NOT NULL
    LOOP
        PERFORM inventory.seed_default_assignment_types(t.tenant_id);
    END LOOP;
END $$;

-- ── 1c. Self-healing validation: seed defaults before validating ───────────
CREATE OR REPLACE FUNCTION inventory.validate_assignment_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $$
DECLARE
    v_type_exists BOOLEAN;
BEGIN
    -- A tenant with no assignment types at all gets the defaults seeded on
    -- first use instead of a hard failure.
    IF NOT EXISTS (SELECT 1 FROM inventory.assignment_types WHERE tenant_id = NEW.tenant_id) THEN
        PERFORM inventory.seed_default_assignment_types(NEW.tenant_id);
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM inventory.assignment_types
        WHERE tenant_id = NEW.tenant_id
        AND type_key = NEW.assigned_to_type
        AND is_active = true
    ) INTO v_type_exists;

    IF NOT v_type_exists THEN
        RAISE EXCEPTION 'Invalid or inactive assignment type: %. Please use a valid assignment type from your configuration.',
            NEW.assigned_to_type
        USING
            ERRCODE = 'check_violation',
            HINT = 'Check inventory.assignment_types table for valid assignment types';
    END IF;

    RETURN NEW;
END;
$$;

-- ── 2a. Assignment types: protect system rows + in-use types from delete ───
CREATE OR REPLACE FUNCTION inventory.protect_assignment_type_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'public'
AS $$
DECLARE
    v_in_use BIGINT;
BEGIN
    IF OLD.is_system THEN
        RAISE EXCEPTION 'Cannot delete system assignment type "%". Deactivate it instead.', OLD.display_name
        USING ERRCODE = '23001';
    END IF;

    SELECT count(*) INTO v_in_use
    FROM inventory.asset_assignments
    WHERE tenant_id = OLD.tenant_id
      AND assigned_to_type = OLD.type_key;

    IF v_in_use > 0 THEN
        RAISE EXCEPTION 'Assignment type "%" is used by % assignment record(s) and can''t be deleted. Deactivate it instead.',
            OLD.display_name, v_in_use
        USING ERRCODE = '23001';
    END IF;

    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS protect_assignment_type_delete ON inventory.assignment_types;
CREATE TRIGGER protect_assignment_type_delete
    BEFORE DELETE ON inventory.assignment_types
    FOR EACH ROW EXECUTE FUNCTION inventory.protect_assignment_type_delete();

-- ── 2b. Reservation types: protect global/system rows + in-use types ───────
CREATE OR REPLACE FUNCTION inventory.protect_reservation_type_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'public'
AS $$
DECLARE
    v_in_use BIGINT;
BEGIN
    IF OLD.is_system OR OLD.tenant_id IS NULL THEN
        RAISE EXCEPTION 'Cannot delete global reservation type "%". Add a custom type instead.', OLD.display_name
        USING ERRCODE = '23001';
    END IF;

    SELECT count(*) INTO v_in_use
    FROM inventory.reservations
    WHERE tenant_id = OLD.tenant_id
      AND allocation_type = OLD.type_key;

    IF v_in_use > 0 THEN
        RAISE EXCEPTION 'Reservation type "%" is used by % reservation(s) and can''t be deleted. Deactivate it instead.',
            OLD.display_name, v_in_use
        USING ERRCODE = '23001';
    END IF;

    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS protect_reservation_type_delete ON inventory.reservation_types;
CREATE TRIGGER protect_reservation_type_delete
    BEFORE DELETE ON inventory.reservation_types
    FOR EACH ROW EXECUTE FUNCTION inventory.protect_reservation_type_delete();

-- ── 3a. Allow 'uom_converted' in the guardrail exception audit log ──────────
ALTER TABLE inventory.guardrail_exceptions
    DROP CONSTRAINT IF EXISTS guardrail_exceptions_rule_check;
ALTER TABLE inventory.guardrail_exceptions
    ADD CONSTRAINT guardrail_exceptions_rule_check
    CHECK (rule = ANY (ARRAY['negative_inventory'::text, 'over_receipt'::text, 'uom_mismatch'::text, 'uom_converted'::text]));

-- ── 3b. Receipt posting: apply UoM conversions to posted quantities ─────────
CREATE OR REPLACE FUNCTION supply_chain.rpc_post_receipt_to_inventory_v2(
    p_receipt_id uuid,
    p_actor_user_id uuid DEFAULT NULL::uuid,
    p_override_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'supply_chain', 'inventory', 'public'
AS $$
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
    v_uom_converted_lines JSONB := '[]'::jsonb;
    v_uom_factors JSONB := '{}'::jsonb;
    v_factor NUMERIC;
    v_qty_posted NUMERIC;
    v_unit_cost NUMERIC;
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

                -- UoM handling: when the PO line unit differs from the item's
                -- stocking unit, first try a configured conversion. A converted
                -- line posts qty * factor in the stocking unit. Only when NO
                -- conversion path exists does the mismatch policy apply.
                IF v_po_line.po_uom_term_id IS NOT NULL
                   AND v_po_line.item_uom_term_id IS NOT NULL
                   AND v_po_line.po_uom_term_id <> v_po_line.item_uom_term_id THEN
                    BEGIN
                        v_factor := inventory.convert_uom(
                            v_tenant_id, 1,
                            v_po_line.po_uom_term_id, v_po_line.item_uom_term_id
                        );
                        v_uom_factors := jsonb_set(
                            v_uom_factors, ARRAY[v_line.po_line_id::text], to_jsonb(v_factor)
                        );
                        v_uom_converted_lines := v_uom_converted_lines || jsonb_build_object(
                            'line_number', v_line.line_number,
                            'item_name', v_po_line.item_name,
                            'received_uom_term_id', v_po_line.po_uom_term_id,
                            'item_uom_term_id', v_po_line.item_uom_term_id,
                            'conversion_factor', v_factor,
                            'qty_received', v_line.qty_received,
                            'qty_posted', v_line.qty_received * v_factor
                        );
                    EXCEPTION WHEN OTHERS THEN
                        -- no conversion path — fall through to the policy
                        IF v_uom_mismatch_policy <> 'off' THEN
                            v_uom_mismatch_lines := v_uom_mismatch_lines || jsonb_build_object(
                                'line_number', v_line.line_number,
                                'item_name', v_po_line.item_name,
                                'received_uom_term_id', v_po_line.po_uom_term_id,
                                'item_uom_term_id', v_po_line.item_uom_term_id
                            );
                        END IF;
                    END;
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

        IF jsonb_array_length(v_uom_mismatch_lines) > 0 AND v_uom_mismatch_policy = 'block' THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', jsonb_build_object(
                    'code', 'UOM_MISMATCH_BLOCKED',
                    'message', format(
                        '%s line(s) are being received in a unit that differs from the item''s stocking unit and has no configured conversion.',
                        jsonb_array_length(v_uom_mismatch_lines)
                    ),
                    'details', jsonb_build_object(
                        'receipt_id', p_receipt_id,
                        'receipt_number', v_receipt.receipt_number,
                        'uom_mismatch_lines', v_uom_mismatch_lines
                    ),
                    'action', 'Add a UOM conversion in Settings, match the purchase unit to the stocking unit, or change the UOM mismatch policy.'
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

        -- Converted lines post qty * factor (stocking unit); everything else 1:1.
        v_factor := COALESCE((v_uom_factors ->> COALESCE(v_line.po_line_id::text, ''))::numeric, 1);
        v_qty_posted := v_line.qty_received * v_factor;
        v_unit_cost := COALESCE(v_line.unit_cost_actual, (
            SELECT unit_cost FROM supply_chain.purchase_order_lines
            WHERE id = v_line.po_line_id
        ));
        IF v_factor <> 1 AND v_unit_cost IS NOT NULL THEN
            -- cost was per purchase unit; convert to per stocking unit
            v_unit_cost := v_unit_cost / v_factor;
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
                'quantity_delta', v_qty_posted,
                'qty_received', v_line.qty_received,
                'uom_conversion_factor', CASE WHEN v_factor <> 1 THEN v_factor ELSE NULL END,
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
            v_qty_posted, v_movement_type, 'receipt', p_receipt_id,
            v_unit_cost,
            'USD',
            CASE
                WHEN v_line.condition_status = 'damaged' THEN 'Received as DAMAGED - ' || COALESCE(v_line.notes, '')
                WHEN v_line.condition_status = 'quarantine' THEN 'Received in QUARANTINE - ' || COALESCE(v_line.notes, '')
                ELSE 'Posted from receipt ' || v_receipt.receipt_number
            END || CASE
                WHEN v_factor <> 1 THEN format(' (converted x%s to stocking unit)', v_factor)
                ELSE ''
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
            -- PO progress stays in PO (purchase) units — do NOT convert here.
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

    IF jsonb_array_length(v_uom_mismatch_lines) > 0 AND v_uom_mismatch_policy = 'warn' THEN
        PERFORM inventory.log_guardrail_exception(
            v_tenant_id,
            COALESCE(p_actor_user_id, v_receipt.received_by_user_id),
            'receipt',
            p_receipt_id,
            'uom_mismatch',
            COALESCE(NULLIF(trim(p_override_reason), ''), 'Received in a unit different from the item stocking unit (no conversion configured)'),
            jsonb_build_object(
                'receipt_number', v_receipt.receipt_number,
                'po_id', v_receipt.po_id,
                'uom_mismatch_lines', v_uom_mismatch_lines
            )
        );
    END IF;

    IF jsonb_array_length(v_uom_converted_lines) > 0 THEN
        PERFORM inventory.log_guardrail_exception(
            v_tenant_id,
            COALESCE(p_actor_user_id, v_receipt.received_by_user_id),
            'receipt',
            p_receipt_id,
            'uom_converted',
            'Received quantities auto-converted to the item stocking unit',
            jsonb_build_object(
                'receipt_number', v_receipt.receipt_number,
                'po_id', v_receipt.po_id,
                'uom_converted_lines', v_uom_converted_lines
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
        'uom_converted_lines', v_uom_converted_lines,
        'message', format('Posted %s lines, rejected %s, damaged %s, skipped %s',
            v_posted_count, v_rejected_count, v_damaged_count, v_skipped_count)
    );

    RETURN v_result;

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to post receipt % to inventory: %', p_receipt_id, SQLERRM;
END;
$$;
