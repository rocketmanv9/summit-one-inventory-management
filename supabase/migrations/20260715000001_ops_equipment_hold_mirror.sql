-- 20260715000001_ops_equipment_hold_mirror.sql
-- Two-way equipment reservation mirror with Operations (Grant, 2026-07-15).
--
--   ops → inventory : Operations job equipment holds (equipment.requested /
--                     equipment.released via the hub) land as serialized
--                     inventory.reservations through
--                     rpc_inv_apply_ops_equipment_hold (called by the new
--                     /api/webhooks/operations-events receiver). Mirror rows
--                     are keyed last_event_id = 'ops-hold:<assignment_id>'
--                     (UNIQUE (tenant_id, last_event_id) already exists) and
--                     carry job_ref = {source:'operations', job_id, job_name}.
--   inventory → ops : every reservation lifecycle event now carries the
--                     fleet crosswalk (inventory.assets.fleet_asset_id) plus
--                     the reservation window/status/job_ref, so Operations
--                     can mirror warehouse reservations into its planner
--                     availability. reservation_event_payload() is the ONE
--                     payload builder all lifecycle RPCs share.
--
-- LOOP GUARD: mirror rows publish events like native reservations, but their
-- job_ref.source = 'operations' — Operations' inventory-events webhook drops
-- those on sight, so the two mirrors can never echo each other.

