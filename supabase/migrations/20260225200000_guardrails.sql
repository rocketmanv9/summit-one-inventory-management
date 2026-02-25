-- ============================================================
-- Migration: Operational Guardrails
-- Purpose: Prevent unit mistakes, negative inventory (configurable),
--          over-receipt, and provide auditable exception handling
-- ============================================================

-- ============================================================
-- 1. FIX: Drop stock_balances CHECK constraint
--    The CHECK (qty_on_hand >= 0) prevents negative inventory
--    even when negative_inventory_config allows it.
--    The maintain_stock_balances trigger handles enforcement.
-- ============================================================

ALTER TABLE inventory.stock_balances
    DROP CONSTRAINT IF EXISTS stock_balances_qty_on_hand_check;


-- ============================================================
-- 2. Guardrail Policies (tenant-scoped configuration)
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory.guardrail_policies (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               uuid NOT NULL REFERENCES public.tenants(id),
    over_receipt_policy      text NOT NULL DEFAULT 'block'
                            CHECK (over_receipt_policy IN ('block', 'allow_with_audit')),
    over_receipt_threshold_pct numeric(5,2) NOT NULL DEFAULT 0
                            CHECK (over_receipt_threshold_pct >= 0),
    uom_mismatch_policy      text NOT NULL DEFAULT 'warn'
                            CHECK (uom_mismatch_policy IN ('block', 'warn', 'off')),
    require_override_reason  boolean NOT NULL DEFAULT true,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    last_event_id           text NOT NULL DEFAULT gen_random_uuid()::text,
    CONSTRAINT guardrail_policies_tenant_unique UNIQUE (tenant_id),
    CONSTRAINT guardrail_policies_event_unique UNIQUE (last_event_id)
);

COMMENT ON TABLE inventory.guardrail_policies IS
    'Tenant-scoped guardrail configuration. Controls over-receipt and UOM validation behavior.
     Negative inventory rules are in negative_inventory_config (item/category/global granularity).';

COMMENT ON COLUMN inventory.guardrail_policies.over_receipt_policy IS
    'block = reject receipt lines exceeding PO open qty. allow_with_audit = allow but log exception.';

COMMENT ON COLUMN inventory.guardrail_policies.over_receipt_threshold_pct IS
    'Percentage tolerance above PO open qty before the over_receipt_policy kicks in. 0 = exact match.';

COMMENT ON COLUMN inventory.guardrail_policies.uom_mismatch_policy IS
    'block = reject if no UOM conversion exists. warn = allow but log. off = no check.';

CREATE INDEX idx_guardrail_policies_tenant
    ON inventory.guardrail_policies (tenant_id);

ALTER TABLE inventory.guardrail_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guardrail_policies_service_role ON inventory.guardrail_policies;
CREATE POLICY guardrail_policies_service_role
    ON inventory.guardrail_policies TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS guardrail_policies_tenant_read ON inventory.guardrail_policies;
CREATE POLICY guardrail_policies_tenant_read
    ON inventory.guardrail_policies FOR SELECT TO authenticated
    USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS guardrail_policies_tenant_write ON inventory.guardrail_policies;
CREATE POLICY guardrail_policies_tenant_write
    ON inventory.guardrail_policies FOR ALL TO authenticated
    USING (tenant_id = public.current_tenant_id())
    WITH CHECK (tenant_id = public.current_tenant_id());


-- ============================================================
-- 3. Guardrail Exceptions (audit trail for overrides)
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory.guardrail_exceptions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL,
    actor_user_id   uuid,
    context_type    text NOT NULL
                    CHECK (context_type IN ('adjustment', 'transfer', 'receipt', 'reservation_fulfill')),
    context_id      uuid NOT NULL,
    rule            text NOT NULL
                    CHECK (rule IN ('negative_inventory', 'over_receipt', 'uom_mismatch')),
    override_reason text NOT NULL,
    metadata        jsonb NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_event_id   text NOT NULL DEFAULT gen_random_uuid()::text,
    CONSTRAINT guardrail_exceptions_event_unique UNIQUE (last_event_id),
    CONSTRAINT guardrail_exceptions_context_unique UNIQUE (tenant_id, context_type, context_id, rule)
);

COMMENT ON TABLE inventory.guardrail_exceptions IS
    'Audit trail for guardrail overrides. One row per override per mutation. Idempotent via context_unique.';

CREATE INDEX idx_guardrail_exceptions_tenant_date
    ON inventory.guardrail_exceptions (tenant_id, created_at DESC);

