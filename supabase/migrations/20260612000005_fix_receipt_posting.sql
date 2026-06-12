-- Receiving a PO created the receipt but never updated stock or the PO
-- status. Seven compounding bugs (each was hiding the next behind the
-- swallowed-error pattern):
--
-- 1. Both posting RPCs read the tenant from auth.jwt()->>'tenant_id' (root
--    claim only), but app JWTs carry it in app_metadata — so posting always
--    raised 'No tenant_id in JWT'.
-- 2. rpc_create_receipt_v2 swallowed that failure (WARNING + success:true),
--    leaving a confirmed receipt with no stock movements and an unchanged PO.
-- 3. The v1 posting function it called wrote stock_balances directly
--    (double-counting against trigger_maintain_stock_balances) and set the
--    PO header status to 'received', which the check constraint rejects.
-- 4. Both posters inserted into inventory_events columns that don't exist
--    on stage (catalog_item_id/location_id/quantity_delta live in payload).
-- 5. They referenced v_receipt.created_by_user_id; receipts has
--    received_by_user_id.
-- 6. inventory_events.event_type is verb-style ('receive'); 'received'/
--    'rejected' violate its check constraint.
-- 7. The v2 PO-header CASE's bare `ELSE status` resolved to the aggregated
--    line column → 'must appear in GROUP BY' error on every PO-linked post.
--
-- Fix: correct all of the above in the v2 poster, make the v1 poster a thin
-- delegate to v2 (one code path, guardrails included), and make
-- rpc_create_receipt_v2 post through v2 and RAISE on failure so the whole
-- receipt rolls back instead of half-landing. Verified end-to-end on stage
-- with a rollback-guarded synthetic PO: +2 stock exactly, line and header
-- fully_received.

-- ── 1. v2 poster: accept tenant_id from app_metadata or root ────────────────
CREATE OR REPLACE FUNCTION supply_chain.rpc_post_receipt_to_inventory_v2(
  p_receipt_id uuid,
  p_actor_user_id uuid DEFAULT NULL::uuid,
  p_override_reason text DEFAULT NULL::text
) RETURNS jsonb
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
    v_po_line RECORD;
    v_open_qty NUMERIC;
    v_max_allowed NUMERIC;
    v_over_receipt_lines JSONB := '[]'::jsonb;
BEGIN
    -- Support both JWT tenant_id paths (app_metadata or root)
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
        COALESCE(gp.require_override_reason, true)
    INTO v_over_receipt_policy, v_over_receipt_threshold_pct, v_require_reason
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

    -- GUARDRAIL: pre-check over-receipt for all PO-linked lines
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
    END IF;

    -- Process each receipt line
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
                -- inventory_events keeps item/location/qty in payload; its
                -- event_type vocabulary is verb-style ('receive', not 'received')
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
$function$;