-- ── Shared event payload builder ─────────────────────────────────────────────
-- Joined at emit time so consumers never need our schema: asset identity
-- (asset_tag + fleet_asset_id), window, status, job_ref.
CREATE OR REPLACE FUNCTION inventory.reservation_event_payload(
    p_tenant_id uuid,
    p_reservation_id uuid,
    p_extra jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $$
    SELECT jsonb_build_object(
        'reservation_id', r.id,
        'reservation_type', r.reservation_type,
        'status', r.status,
        'catalog_item_id', r.catalog_item_id,
        'asset_id', r.asset_id,
        'asset_tag', a.asset_tag,
        'fleet_asset_id', a.fleet_asset_id,
        'location_id', r.location_id,
        'destination_location_id', r.destination_location_id,
        'qty', r.qty,
        'allocation_type', r.allocation_type,
        'reserved_from', r.reserved_from,
        'reserved_until', r.reserved_until,
        'job_ref', r.job_ref,
        'external_order_ref', r.external_order_ref
    ) || COALESCE(p_extra, '{}'::jsonb)
    FROM inventory.reservations r
    LEFT JOIN inventory.assets a
      ON a.id = r.asset_id AND a.tenant_id = r.tenant_id
    WHERE r.id = p_reservation_id
      AND r.tenant_id = p_tenant_id;
$$;

COMMENT ON FUNCTION inventory.reservation_event_payload(uuid, uuid, jsonb) IS
  'Canonical reservation.* event payload: reservation fields + the fleet crosswalk '
  '(assets.fleet_asset_id) joined at emit time. Used by every reservation lifecycle RPC.';

-- ── ops → inventory mirror RPC ───────────────────────────────────────────────
-- Idempotent apply of an Operations equipment hold. p_op:
--   'upsert'  — hold placed/updated (status reserved|confirmed on the ops side)
--   'release' — hold released / downgraded to a non-blocking status
-- Returns jsonb {outcome, reservation_id?}: created | updated | released |
-- noop | conflict | skipped_no_crosswalk | skipped_no_location.
-- Deliberately NOT rpc_inv_reserve_asset: the mirror must absorb repeats,
-- window changes, and pre-existing warehouse conflicts (outcome 'conflict',
-- surfaced back to ops as an external hold) instead of raising.
CREATE OR REPLACE FUNCTION inventory.rpc_inv_apply_ops_equipment_hold(
    p_tenant_id uuid,
    p_op text,
    p_assignment_id text,
    p_fleet_asset_id uuid DEFAULT NULL,
    p_job_id text DEFAULT NULL,
    p_job_name text DEFAULT NULL,
    p_reserved_from timestamp with time zone DEFAULT NULL,
    p_reserved_until timestamp with time zone DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $$
DECLARE
    v_key TEXT;
    v_existing RECORD;
    v_asset RECORD;
    v_job_ref JSONB;
    v_location UUID;
    v_catalog_item_id UUID;
    v_uom_term_id UUID;
    v_reservation_id UUID;
BEGIN
    IF p_tenant_id IS NULL OR p_assignment_id IS NULL OR length(p_assignment_id) = 0 THEN
        RAISE EXCEPTION 'tenant_id and assignment_id are required'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF p_op NOT IN ('upsert', 'release') THEN
        RAISE EXCEPTION 'p_op must be upsert or release' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_key := 'ops-hold:' || p_assignment_id;

    SELECT id, status, asset_id INTO v_existing
    FROM inventory.reservations
    WHERE tenant_id = p_tenant_id AND last_event_id = v_key;

    -- ── release ──────────────────────────────────────────────────────────────
    IF p_op = 'release' THEN
        IF v_existing.id IS NULL OR v_existing.status <> 'active' THEN
            RETURN jsonb_build_object('outcome', 'noop');
        END IF;

        UPDATE inventory.reservations
        SET status = 'released', updated_at = NOW()
        WHERE id = v_existing.id;

        -- Free the asset only if this was the last active hold on it.
        UPDATE inventory.assets a
        SET status = 'available', updated_at = NOW()
        WHERE a.tenant_id = p_tenant_id
          AND a.id = v_existing.asset_id
          AND a.status = 'assigned'
          AND NOT EXISTS (
              SELECT 1 FROM inventory.reservations r2
              WHERE r2.tenant_id = p_tenant_id
                AND r2.asset_id = a.id
                AND r2.status = 'active'
          );

        PERFORM inventory.publish_event(
            p_tenant_id => p_tenant_id,
            p_scope => 'tenant',
            p_event_type => 'reservation.released',
            p_aggregate_type => 'reservation',
            p_aggregate_id => v_existing.id,
            p_payload => inventory.reservation_event_payload(p_tenant_id, v_existing.id)
        );
        RETURN jsonb_build_object('outcome', 'released', 'reservation_id', v_existing.id);
    END IF;

    -- ── upsert ───────────────────────────────────────────────────────────────
    IF p_fleet_asset_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'skipped_no_crosswalk');
    END IF;

    SELECT id, catalog_item_id, location_id, home_location_id INTO v_asset
    FROM inventory.assets
    WHERE tenant_id = p_tenant_id AND fleet_asset_id = p_fleet_asset_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'skipped_no_crosswalk');
    END IF;

    v_job_ref := jsonb_strip_nulls(jsonb_build_object(
        'source', 'operations',
        'job_id', p_job_id,
        'job_name', p_job_name
    ));

    IF v_existing.id IS NOT NULL THEN
        BEGIN
            UPDATE inventory.reservations
            SET status = 'active',
                reserved_from = p_reserved_from,
                reserved_until = p_reserved_until,
                job_ref = v_job_ref,
                external_order_ref = COALESCE(p_job_id, external_order_ref),
                updated_at = NOW()
            WHERE id = v_existing.id;
        EXCEPTION WHEN exclusion_violation THEN
            -- Another active reservation already owns that asset window —
            -- keep the mirror row as-is; ops sees the warehouse hold anyway.
            RETURN jsonb_build_object('outcome', 'conflict', 'reservation_id', v_existing.id);
        END;

        UPDATE inventory.assets
        SET status = 'assigned', updated_at = NOW()
        WHERE id = v_asset.id AND tenant_id = p_tenant_id AND status = 'available';

        PERFORM inventory.publish_event(
            p_tenant_id => p_tenant_id,
            p_scope => 'tenant',
            p_event_type => 'reservation.updated',
            p_aggregate_type => 'reservation',
            p_aggregate_id => v_existing.id,
            p_payload => inventory.reservation_event_payload(p_tenant_id, v_existing.id)
        );
        RETURN jsonb_build_object('outcome', 'updated', 'reservation_id', v_existing.id);
    END IF;

    -- Fleet-synced assets carry no catalog/location linkage (595/595 on stage
    -- when this shipped) but reservations REQUIRE both. Fall back to the
    -- tenant's first location and a per-tenant synthetic "Fleet equipment
    -- (Operations mirror)" catalog item so job holds still land as real,
    -- UI-visible reservations. Assets themselves are never mutated.
    v_location := COALESCE(v_asset.location_id, v_asset.home_location_id);
    IF v_location IS NULL THEN
        SELECT id INTO v_location FROM inventory.locations
        WHERE tenant_id = p_tenant_id ORDER BY created_at LIMIT 1;
    END IF;
    IF v_location IS NULL THEN
        RETURN jsonb_build_object('outcome', 'skipped_no_location');
    END IF;

    v_catalog_item_id := v_asset.catalog_item_id;
    IF v_catalog_item_id IS NULL THEN
        SELECT id INTO v_catalog_item_id FROM inventory.catalog_items
        WHERE tenant_id = p_tenant_id AND sku = 'FLEET-EQUIPMENT-MIRROR';
        IF v_catalog_item_id IS NULL THEN
            -- uom_term_id is a GV term this RPC can't resolve remotely —
            -- borrow the tenant's most established catalog item's UOM.
            SELECT uom_term_id INTO v_uom_term_id FROM inventory.catalog_items
            WHERE tenant_id = p_tenant_id ORDER BY created_at LIMIT 1;
            IF v_uom_term_id IS NULL THEN
                RETURN jsonb_build_object('outcome', 'skipped_no_catalog_item');
            END IF;
            INSERT INTO inventory.catalog_items (tenant_id, sku, name, description, tracking_mode, uom_term_id, last_event_id)
            VALUES (
                p_tenant_id, 'FLEET-EQUIPMENT-MIRROR', 'Fleet equipment (Operations mirror)',
                'Synthetic catalog item backing serialized reservations mirrored from Operations job holds, for fleet-synced assets with no catalog linkage.',
                'serialized', v_uom_term_id, 'ops-hold-mirror-catalog:' || p_tenant_id
            )
            ON CONFLICT (tenant_id, sku) DO NOTHING
            RETURNING id INTO v_catalog_item_id;
            IF v_catalog_item_id IS NULL THEN
                SELECT id INTO v_catalog_item_id FROM inventory.catalog_items
                WHERE tenant_id = p_tenant_id AND sku = 'FLEET-EQUIPMENT-MIRROR';
            END IF;
        END IF;
    END IF;

    BEGIN
        INSERT INTO inventory.reservations (
            tenant_id, catalog_item_id, location_id, qty, asset_id,
            reservation_type, status, job_ref, external_order_ref,
            reserved_from, reserved_until, notes, last_event_id
        ) VALUES (
            p_tenant_id, v_catalog_item_id, v_location, 1, v_asset.id,
            'serialized', 'active', v_job_ref, p_job_id,
            p_reserved_from, p_reserved_until,
            'Mirrored from Operations job hold', v_key
        )
        ON CONFLICT (tenant_id, last_event_id) DO NOTHING
        RETURNING id INTO v_reservation_id;
    EXCEPTION WHEN exclusion_violation THEN
        RETURN jsonb_build_object('outcome', 'conflict');
    END;

    IF v_reservation_id IS NULL THEN
        -- Concurrent apply landed first — idempotent noop.
        SELECT id INTO v_reservation_id
        FROM inventory.reservations
        WHERE tenant_id = p_tenant_id AND last_event_id = v_key;
        RETURN jsonb_build_object('outcome', 'noop', 'reservation_id', v_reservation_id);
    END IF;

    UPDATE inventory.assets
    SET status = 'assigned', updated_at = NOW()
    WHERE id = v_asset.id AND tenant_id = p_tenant_id AND status = 'available';

    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'reservation.created.serialized',
        p_aggregate_type => 'reservation',
        p_aggregate_id => v_reservation_id,
        p_payload => inventory.reservation_event_payload(p_tenant_id, v_reservation_id)
    );
    RETURN jsonb_build_object('outcome', 'created', 'reservation_id', v_reservation_id);
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_apply_ops_equipment_hold(uuid, text, text, uuid, text, text, timestamptz, timestamptz) IS
  'Idempotent mirror of an Operations equipment hold into inventory.reservations '
  '(serialized, keyed last_event_id = ops-hold:<assignment_id>). Called by '
  '/api/webhooks/operations-events on equipment.requested / equipment.released. '
  'Never raises on business conflicts — returns {outcome} instead so webhook retries stay clean.';

