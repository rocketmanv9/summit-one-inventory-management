-- 20260812000005_consume_stock.sql
-- "I Took Something": the field consumption RPC — the missing keystone flow.
--
-- Context: the only human stock-write primitive was rpc_adjust_inventory
-- (count_variance/damage/theft/expiration/other), so real field usage either
-- never got recorded (on-hand drift) or landed as an 'adjusted' movement with
-- reason 'other' and no job attribution. Result on stage: stock_movements had
-- ZERO 'issued'/'consumed' rows from humans, and mv_item_velocity (which
-- filters movement_type IN ('issued','consumed','transferred_out')) was empty
-- — days-of-stock and reorder urgency were null tenant-wide.
--
-- rpc_consume_stock records "I took N of item X (for job Y)":
--   * writes an 'issued' stock movement (quantity_delta = -qty, reason
--     'job_consumption' when a job is attributed, else 'consumption');
--     trigger_maintain_stock_balances keeps qty_on_hand and
--     trigger_stock_movement_events owns emission — same contract as every
--     other movement writer.
--   * draws down active fungible reservation(s) for the same job/item/location
--     so the taken units aren't double-counted as both reserved and consumed
--     (trg_maintain_stock_reserved — 20260812000003 — then recomputes
--     qty_reserved automatically).
--   * guardrails: consuming more than on-hand is blocked with the same
--     {success:false, error:{code,message,details,action}} envelope shape
--     rpc_adjust_inventory returns — on-hand can never go negative here.
--   * idempotent on p_idempotency_key (stock_movements is UNIQUE
--     (tenant_id, last_event_id)); a replay is a no-op that reports the
--     current balance.
--
-- Tenant resolution follows the 20260807000001 precedent: explicit
-- p_tenant_id for service-role API callers (the cross-request GUC is not
-- trustworthy over pooled connections), falling back to
-- public.current_tenant_id() for user-JWT callers.