-- ── 2. v1 poster: delegate to v2 (kills its JWT bug, double stock_balances
--      write, and invalid 'received' header status in one move) ─────────────
CREATE OR REPLACE FUNCTION supply_chain.rpc_post_receipt_to_inventory(
  p_receipt_id uuid,
  p_actor_user_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'supply_chain', 'inventory', 'public'
AS $function$
BEGIN
  RETURN supply_chain.rpc_post_receipt_to_inventory_v2(p_receipt_id, p_actor_user_id);
END;
$function$;

-- ── 3. rpc_create_receipt_v2: post via v2 and fail loudly ───────────────────
-- Only the auto-post block changes: call the v2 poster with the actor, and if
-- it fails (exception OR success:false e.g. OVER_RECEIPT_BLOCKED), RAISE so
-- the whole transaction — receipt included — rolls back atomically.
CREATE OR REPLACE FUNCTION supply_chain.rpc_create_receipt_v2(
  p_receipt_number text DEFAULT NULL::text,
  p_location_id uuid DEFAULT NULL::uuid,
  p_lines jsonb DEFAULT NULL::jsonb,
  p_po_id uuid DEFAULT NULL::uuid,
  p_vendor_id uuid DEFAULT NULL::uuid,
  p_received_at timestamp with time zone DEFAULT now(),
  p_notes text DEFAULT NULL::text,
  p_packing_slip_no text DEFAULT NULL::text,
  p_vendor_invoice_no text DEFAULT NULL::text,
  p_source_type text DEFAULT 'delivery'::text,
  p_status text DEFAULT 'confirmed'::text,
  p_auto_post boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'supply_chain', 'inventory', 'public'
AS $function$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
  v_receipt_id UUID;
  v_receipt_number TEXT;
  v_line JSONB;
  v_line_number INT := 0;
  v_post_result JSONB;
  v_event_id TEXT;
  v_next_seq INT;
BEGIN
  v_tenant_id := COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID,
    (auth.jwt() ->> 'tenant_id')::UUID
  );

  v_user_id := COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'user_id')::UUID,
    (auth.jwt() ->> 'user_id')::UUID,
    (auth.jwt() ->> 'sub')::UUID
  );

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required - no tenant_id in JWT';
  END IF;

  IF p_location_id IS NULL THEN
    RAISE EXCEPTION 'location_id is required';
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required';
  END IF;

  IF p_receipt_number IS NULL OR p_receipt_number = '' THEN
    SELECT COALESCE(MAX(CAST(SUBSTRING(receipt_number FROM '[0-9]+$') AS INTEGER)), 0) + 1
    INTO v_next_seq
    FROM supply_chain.receipts
    WHERE tenant_id = v_tenant_id
      AND receipt_number ~ '^RCV-[0-9]+$';

    v_receipt_number := 'RCV-' || LPAD(v_next_seq::TEXT, 6, '0');
  ELSE
    v_receipt_number := p_receipt_number;
  END IF;

  IF p_status NOT IN ('draft', 'confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid status: %. Must be draft, confirmed, or cancelled.', p_status;
  END IF;

  IF p_source_type NOT IN ('delivery', 'pickup', 'transfer', 'return') THEN
    RAISE EXCEPTION 'Invalid source_type: %. Must be delivery, pickup, transfer, or return.', p_source_type;
  END IF;

  v_event_id := 'receipt-create-' || v_receipt_number || '-' || extract(epoch from now())::TEXT;

  INSERT INTO supply_chain.receipts (
    tenant_id, receipt_number, location_id, po_id, vendor_id, received_at,
    notes, packing_slip_no, vendor_invoice_no, source_type, status,
    received_by_user_id, last_event_id
  ) VALUES (
    v_tenant_id, v_receipt_number, p_location_id, p_po_id, p_vendor_id,
    COALESCE(p_received_at, now()), p_notes, p_packing_slip_no,
    p_vendor_invoice_no, p_source_type, p_status, v_user_id, v_event_id
  )
  ON CONFLICT (tenant_id, last_event_id) DO NOTHING
  RETURNING id INTO v_receipt_id;

  IF v_receipt_id IS NULL THEN
    SELECT id INTO v_receipt_id
    FROM supply_chain.receipts
    WHERE tenant_id = v_tenant_id AND last_event_id = v_event_id;

    RETURN jsonb_build_object(
      'success', true,
      'receipt_id', v_receipt_id,
      'receipt_number', v_receipt_number,
      'message', 'Receipt already exists (idempotent)',
      'posted_to_inventory', false
    );
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_number := v_line_number + 1;
    v_event_id := 'receipt-' || v_receipt_id::TEXT || '-line-' || v_line_number::TEXT || '-' || extract(epoch from now())::TEXT;

    INSERT INTO supply_chain.receipt_lines (
      tenant_id, receipt_id, line_number, catalog_item_id, qty_received,
      po_line_id, condition_status, destination_location_id,
      unit_cost_actual, uom, notes, last_event_id
    ) VALUES (
      v_tenant_id, v_receipt_id, v_line_number,
      (v_line->>'catalog_item_id')::UUID,
      (v_line->>'qty_received')::NUMERIC,
      (v_line->>'po_line_id')::UUID,
      COALESCE(v_line->>'condition_status', 'accepted'),
      (v_line->>'destination_location_id')::UUID,
      (v_line->>'unit_cost_actual')::NUMERIC,
      v_line->>'uom',
      v_line->>'notes',
      v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
  END LOOP;

  -- Auto-post through the guardrailed v2 poster. A failure here must fail the
  -- whole call (rolling back the receipt) — a confirmed receipt that silently
  -- never hit inventory is exactly the bug this migration removes.
  IF p_auto_post AND p_status = 'confirmed' THEN
    v_post_result := supply_chain.rpc_post_receipt_to_inventory_v2(v_receipt_id, v_user_id);
    IF COALESCE((v_post_result->>'success')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION '%', COALESCE(
        v_post_result -> 'error' ->> 'message',
        'Failed to post receipt to inventory'
      )
      USING DETAIL = COALESCE(v_post_result -> 'error' ->> 'code', 'POST_FAILED');
    END IF;
  ELSE
    v_post_result := jsonb_build_object('success', false, 'message', 'Auto-post not requested or status is not confirmed');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'lines_created', v_line_number,
    'auto_post_result', v_post_result
  );
END;
$function$;