-- ── Enriched lifecycle emissions ─────────────────────────────────────────────
-- Same bodies as before; ONLY the published payloads changed — they now go
-- through reservation_event_payload() (fleet_asset_id + window + status +
-- job_ref), which is what Operations consumes.

-- rpc_inv_reserve_asset (current 12-arg overload used by the app)
CREATE OR REPLACE FUNCTION inventory.rpc_inv_reserve_asset(
    p_tenant_id uuid,
    p_asset_id uuid,
    p_allocation_type text DEFAULT NULL::text,
    p_job_ref jsonb DEFAULT NULL::jsonb,
    p_external_order_ref text DEFAULT NULL::text,
    p_needed_by date DEFAULT NULL::date,
    p_expiration_date date DEFAULT NULL::date,
    p_reserved_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
    p_reserved_until timestamp with time zone DEFAULT NULL::timestamp with time zone,
    p_notes text DEFAULT NULL::text,
    p_destination_location_id uuid DEFAULT NULL::uuid,
    p_last_event_id text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $$
DECLARE
    v_reservation_id UUID;
    v_event_id TEXT;
    v_validation RECORD;
    v_asset RECORD;
BEGIN
    IF p_tenant_id IS NULL OR p_asset_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id and asset_id are required'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_event_id := p_last_event_id;

    SELECT a.id, a.catalog_item_id, a.location_id, a.asset_tag
    INTO v_asset
    FROM inventory.assets a
    WHERE a.id = p_asset_id
      AND a.tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Asset not found or access denied'
        USING ERRCODE = 'no_data_found';
    END IF;

    SELECT * INTO v_validation
    FROM inventory.validate_asset_reservation_availability(
        p_tenant_id, p_asset_id, p_reserved_from, p_reserved_until
    );

    IF NOT v_validation.is_available THEN
        RAISE EXCEPTION '%', v_validation.message
        USING ERRCODE = 'check_violation',
              HINT = 'Choose a different asset or time window';
    END IF;

    INSERT INTO inventory.reservations (
        tenant_id, catalog_item_id, location_id, destination_location_id,
        qty, asset_id, reservation_type, status, allocation_type, job_ref,
        external_order_ref, needed_by, expiration_date, reserved_from,
        reserved_until, notes, last_event_id
    ) VALUES (
        p_tenant_id, v_asset.catalog_item_id, v_asset.location_id, p_destination_location_id,
        1, p_asset_id, 'serialized', 'active', p_allocation_type, p_job_ref,
        p_external_order_ref, p_needed_by, p_expiration_date, p_reserved_from,
        p_reserved_until, p_notes, v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_reservation_id;

    IF v_reservation_id IS NULL THEN
        SELECT id INTO v_reservation_id
        FROM inventory.reservations
        WHERE tenant_id = p_tenant_id
          AND last_event_id = v_event_id;
        RETURN v_reservation_id;
    END IF;

    UPDATE inventory.assets
    SET status = 'assigned', updated_at = NOW()
    WHERE id = p_asset_id
      AND tenant_id = p_tenant_id;

    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'reservation.created.serialized',
        p_aggregate_type => 'reservation',
        p_aggregate_id => v_reservation_id,
        p_payload => inventory.reservation_event_payload(p_tenant_id, v_reservation_id)
    );

    RETURN v_reservation_id;
END;
$$;

-- rpc_inv_release_reservation
CREATE OR REPLACE FUNCTION inventory.rpc_inv_release_reservation(
    p_tenant_id uuid,
    p_reservation_id uuid,
    p_cancelled_by_user_id uuid,
    p_last_event_id text DEFAULT NULL::text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $$
DECLARE
    v_reservation RECORD;
    v_event_id TEXT;
BEGIN
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required';
    END IF;
    v_event_id := p_last_event_id;

    SELECT * INTO v_reservation
    FROM inventory.reservations
    WHERE id = p_reservation_id
    AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reservation not found';
    END IF;

    IF v_reservation.status != 'active' THEN
        RAISE EXCEPTION 'Reservation cannot be cancelled in status: %', v_reservation.status;
    END IF;

    IF v_reservation.reservation_type = 'fungible' THEN
        UPDATE inventory.stock_balances
        SET qty_reserved = GREATEST(0, qty_reserved - v_reservation.qty),
            updated_at = NOW()
        WHERE tenant_id = p_tenant_id
        AND catalog_item_id = v_reservation.catalog_item_id
        AND location_id = v_reservation.location_id;
    ELSIF v_reservation.reservation_type = 'serialized' THEN
        UPDATE inventory.assets
        SET status = 'available', updated_at = NOW()
        WHERE id = v_reservation.asset_id
        AND tenant_id = p_tenant_id;
    ELSE
        RAISE EXCEPTION 'Unknown reservation_type: %', v_reservation.reservation_type;
    END IF;

    UPDATE inventory.reservations
    SET status = 'released', updated_at = NOW()
    WHERE id = p_reservation_id;

    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'reservation.released',
        p_aggregate_type => 'reservation',
        p_aggregate_id => p_reservation_id,
        p_payload => inventory.reservation_event_payload(p_tenant_id, p_reservation_id)
    );

    RETURN TRUE;
END;
$$;

-- rpc_inv_fulfill_reservation_issue
CREATE OR REPLACE FUNCTION inventory.rpc_inv_fulfill_reservation_issue(
    p_tenant_id uuid,
    p_reservation_id uuid,
    p_fulfilled_by_user_id uuid,
    p_last_event_id text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $$
DECLARE
    v_reservation RECORD;
    v_movement_id UUID;
    v_event_id TEXT;
    v_current_qty_on_hand NUMERIC;
BEGIN
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required';
    END IF;
    v_event_id := p_last_event_id;

    SELECT * INTO v_reservation
    FROM inventory.reservations
    WHERE id = p_reservation_id
    AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reservation not found';
    END IF;

    IF v_reservation.status != 'active' THEN
        RAISE EXCEPTION 'Reservation cannot be fulfilled in status: %', v_reservation.status;
    END IF;

    IF v_reservation.reservation_type = 'fungible' THEN
        SELECT COALESCE(qty_on_hand, 0) INTO v_current_qty_on_hand
        FROM inventory.stock_balances
        WHERE tenant_id = p_tenant_id
        AND catalog_item_id = v_reservation.catalog_item_id
        AND location_id = v_reservation.location_id;

        IF v_current_qty_on_hand < v_reservation.qty THEN
            RAISE EXCEPTION 'Insufficient stock on hand to fulfill reservation. Available: %, Required: %',
                v_current_qty_on_hand, v_reservation.qty;
        END IF;

        v_movement_id := inventory.insert_stock_movement(
            p_tenant_id => p_tenant_id,
            p_catalog_item_id => v_reservation.catalog_item_id,
            p_location_id => v_reservation.location_id,
            p_quantity_delta => -v_reservation.qty,
            p_movement_type => 'issued',
            p_source_ref_type => 'reservation',
            p_source_ref_id => p_reservation_id,
            p_unit_cost => NULL,
            p_reason => 'Fulfill reservation',
            p_notes => 'Reservation fulfilled for: ' || COALESCE(v_reservation.external_order_ref, 'N/A'),
            p_correlation_id => NULL,
            p_occurred_at => NOW(),
            p_created_by_user_id => p_fulfilled_by_user_id,
            p_last_event_id => v_event_id || '_movement'
        );

        UPDATE inventory.stock_balances
        SET qty_reserved = GREATEST(0, qty_reserved - v_reservation.qty),
            updated_at = NOW()
        WHERE tenant_id = p_tenant_id
        AND catalog_item_id = v_reservation.catalog_item_id
        AND location_id = v_reservation.location_id;

    ELSIF v_reservation.reservation_type = 'serialized' THEN
        DECLARE
            v_asset_status TEXT;
        BEGIN
            SELECT status INTO v_asset_status
            FROM inventory.assets
            WHERE id = v_reservation.asset_id
            AND tenant_id = p_tenant_id;

            IF v_asset_status IS NULL THEN
                RAISE EXCEPTION 'Asset not found for serialized reservation';
            END IF;

            IF v_asset_status != 'assigned' THEN
                RAISE EXCEPTION 'Asset is not in assigned status. Current status: %', v_asset_status;
            END IF;

            v_movement_id := NULL;
        END;
    ELSE
        RAISE EXCEPTION 'Unknown reservation_type: %', v_reservation.reservation_type;
    END IF;

    UPDATE inventory.reservations
    SET status = 'fulfilled',
        fulfilled_by_user_id = p_fulfilled_by_user_id,
        fulfilled_at = NOW(),
        updated_at = NOW()
    WHERE id = p_reservation_id;

    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'reservation.fulfilled',
        p_aggregate_type => 'reservation',
        p_aggregate_id => p_reservation_id,
        p_payload => inventory.reservation_event_payload(
            p_tenant_id, p_reservation_id,
            jsonb_build_object('movement_id', v_movement_id)
        )
    );

    RETURN v_movement_id;
END;
$$;

-- rpc_inv_undo_fulfill_reservation
CREATE OR REPLACE FUNCTION inventory.rpc_inv_undo_fulfill_reservation(
    p_tenant_id uuid,
    p_reservation_id uuid,
    p_user_id uuid,
    p_last_event_id text DEFAULT NULL::text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $$
DECLARE
    v_reservation RECORD;
    v_movement_id UUID;
    v_event_id TEXT;
BEGIN
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required';
    END IF;
    v_event_id := p_last_event_id;

    SELECT * INTO v_reservation
    FROM inventory.reservations
    WHERE id = p_reservation_id
    AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reservation not found';
    END IF;

    IF v_reservation.status != 'fulfilled' THEN
        RAISE EXCEPTION 'Can only undo fulfilled reservations. Current status: %', v_reservation.status;
    END IF;

    IF v_reservation.reservation_type = 'fungible' THEN
        v_movement_id := inventory.insert_stock_movement(
            p_tenant_id => p_tenant_id,
            p_catalog_item_id => v_reservation.catalog_item_id,
            p_location_id => v_reservation.location_id,
            p_quantity_delta => v_reservation.qty,
            p_movement_type => 'adjustment',
            p_source_ref_type => 'reservation',
            p_source_ref_id => p_reservation_id,
            p_unit_cost => NULL,
            p_reason => 'Undo fulfillment',
            p_notes => 'Reversed fulfillment - restoring stock and reservation',
            p_correlation_id => NULL,
            p_occurred_at => NOW(),
            p_created_by_user_id => p_user_id,
            p_last_event_id => v_event_id || '_movement'
        );

        UPDATE inventory.stock_balances
        SET qty_reserved = qty_reserved + v_reservation.qty,
            updated_at = NOW()
        WHERE tenant_id = p_tenant_id
        AND catalog_item_id = v_reservation.catalog_item_id
        AND location_id = v_reservation.location_id;

    ELSIF v_reservation.reservation_type = 'serialized' THEN
        NULL;
    ELSE
        RAISE EXCEPTION 'Unknown reservation_type: %', v_reservation.reservation_type;
    END IF;

    UPDATE inventory.reservations
    SET status = 'active',
        fulfilled_by_user_id = NULL,
        fulfilled_at = NULL,
        updated_at = NOW()
    WHERE id = p_reservation_id;

    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'reservation.fulfill_undone',
        p_aggregate_type => 'reservation',
        p_aggregate_id => p_reservation_id,
        p_payload => inventory.reservation_event_payload(p_tenant_id, p_reservation_id)
    );

    RETURN TRUE;
END;
$$;

-- rpc_inv_undo_release_reservation
CREATE OR REPLACE FUNCTION inventory.rpc_inv_undo_release_reservation(
    p_tenant_id uuid,
    p_reservation_id uuid,
    p_user_id uuid,
    p_last_event_id text DEFAULT NULL::text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $$
DECLARE
    v_reservation RECORD;
    v_event_id TEXT;
BEGIN
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required';
    END IF;
    v_event_id := p_last_event_id;

    SELECT * INTO v_reservation
    FROM inventory.reservations
    WHERE id = p_reservation_id
    AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reservation not found';
    END IF;

    IF v_reservation.status != 'released' THEN
        RAISE EXCEPTION 'Can only undo released reservations. Current status: %', v_reservation.status;
    END IF;

    IF v_reservation.reservation_type = 'fungible' THEN
        UPDATE inventory.stock_balances
        SET qty_reserved = qty_reserved + v_reservation.qty,
            updated_at = NOW()
        WHERE tenant_id = p_tenant_id
        AND catalog_item_id = v_reservation.catalog_item_id
        AND location_id = v_reservation.location_id;

    ELSIF v_reservation.reservation_type = 'serialized' THEN
        DECLARE
            v_asset_status TEXT;
        BEGIN
            SELECT status INTO v_asset_status
            FROM inventory.assets
            WHERE id = v_reservation.asset_id
            AND tenant_id = p_tenant_id;

            IF v_asset_status IS NULL THEN
                RAISE EXCEPTION 'Asset not found';
            END IF;

            IF v_asset_status != 'available' THEN
                RAISE EXCEPTION 'Asset is not available. Current status: %', v_asset_status;
            END IF;

            UPDATE inventory.assets
            SET status = 'assigned', updated_at = NOW()
            WHERE id = v_reservation.asset_id
            AND tenant_id = p_tenant_id;
        END;
    ELSE
        RAISE EXCEPTION 'Unknown reservation_type: %', v_reservation.reservation_type;
    END IF;

    UPDATE inventory.reservations
    SET status = 'active', updated_at = NOW()
    WHERE id = p_reservation_id;

    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'reservation.release_undone',
        p_aggregate_type => 'reservation',
        p_aggregate_id => p_reservation_id,
        p_payload => inventory.reservation_event_payload(p_tenant_id, p_reservation_id)
    );

    RETURN TRUE;
END;
$$;

-- ── Event catalog registration ───────────────────────────────────────────────
-- The reservation lifecycle events were emitted but never catalogued; register
-- them (plus the new reservation.updated) so the catalog reflects reality.
INSERT INTO public.event_catalog (event_key, display_name, description, aggregate_type, event_version, payload_example)
VALUES
  ('reservation.created.serialized', 'Reservation Created (Serialized)',
   'A specific asset was reserved. Payload carries the fleet crosswalk (fleet_asset_id) + window + job_ref.',
   'reservation', 1,
   '{"reservation_id":"uuid","reservation_type":"serialized","status":"active","asset_id":"uuid","asset_tag":"TAG-9","fleet_asset_id":"uuid","reserved_from":"2026-07-18T07:00:00Z","reserved_until":"2026-07-20T17:00:00Z","job_ref":{"source":"operations","job_id":"uuid","job_name":"Maple Ave"},"external_order_ref":"uuid"}'::jsonb),
  ('reservation.created.fungible', 'Reservation Created (Fungible)',
   'A quantity of a catalog item was reserved at a location.',
   'reservation', 1,
   '{"reservation_id":"uuid","reservation_type":"fungible","catalog_item_id":"uuid","location_id":"uuid","qty":5}'::jsonb),
  ('reservation.updated', 'Reservation Updated',
   'A reservation''s window/refs changed (today: the Operations hold mirror refreshing a window).',
   'reservation', 1,
   '{"reservation_id":"uuid","reservation_type":"serialized","status":"active","fleet_asset_id":"uuid","reserved_from":null,"reserved_until":null,"job_ref":{"source":"operations"}}'::jsonb),
  ('reservation.fulfilled', 'Reservation Fulfilled',
   'Reservation issued/handed out. Serialized payloads carry fleet_asset_id.',
   'reservation', 1,
   '{"reservation_id":"uuid","reservation_type":"serialized","status":"fulfilled","fleet_asset_id":"uuid"}'::jsonb),
  ('reservation.released', 'Reservation Released',
   'Reservation cancelled/released. Serialized payloads carry fleet_asset_id.',
   'reservation', 1,
   '{"reservation_id":"uuid","reservation_type":"serialized","status":"released","fleet_asset_id":"uuid"}'::jsonb),
  ('reservation.fulfill_undone', 'Reservation Fulfillment Undone',
   'A fulfillment was reversed; the reservation is active again.',
   'reservation', 1,
   '{"reservation_id":"uuid","reservation_type":"serialized","status":"active","fleet_asset_id":"uuid"}'::jsonb),
  ('reservation.release_undone', 'Reservation Release Undone',
   'A release was reversed; the reservation is active again.',
   'reservation', 1,
   '{"reservation_id":"uuid","reservation_type":"serialized","status":"active","fleet_asset_id":"uuid"}'::jsonb)
ON CONFLICT (event_key) DO UPDATE
SET description = EXCLUDED.description,
    payload_example = EXCLUDED.payload_example,
    updated_at = NOW();

INSERT INTO public.event_definitions (event_name, version, producer, description, status)
VALUES
  ('reservation.created.serialized', 1, 'inventory', 'Serialized asset reservation created (payload carries fleet_asset_id crosswalk + window + job_ref).', 'active'),
  ('reservation.created.fungible', 1, 'inventory', 'Fungible reservation created.', 'active'),
  ('reservation.updated', 1, 'inventory', 'Reservation window/refs updated (Operations hold mirror).', 'active'),
  ('reservation.fulfilled', 1, 'inventory', 'Reservation fulfilled/issued.', 'active'),
  ('reservation.released', 1, 'inventory', 'Reservation released/cancelled.', 'active'),
  ('reservation.fulfill_undone', 1, 'inventory', 'Reservation fulfillment reversed.', 'active'),
  ('reservation.release_undone', 1, 'inventory', 'Reservation release reversed.', 'active')
ON CONFLICT (event_name, version) DO UPDATE
SET description = EXCLUDED.description,
    updated_at = NOW();