CREATE OR REPLACE FUNCTION inventory.rpc_consume_stock(
    p_catalog_item_id uuid,
    p_location_id uuid,
    p_qty numeric,
    p_job_ref jsonb DEFAULT NULL,
    p_notes text DEFAULT NULL,
    p_idempotency_key text DEFAULT NULL,
    p_tenant_id uuid DEFAULT NULL,
    p_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $function$
DECLARE
    v_tenant_id uuid;
    v_user_id uuid;
    v_job_id uuid;
    v_job_name text;
    v_reason text;
    v_on_hand numeric;
    v_unit_cost numeric;
    v_item_name text;
    v_location_name text;
    v_movement_id uuid;
    v_existing record;
    v_res record;
    v_remaining numeric;
    v_take numeric;
    v_drawn numeric := 0;
    v_reservations_touched int := 0;
    v_reservations_closed int := 0;
    v_notes text;
BEGIN
    -- Auth: explicit tenant (service-role API routes) else session tenant.
    v_tenant_id := COALESCE(p_tenant_id, public.current_tenant_id());
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    v_user_id := COALESCE(p_user_id, (auth.jwt() ->> 'user_id')::uuid, auth.uid());

    IF p_catalog_item_id IS NULL OR p_location_id IS NULL THEN
        RAISE EXCEPTION 'catalog_item_id and location_id are required';
    END IF;
    IF p_qty IS NULL OR p_qty <= 0 THEN
        RAISE EXCEPTION 'qty must be greater than 0';
    END IF;
    IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'p_idempotency_key is required';
    END IF;

    -- Optional job attribution: {source:'operations', job_id, job_name} — the
    -- same jsonb shape reservations carry in job_ref.
    IF p_job_ref IS NOT NULL AND (p_job_ref ->> 'job_id') IS NOT NULL THEN
        BEGIN
            v_job_id := (p_job_ref ->> 'job_id')::uuid;
        EXCEPTION WHEN invalid_text_representation THEN
            v_job_id := NULL;
        END;
        v_job_name := p_job_ref ->> 'job_name';
    END IF;
    v_reason := CASE WHEN v_job_id IS NOT NULL THEN 'job_consumption' ELSE 'consumption' END;

    -- Idempotent replay: the movement is the source of truth. If this key
    -- already produced one, everything downstream (balance trigger, event
    -- emission, reservation draw-down) already ran — report and stop.
    SELECT id INTO v_existing
    FROM inventory.stock_movements
    WHERE tenant_id = v_tenant_id AND last_event_id = p_idempotency_key;
    IF FOUND THEN
        SELECT COALESCE(qty_on_hand, 0) INTO v_on_hand
        FROM inventory.stock_balances
        WHERE tenant_id = v_tenant_id
          AND catalog_item_id = p_catalog_item_id
          AND location_id = p_location_id;

        RETURN jsonb_build_object(
            'success', true,
            'replay', true,
            'movement_id', v_existing.id,
            'quantity', p_qty,
            'new_qty', COALESCE(v_on_hand, 0)
        );
    END IF;

    -- Lock the balance row so concurrent consumes of the last units serialize
    -- (two racing takes can't both pass the guardrail).
    SELECT COALESCE(qty_on_hand, 0) INTO v_on_hand
    FROM inventory.stock_balances
    WHERE tenant_id = v_tenant_id
      AND catalog_item_id = p_catalog_item_id
      AND location_id = p_location_id
    FOR UPDATE;
    IF v_on_hand IS NULL THEN
        v_on_hand := 0;
    END IF;

    -- GUARDRAIL: consumption can never drive on-hand negative. Same envelope
    -- shape as rpc_adjust_inventory so API handlers treat both identically.
    IF v_on_hand < p_qty THEN
        SELECT name INTO v_item_name
        FROM inventory.catalog_items
        WHERE id = p_catalog_item_id AND tenant_id = v_tenant_id;

        SELECT name INTO v_location_name
        FROM inventory.locations
        WHERE id = p_location_id AND tenant_id = v_tenant_id;

        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object(
                'code', 'INSUFFICIENT_STOCK',
                'message', format(
                    'Only %s of %s on hand at %s — cannot take %s.',
                    v_on_hand,
                    COALESCE(v_item_name, 'this item'),
                    COALESCE(v_location_name, 'this location'),
                    p_qty
                ),
                'details', jsonb_build_object(
                    'current_qty', v_on_hand,
                    'requested_qty', p_qty,
                    'item_name', v_item_name,
                    'location_name', v_location_name,
                    'catalog_item_id', p_catalog_item_id,
                    'location_id', p_location_id
                ),
                'action', 'Take a smaller quantity, or receive/adjust stock first.'
            )
        );
    END IF;

    -- Cost carry: last known unit cost for this item (prefer this location,
    -- fall back to any) so consumption values the draw like other issues.
    SELECT unit_cost INTO v_unit_cost
    FROM inventory.stock_movements
    WHERE tenant_id = v_tenant_id
      AND catalog_item_id = p_catalog_item_id
      AND unit_cost IS NOT NULL
    ORDER BY (location_id = p_location_id) DESC, occurred_at DESC
    LIMIT 1;

    v_notes := COALESCE(
        NULLIF(trim(p_notes), ''),
        CASE
            WHEN v_job_name IS NOT NULL THEN format('Taken for %s', v_job_name)
            WHEN v_job_id IS NOT NULL THEN 'Taken for a job'
            ELSE 'Taken from stock'
        END
    );

    -- Audit event (mirrors rpc_adjust_inventory / rpc_issue_inventory).
    INSERT INTO inventory.inventory_events (
        tenant_id, event_type, occurred_at, actor_user_id, source_system,
        last_event_id, payload
    ) VALUES (
        v_tenant_id, 'consume', now(), v_user_id,
        'inventory.rpc_consume_stock', p_idempotency_key,
        jsonb_build_object(
            'catalog_item_id', p_catalog_item_id,
            'location_id', p_location_id,
            'quantity_delta', -p_qty,
            'reason', v_reason,
            'job_ref', p_job_ref,
            'notes', v_notes
        )
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING;

    -- The ledger write. trigger_maintain_stock_balances decrements qty_on_hand;
    -- trigger_stock_movement_events owns outbox emission.
    v_movement_id := inventory.insert_stock_movement(
        p_tenant_id => v_tenant_id,
        p_catalog_item_id => p_catalog_item_id,
        p_location_id => p_location_id,
        p_quantity_delta => -p_qty,
        p_movement_type => 'issued',
        p_source_ref_type => CASE WHEN v_job_id IS NOT NULL THEN 'job' ELSE NULL END,
        p_source_ref_id => v_job_id,
        p_unit_cost => v_unit_cost,
        p_reason => v_reason,
        p_notes => v_notes,
        p_correlation_id => NULL,
        p_occurred_at => now(),
        p_created_by_user_id => v_user_id,
        p_last_event_id => p_idempotency_key
    );

    -- Reservation draw-down: the taken units satisfy this job's hold(s) at this
    -- location, oldest first. Fully-consumed holds close as 'fulfilled' (their
    -- qty stays for the audit trail — recompute only sums ACTIVE rows); partial
    -- takes shrink the hold. trg_maintain_stock_reserved then recomputes
    -- qty_reserved from what remains active.
    IF v_job_id IS NOT NULL THEN
        v_remaining := p_qty;
        FOR v_res IN
            SELECT id, qty
            FROM inventory.reservations
            WHERE tenant_id = v_tenant_id
              AND catalog_item_id = p_catalog_item_id
              AND location_id = p_location_id
              AND reservation_type = 'fungible'
              AND status = 'active'
              AND (job_ref ->> 'job_id') = v_job_id::text
            ORDER BY created_at
            FOR UPDATE
        LOOP
            EXIT WHEN v_remaining <= 0;
            v_take := LEAST(v_res.qty, v_remaining);
            IF v_take >= v_res.qty THEN
                UPDATE inventory.reservations
                SET status = 'fulfilled',
                    fulfilled_at = now(),
                    fulfilled_by_user_id = v_user_id,
                    updated_at = now()
                WHERE id = v_res.id;
                v_reservations_closed := v_reservations_closed + 1;
            ELSE
                UPDATE inventory.reservations
                SET qty = qty - v_take,
                    updated_at = now()
                WHERE id = v_res.id;
            END IF;
            v_drawn := v_drawn + v_take;
            v_reservations_touched := v_reservations_touched + 1;
            v_remaining := v_remaining - v_take;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'replay', false,
        'movement_id', v_movement_id,
        'quantity', p_qty,
        'previous_qty', v_on_hand,
        'new_qty', v_on_hand - p_qty,
        'reason', v_reason,
        'job_id', v_job_id,
        'reservation_drawdown', jsonb_build_object(
            'drawn_qty', v_drawn,
            'reservations_touched', v_reservations_touched,
            'reservations_closed', v_reservations_closed
        )
    );
END;
$function$;

COMMENT ON FUNCTION inventory.rpc_consume_stock(uuid, uuid, numeric, jsonb, text, text, uuid, uuid) IS
  'Field consumption ("I took N of X for job Y"): writes an issued stock '
  'movement (balance + emission via the movement triggers), blocks negative '
  'on-hand with the rpc_adjust_inventory guardrail envelope, draws down the '
  'job''s active fungible reservation(s) at that location, and is idempotent '
  'on p_idempotency_key. Explicit p_tenant_id for service-role callers '
  '(pooled-GUC precedent 20260807000001).';