CREATE INDEX idx_guardrail_exceptions_context
    ON inventory.guardrail_exceptions (tenant_id, context_type, context_id);

ALTER TABLE inventory.guardrail_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guardrail_exceptions_service_role ON inventory.guardrail_exceptions;
CREATE POLICY guardrail_exceptions_service_role
    ON inventory.guardrail_exceptions TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS guardrail_exceptions_tenant_read ON inventory.guardrail_exceptions;
CREATE POLICY guardrail_exceptions_tenant_read
    ON inventory.guardrail_exceptions FOR SELECT TO authenticated
    USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS guardrail_exceptions_tenant_insert ON inventory.guardrail_exceptions;
CREATE POLICY guardrail_exceptions_tenant_insert
    ON inventory.guardrail_exceptions FOR INSERT TO authenticated
    WITH CHECK (tenant_id = public.current_tenant_id());


-- ============================================================
-- 4. Helper: Get guardrail policies with defaults
-- ============================================================

CREATE OR REPLACE FUNCTION inventory.get_guardrail_policies(p_tenant_id uuid)
RETURNS TABLE (
    over_receipt_policy text,
    over_receipt_threshold_pct numeric,
    uom_mismatch_policy text,
    require_override_reason boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'inventory', 'public'
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(gp.over_receipt_policy, 'block'),
        COALESCE(gp.over_receipt_threshold_pct, 0::numeric),
        COALESCE(gp.uom_mismatch_policy, 'warn'),
        COALESCE(gp.require_override_reason, true)
    FROM (SELECT 1) AS dummy
    LEFT JOIN inventory.guardrail_policies gp
        ON gp.tenant_id = p_tenant_id;
END;
$$;


-- ============================================================
-- 5. Helper: Log guardrail exception (idempotent)
-- ============================================================

CREATE OR REPLACE FUNCTION inventory.log_guardrail_exception(
    p_tenant_id       uuid,
    p_actor_user_id   uuid,
    p_context_type    text,
    p_context_id      uuid,
    p_rule            text,
    p_override_reason text,
    p_metadata        jsonb DEFAULT '{}'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'inventory', 'public'
AS $$
DECLARE
    v_exception_id uuid;
BEGIN
    INSERT INTO inventory.guardrail_exceptions (
        tenant_id, actor_user_id, context_type, context_id,
        rule, override_reason, metadata, last_event_id
    ) VALUES (
        p_tenant_id, p_actor_user_id, p_context_type, p_context_id,
        p_rule, p_override_reason, p_metadata,
        'guardrail-' || p_context_type || '-' || p_context_id::text || '-' || p_rule
    )
    ON CONFLICT (tenant_id, context_type, context_id, rule) DO NOTHING
    RETURNING id INTO v_exception_id;

    RETURN v_exception_id;
END;
$$;


-- ============================================================
-- 6. Update rpc_adjust_inventory with negative inventory guard
-- ============================================================

DROP FUNCTION IF EXISTS inventory.rpc_adjust_inventory(uuid, uuid, numeric, text, text);

CREATE OR REPLACE FUNCTION inventory.rpc_adjust_inventory(
    p_location_id      uuid,
    p_catalog_item_id  uuid,
    p_new_qty          numeric,
    p_reason           text,
    p_notes            text,
    p_override_reason  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'inventory', 'public'
AS $$
DECLARE
    v_tenant_id uuid;
    v_user_id uuid;
    v_current_qty numeric;
    v_delta numeric;
    v_event_id text;
    v_negative_allowed boolean;
    v_require_reason boolean;
    v_item_name text;
    v_location_name text;
    v_movement_id uuid;
BEGIN
    v_tenant_id := current_tenant_id();
    v_user_id := (auth.jwt() ->> 'user_id')::uuid;
    IF v_user_id IS NULL THEN
        v_user_id := auth.uid();
    END IF;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RAISE EXCEPTION 'Reason required for inventory adjustment';
    END IF;

    -- Get current quantity
    SELECT COALESCE(sb.qty_on_hand, 0)
    INTO v_current_qty
    FROM inventory.stock_balances sb
    WHERE sb.tenant_id = v_tenant_id
      AND sb.catalog_item_id = p_catalog_item_id
      AND sb.location_id = p_location_id;

    IF v_current_qty IS NULL THEN
        v_current_qty := 0;
    END IF;

    v_delta := p_new_qty - v_current_qty;

    IF v_delta = 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'No adjustment needed (quantity unchanged)',
            'current_qty', v_current_qty,
            'new_qty', p_new_qty,
            'delta', 0
        );
    END IF;

    -- GUARDRAIL: Negative inventory check
    IF p_new_qty < 0 THEN
        -- Look up item and location names for error messaging
        SELECT name INTO v_item_name
        FROM inventory.catalog_items
        WHERE id = p_catalog_item_id AND tenant_id = v_tenant_id;

        SELECT name INTO v_location_name
        FROM inventory.locations
        WHERE id = p_location_id AND tenant_id = v_tenant_id;

        v_negative_allowed := inventory.check_negative_allowed(v_tenant_id, p_catalog_item_id);

        IF NOT v_negative_allowed THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', jsonb_build_object(
                    'code', 'NEGATIVE_INVENTORY_BLOCKED',
                    'message', format(
                        'This adjustment would make %s stock at %s negative (%s).',
                        COALESCE(v_item_name, 'item'),
                        COALESCE(v_location_name, 'location'),
                        p_new_qty
                    ),
                    'details', jsonb_build_object(
                        'current_qty', v_current_qty,
                        'attempted_qty', p_new_qty,
                        'delta', v_delta,
                        'item_name', v_item_name,
                        'location_name', v_location_name,
                        'catalog_item_id', p_catalog_item_id,
                        'location_id', p_location_id
                    ),
                    'action', 'Enable negative inventory for this item in Settings, or adjust to a non-negative quantity.'
                )
            );
        END IF;

        -- Negative is allowed - check if override_reason is required
        SELECT COALESCE(gp.require_override_reason, true)
        INTO v_require_reason
        FROM (SELECT 1) AS dummy
        LEFT JOIN inventory.guardrail_policies gp ON gp.tenant_id = v_tenant_id;

        IF v_require_reason AND (p_override_reason IS NULL OR trim(p_override_reason) = '') THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', jsonb_build_object(
                    'code', 'OVERRIDE_REASON_REQUIRED',
                    'message', 'An override reason is required to allow negative inventory.',
                    'details', jsonb_build_object(
                        'current_qty', v_current_qty,
                        'attempted_qty', p_new_qty,
                        'delta', v_delta,
                        'item_name', v_item_name,
                        'location_name', v_location_name
                    ),
                    'action', 'Provide an override reason explaining why negative inventory is acceptable.'
                )
            );
        END IF;
    END IF;

    v_event_id := 'adjust-' || gen_random_uuid()::text || '-' || extract(epoch from now())::text;

    -- Insert inventory event
    INSERT INTO inventory.inventory_events (
        tenant_id, event_type, occurred_at, actor_user_id,
        last_event_id, payload
    ) VALUES (
        v_tenant_id, 'adjust', now(), v_user_id, v_event_id,
        jsonb_build_object(
            'catalog_item_id', p_catalog_item_id,
            'location_id', p_location_id,
            'reason', p_reason,
            'old_qty', v_current_qty,
            'new_qty', p_new_qty,
            'notes', p_notes,
            'override_reason', p_override_reason
        )
    );

    -- Insert stock movement
    INSERT INTO inventory.stock_movements (
        tenant_id, catalog_item_id, location_id, quantity_delta,
        movement_type, reason, notes, occurred_at,
        created_by_user_id, last_event_id
    ) VALUES (
        v_tenant_id, p_catalog_item_id, p_location_id, v_delta,
        'adjusted', p_reason, p_notes, now(), v_user_id, v_event_id
    );

    -- Log guardrail exception if negative override was used
    IF p_new_qty < 0 AND p_override_reason IS NOT NULL THEN
        PERFORM inventory.log_guardrail_exception(
            v_tenant_id, v_user_id, 'adjustment',
            p_catalog_item_id,  -- context_id = the item being adjusted
            'negative_inventory',
            p_override_reason,
            jsonb_build_object(
                'location_id', p_location_id,
                'old_qty', v_current_qty,
                'new_qty', p_new_qty,
                'delta', v_delta,
                'event_id', v_event_id
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'current_qty', v_current_qty,
        'new_qty', p_new_qty,
        'delta', v_delta,
        'override_logged', (p_new_qty < 0 AND p_override_reason IS NOT NULL)
    );
END;
$$;

ALTER FUNCTION inventory.rpc_adjust_inventory(uuid, uuid, numeric, text, text, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION inventory.rpc_adjust_inventory(uuid, uuid, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION inventory.rpc_adjust_inventory(uuid, uuid, numeric, text, text, text) TO service_role;

COMMENT ON FUNCTION inventory.rpc_adjust_inventory IS
    'Adjust inventory to a target quantity. Enforces negative inventory guardrails.
     Returns structured error (success=false) when blocked.
     p_override_reason required when adjusting to negative and negative is allowed.';


-- ============================================================
-- 7. Update rpc_post_receipt_to_inventory_v2 with over-receipt guard
-- ============================================================

DROP FUNCTION IF EXISTS supply_chain.rpc_post_receipt_to_inventory_v2(uuid, uuid);

CREATE OR REPLACE FUNCTION supply_chain.rpc_post_receipt_to_inventory_v2(
    p_receipt_id       uuid,
    p_actor_user_id    uuid DEFAULT NULL,
    p_override_reason  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
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
    -- Over-receipt guardrail vars
    v_over_receipt_policy TEXT := 'block';
    v_over_receipt_threshold_pct NUMERIC := 0;
    v_require_reason BOOLEAN := true;
    v_po_line RECORD;
    v_open_qty NUMERIC;
    v_max_allowed NUMERIC;
    v_over_receipt_lines JSONB := '[]'::jsonb;
BEGIN
    -- Get tenant from JWT
    v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'No tenant_id in JWT. Authentication required.';
    END IF;

    -- Load guardrail policies
    SELECT
        COALESCE(gp.over_receipt_policy, 'block'),
        COALESCE(gp.over_receipt_threshold_pct, 0::numeric),
        COALESCE(gp.require_override_reason, true)
    INTO v_over_receipt_policy, v_over_receipt_threshold_pct, v_require_reason
    FROM (SELECT 1) AS dummy
    LEFT JOIN inventory.guardrail_policies gp ON gp.tenant_id = v_tenant_id;

    -- Fetch receipt header
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

    -- Idempotency: already posted
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

    -- Validate location
    SELECT * INTO v_location
    FROM inventory.locations
    WHERE id = v_receipt.location_id
      AND tenant_id = v_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Location % not found in inventory schema', v_receipt.location_id;
    END IF;

    -- ========================================================
    -- GUARDRAIL: Pre-check over-receipt for ALL PO-linked lines
    -- ========================================================
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
            SELECT pol.qty_ordered, pol.qty_received, ci.name AS item_name
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
            END IF;
        END LOOP;

        -- If there are over-receipt lines, enforce policy
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

            -- allow_with_audit: require override reason
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
    END IF;

    -- ========================================================
    -- Process each receipt line (same logic as before)
    -- ========================================================
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

        -- Handle condition_status
        CASE v_line.condition_status
            WHEN 'rejected' THEN
                INSERT INTO inventory.inventory_events (
                    tenant_id, catalog_item_id, location_id, event_type,
                    quantity_delta, payload, correlation_id, occurred_at,
                    actor_user_id, last_event_id
                ) VALUES (
                    v_tenant_id, v_line.catalog_item_id,
                    COALESCE(v_line.destination_location_id, v_receipt.location_id),
                    'rejected', 0,
                    jsonb_build_object(
                        'receipt_id', p_receipt_id,
                        'receipt_number', v_receipt.receipt_number,
                        'receipt_line_id', v_line.id,
                        'line_number', v_line.line_number,
                        'qty_received', v_line.qty_received,
                        'condition', 'rejected',
                        'reason', 'Items rejected during receiving'
                    ),
                    p_receipt_id, v_receipt.received_at,
                    COALESCE(p_actor_user_id, v_receipt.created_by_user_id),
                    v_event_id
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

        -- Insert inventory event
        INSERT INTO inventory.inventory_events (
            tenant_id, catalog_item_id, location_id, event_type,
            quantity_delta, payload, correlation_id, occurred_at,
            actor_user_id, last_event_id
        ) VALUES (
            v_tenant_id, v_line.catalog_item_id,
            COALESCE(v_line.destination_location_id, v_receipt.location_id),
            v_movement_type, v_line.qty_received,
            jsonb_build_object(
                'receipt_id', p_receipt_id,
                'receipt_number', v_receipt.receipt_number,
                'receipt_line_id', v_line.id,
                'line_number', v_line.line_number,
                'po_id', v_receipt.po_id,
                'po_line_id', v_line.po_line_id,
                'condition_status', v_line.condition_status,
                'unit_cost_actual', v_line.unit_cost_actual
            ),
            p_receipt_id, v_receipt.received_at,
            COALESCE(p_actor_user_id, v_receipt.created_by_user_id),
            v_event_id
        )
        ON CONFLICT (tenant_id, last_event_id) DO NOTHING;

        -- Insert stock movement
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
            COALESCE(p_actor_user_id, v_receipt.created_by_user_id),
            v_event_id
        )
        ON CONFLICT (tenant_id, last_event_id) DO NOTHING
        RETURNING id INTO v_movement_id;

        IF v_movement_id IS NULL THEN
            v_skipped_count := v_skipped_count + 1;
            CONTINUE;
        END IF;

        -- Update PO line status
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
                updated_by = COALESCE(p_actor_user_id, v_receipt.created_by_user_id)
            WHERE id = v_line.po_line_id
              AND tenant_id = v_tenant_id;
        END IF;

        v_posted_count := v_posted_count + 1;
    END LOOP;

    -- Update PO header status
    IF v_receipt.po_id IS NOT NULL THEN
        UPDATE supply_chain.purchase_orders po
        SET status = (
            SELECT CASE
                WHEN COUNT(*) = COUNT(*) FILTER (WHERE pol.status = 'fully_received') THEN 'fully_received'
                WHEN COUNT(*) FILTER (WHERE pol.status IN ('fully_received', 'partially_received')) > 0 THEN 'partially_received'
                ELSE status
            END
            FROM supply_chain.purchase_order_lines pol
            WHERE pol.po_id = po.id
              AND pol.tenant_id = po.tenant_id
        ),
        updated_at = NOW(),
        updated_by = COALESCE(p_actor_user_id, v_receipt.created_by_user_id)
        WHERE id = v_receipt.po_id
          AND tenant_id = v_tenant_id;
    END IF;

    -- Update receipt status
    UPDATE supply_chain.receipts
    SET
        status = 'confirmed',
        updated_at = NOW(),
        updated_by = COALESCE(p_actor_user_id, v_receipt.created_by_user_id)
    WHERE id = p_receipt_id
      AND tenant_id = v_tenant_id;

    -- Log over-receipt exceptions
    IF jsonb_array_length(v_over_receipt_lines) > 0 AND p_override_reason IS NOT NULL THEN
        PERFORM inventory.log_guardrail_exception(
            v_tenant_id,
            COALESCE(p_actor_user_id, v_receipt.created_by_user_id),
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

    -- Build result
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
        'message', format('Posted %s lines, rejected %s, damaged %s, skipped %s',
            v_posted_count, v_rejected_count, v_damaged_count, v_skipped_count)
    );

    RETURN v_result;

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to post receipt % to inventory: %', p_receipt_id, SQLERRM;
END;
$$;

ALTER FUNCTION supply_chain.rpc_post_receipt_to_inventory_v2(uuid, uuid, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION supply_chain.rpc_post_receipt_to_inventory_v2(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION supply_chain.rpc_post_receipt_to_inventory_v2(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION supply_chain.rpc_post_receipt_to_inventory_v2 IS
    'Enhanced atomic receipt posting with over-receipt guardrail.
     Checks each PO-linked line against open qty + threshold.
     policy=block returns structured error. policy=allow_with_audit requires override_reason.';


-- ============================================================
-- 8. Update rpc_inv_transfer_execute with negative inventory guard
-- ============================================================

DROP FUNCTION IF EXISTS inventory.rpc_inv_transfer_execute(uuid, uuid, uuid, text);

CREATE OR REPLACE FUNCTION inventory.rpc_inv_transfer_execute(
    p_tenant_id          uuid,
    p_transfer_id        uuid,
    p_received_by_user_id uuid,
    p_last_event_id      text DEFAULT NULL,
    p_override_reason    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'inventory', 'public'
AS $$
DECLARE
    v_transfer record;
    v_line record;
    v_correlation_id uuid;
    v_event_id text;
    v_now timestamptz := now();
    v_current_qty numeric;
    v_negative_allowed boolean;
    v_require_reason boolean;
    v_item_name text;
    v_from_location_name text;
    v_blocked_lines jsonb := '[]'::jsonb;
BEGIN
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required';
    END IF;
    v_event_id := p_last_event_id;

    SELECT * INTO v_transfer
    FROM inventory.transfers
    WHERE id = p_transfer_id
      AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer not found';
    END IF;

    IF v_transfer.status NOT IN ('draft', 'in_transit') THEN
        RAISE EXCEPTION 'Transfer cannot be executed in status: %', v_transfer.status;
    END IF;

    -- Get source location name
    SELECT name INTO v_from_location_name
    FROM inventory.locations
    WHERE id = v_transfer.from_location_id AND tenant_id = p_tenant_id;

    -- GUARDRAIL: Pre-check all lines for negative inventory
    FOR v_line IN
        SELECT tl.*, ci.name AS item_name, ci.tracking_mode
        FROM inventory.transfer_lines tl
        JOIN inventory.catalog_items ci ON ci.id = tl.catalog_item_id AND ci.tenant_id = tl.tenant_id
        WHERE tl.transfer_id = p_transfer_id
        ORDER BY tl.line_number
    LOOP
        -- Skip serialized items (handled differently)
        IF v_line.tracking_mode IN ('serialized', 'both', 'hybrid') THEN
            CONTINUE;
        END IF;

        SELECT COALESCE(sb.qty_on_hand, 0)
        INTO v_current_qty
        FROM inventory.stock_balances sb
        WHERE sb.tenant_id = p_tenant_id
          AND sb.catalog_item_id = v_line.catalog_item_id
          AND sb.location_id = v_transfer.from_location_id;

        IF v_current_qty IS NULL THEN
            v_current_qty := 0;
        END IF;

        IF v_current_qty - v_line.qty < 0 THEN
            v_negative_allowed := inventory.check_negative_allowed(p_tenant_id, v_line.catalog_item_id);

            IF NOT v_negative_allowed THEN
                v_blocked_lines := v_blocked_lines || jsonb_build_object(
                    'line_number', v_line.line_number,
                    'item_name', v_line.item_name,
                    'catalog_item_id', v_line.catalog_item_id,
                    'current_qty', v_current_qty,
                    'transfer_qty', v_line.qty,
                    'projected_qty', v_current_qty - v_line.qty
                );
            END IF;
        END IF;
    END LOOP;

    -- If any lines would go negative and aren't allowed
    IF jsonb_array_length(v_blocked_lines) > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object(
                'code', 'NEGATIVE_INVENTORY_BLOCKED',
                'message', format(
                    'Transfer would make %s item(s) negative at %s.',
                    jsonb_array_length(v_blocked_lines),
                    COALESCE(v_from_location_name, 'source location')
                ),
                'details', jsonb_build_object(
                    'transfer_id', p_transfer_id,
                    'transfer_number', v_transfer.transfer_number,
                    'from_location', v_from_location_name,
                    'blocked_lines', v_blocked_lines
                ),
                'action', 'Reduce transfer quantities or enable negative inventory for these items.'
            )
        );
    END IF;

    -- Check if any lines WILL go negative (but are allowed) and need override
    DECLARE
        v_needs_override boolean := false;
    BEGIN
        FOR v_line IN
            SELECT tl.*, ci.tracking_mode
            FROM inventory.transfer_lines tl
            JOIN inventory.catalog_items ci ON ci.id = tl.catalog_item_id AND ci.tenant_id = tl.tenant_id
            WHERE tl.transfer_id = p_transfer_id
            ORDER BY tl.line_number
        LOOP
            IF v_line.tracking_mode IN ('serialized', 'both', 'hybrid') THEN
                CONTINUE;
            END IF;

            SELECT COALESCE(sb.qty_on_hand, 0) INTO v_current_qty
            FROM inventory.stock_balances sb
            WHERE sb.tenant_id = p_tenant_id
              AND sb.catalog_item_id = v_line.catalog_item_id
              AND sb.location_id = v_transfer.from_location_id;

            IF COALESCE(v_current_qty, 0) - v_line.qty < 0 THEN
                v_needs_override := true;
                EXIT;
            END IF;
        END LOOP;

        IF v_needs_override THEN
            SELECT COALESCE(gp.require_override_reason, true)
            INTO v_require_reason
            FROM (SELECT 1) AS dummy
            LEFT JOIN inventory.guardrail_policies gp ON gp.tenant_id = p_tenant_id;

            IF v_require_reason AND (p_override_reason IS NULL OR trim(p_override_reason) = '') THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', jsonb_build_object(
                        'code', 'OVERRIDE_REASON_REQUIRED',
                        'message', 'An override reason is required because this transfer will result in negative inventory.',
                        'details', jsonb_build_object(
                            'transfer_id', p_transfer_id,
                            'from_location', v_from_location_name
                        ),
                        'action', 'Provide an override reason explaining why negative inventory is acceptable.'
                    )
                );
            END IF;
        END IF;
    END;

    -- Execute the transfer (same logic as original)
    v_correlation_id := gen_random_uuid();

    FOR v_line IN
        SELECT tl.*, ci.tracking_mode
        FROM inventory.transfer_lines tl
        JOIN inventory.catalog_items ci ON ci.id = tl.catalog_item_id AND ci.tenant_id = tl.tenant_id
        WHERE tl.transfer_id = p_transfer_id
        ORDER BY tl.line_number
    LOOP
        IF v_line.tracking_mode IN ('serialized', 'both', 'hybrid') THEN
            CONTINUE;
        END IF;

        PERFORM inventory.insert_stock_movement(
            p_tenant_id => p_tenant_id,
            p_catalog_item_id => v_line.catalog_item_id,
            p_location_id => v_transfer.from_location_id,
            p_quantity_delta => -v_line.qty,
            p_movement_type => 'transferred_out',
            p_source_ref_type => 'transfer',
            p_source_ref_id => p_transfer_id,
            p_unit_cost => NULL,
            p_reason => 'Transfer to ' || (SELECT name FROM inventory.locations WHERE id = v_transfer.to_location_id),
            p_notes => 'Transfer #' || v_transfer.transfer_number,
            p_correlation_id => v_correlation_id,
            p_occurred_at => v_now,
            p_created_by_user_id => p_received_by_user_id,
            p_last_event_id => v_event_id || '_out_' || v_line.line_number
        );

        PERFORM inventory.insert_stock_movement(
            p_tenant_id => p_tenant_id,
            p_catalog_item_id => v_line.catalog_item_id,
            p_location_id => v_transfer.to_location_id,
            p_quantity_delta => v_line.qty,
            p_movement_type => 'transferred_in',
            p_source_ref_type => 'transfer',
            p_source_ref_id => p_transfer_id,
            p_unit_cost => NULL,
            p_reason => 'Transfer from ' || (SELECT name FROM inventory.locations WHERE id = v_transfer.from_location_id),
            p_notes => 'Transfer #' || v_transfer.transfer_number,
            p_correlation_id => v_correlation_id,
            p_occurred_at => v_now,
            p_created_by_user_id => p_received_by_user_id,
            p_last_event_id => v_event_id || '_in_' || v_line.line_number
        );
    END LOOP;

    -- Update asset locations
    UPDATE inventory.assets a
    SET location_id = v_transfer.to_location_id, updated_at = v_now
    FROM inventory.transfer_assets ta
    WHERE ta.transfer_id = p_transfer_id
      AND ta.tenant_id = p_tenant_id
      AND a.id = ta.asset_id
      AND a.tenant_id = p_tenant_id;

    -- Mark transfer as completed
    UPDATE inventory.transfers
    SET status = 'completed',
        received_by_user_id = p_received_by_user_id,
        completed_at = v_now,
        updated_at = v_now
    WHERE id = p_transfer_id;

    -- Log guardrail exception if negative override
    IF p_override_reason IS NOT NULL THEN
        PERFORM inventory.log_guardrail_exception(
            p_tenant_id, p_received_by_user_id, 'transfer',
            p_transfer_id, 'negative_inventory', p_override_reason,
            jsonb_build_object(
                'transfer_number', v_transfer.transfer_number,
                'from_location_id', v_transfer.from_location_id,
                'to_location_id', v_transfer.to_location_id
            )
        );
    END IF;

    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'transfer.completed',
        p_aggregate_type => 'transfer',
        p_aggregate_id => p_transfer_id,
        p_payload => jsonb_build_object(
            'transfer_id', p_transfer_id,
            'transfer_number', v_transfer.transfer_number,
            'from_location_id', v_transfer.from_location_id,
            'to_location_id', v_transfer.to_location_id,
            'correlation_id', v_correlation_id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'transfer_id', p_transfer_id,
        'transfer_number', v_transfer.transfer_number,
        'override_logged', (p_override_reason IS NOT NULL)
    );
END;
$$;

ALTER FUNCTION inventory.rpc_inv_transfer_execute(uuid, uuid, uuid, text, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION inventory.rpc_inv_transfer_execute(uuid, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION inventory.rpc_inv_transfer_execute(uuid, uuid, uuid, text, text) TO service_role;

COMMENT ON FUNCTION inventory.rpc_inv_transfer_execute IS
    'Execute transfer with negative inventory guardrail.
     Returns jsonb (changed from boolean). success=false with structured error when blocked.
     p_override_reason required when transfer would go negative and negative is allowed.';


-- ============================================================
-- 9. Event catalog entries
-- ============================================================

INSERT INTO public.event_catalog (event_key, event_name, description, schema_name, entity_name, version)
VALUES
    ('inventory.guardrail_policy.updated', 'Guardrail Policy Updated', 'Tenant guardrail policy was updated', 'inventory', 'guardrail_policy', 1),
    ('inventory.guardrail_exception.created', 'Guardrail Exception Created', 'A guardrail override exception was logged', 'inventory', 'guardrail_exception', 1)
ON CONFLICT (event_key) DO NOTHING;


-- ============================================================
-- 10. Event emission triggers
-- ============================================================

CREATE OR REPLACE FUNCTION inventory.emit_guardrail_policy_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'inventory', 'public'
AS $$
DECLARE
    v_tenant_id uuid;
    v_event_name text;
    v_payload jsonb;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_tenant_id := OLD.tenant_id;
        v_event_name := 'inventory.guardrail_policy.updated';
        v_payload := jsonb_build_object('policy_id', OLD.id, 'action', 'deleted');
    ELSE
        v_tenant_id := NEW.tenant_id;
        v_event_name := 'inventory.guardrail_policy.updated';
        v_payload := jsonb_build_object(
            'policy_id', NEW.id,
            'over_receipt_policy', NEW.over_receipt_policy,
            'uom_mismatch_policy', NEW.uom_mismatch_policy,
            'require_override_reason', NEW.require_override_reason,
            'action', CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END
        );
    END IF;

    INSERT INTO public.events_outbox (
        tenant_id, event_name, payload, status
    ) VALUES (
        v_tenant_id, v_event_name, v_payload, 'pending'
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trigger_guardrail_policy_events ON inventory.guardrail_policies;
CREATE TRIGGER trigger_guardrail_policy_events
    AFTER INSERT OR UPDATE OR DELETE ON inventory.guardrail_policies
    FOR EACH ROW EXECUTE FUNCTION inventory.emit_guardrail_policy_event();


CREATE OR REPLACE FUNCTION inventory.emit_guardrail_exception_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'inventory', 'public'
AS $$
BEGIN
    INSERT INTO public.events_outbox (
        tenant_id, event_name, payload, status
    ) VALUES (
        NEW.tenant_id,
        'inventory.guardrail_exception.created',
        jsonb_build_object(
            'exception_id', NEW.id,
            'context_type', NEW.context_type,
            'context_id', NEW.context_id,
            'rule', NEW.rule,
            'actor_user_id', NEW.actor_user_id,
            'override_reason', NEW.override_reason
        ),
        'pending'
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_guardrail_exception_events ON inventory.guardrail_exceptions;
CREATE TRIGGER trigger_guardrail_exception_events
    AFTER INSERT ON inventory.guardrail_exceptions
    FOR EACH ROW EXECUTE FUNCTION inventory.emit_guardrail_exception_event();


-- ============================================================
-- 11. Auto-inject tenant_id triggers on new tables
-- ============================================================

DROP TRIGGER IF EXISTS auto_inject_tenant_guardrail_policies ON inventory.guardrail_policies;
CREATE TRIGGER auto_inject_tenant_guardrail_policies
    BEFORE INSERT ON inventory.guardrail_policies
    FOR EACH ROW EXECUTE FUNCTION inventory.auto_inject_tenant_id();

DROP TRIGGER IF EXISTS auto_inject_tenant_guardrail_exceptions ON inventory.guardrail_exceptions;
CREATE TRIGGER auto_inject_tenant_guardrail_exceptions
    BEFORE INSERT ON inventory.guardrail_exceptions
    FOR EACH ROW EXECUTE FUNCTION inventory.auto_inject_tenant_id();


-- ============================================================
-- 12. Grants
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON inventory.guardrail_policies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory.guardrail_policies TO service_role;

GRANT SELECT, INSERT ON inventory.guardrail_exceptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory.guardrail_exceptions TO service_role;

GRANT EXECUTE ON FUNCTION inventory.get_guardrail_policies(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION inventory.get_guardrail_policies(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION inventory.log_guardrail_exception(uuid, uuid, text, uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION inventory.log_guardrail_exception(uuid, uuid, text, uuid, text, text, jsonb) TO service_role;
