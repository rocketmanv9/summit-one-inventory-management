-- 20260803000001_ops_material_hold_mirror.sql
-- Job-sold materials pipeline, inventory side (Grant, 2026-08-03: "when we
-- sell a job, it reserves materials for the job").
--
-- Operations job material needs (material.requested / material.released via
-- the hub) land as FUNGIBLE inventory.reservations through
-- rpc_inv_apply_ops_material_hold — the quantity twin of the serialized
-- equipment-hold mirror (20260715000001). Mirror rows are keyed
-- last_event_id = 'ops-material:<need_id>' (UNIQUE (tenant_id, last_event_id))
-- and carry job_ref = {source:'operations', job_id, job_name}, so:
--   * the reservations UI shows the job name, not an id
--   * Operations' inventory-events webhook drops the echo (source guard)
--   * availability math (qty_reserved) counts sold-job demand immediately.
--
-- Reservation location: the tenant location holding the MOST available stock
-- of the item (stock_balances), falling back to the default ship-to, then any
-- location. Unmapped needs (no catalog item) are skipped with a distinct
-- outcome so ops can flag them instead of silently dropping.

CREATE OR REPLACE FUNCTION inventory.rpc_inv_apply_ops_material_hold(
    p_tenant_id uuid,
    p_op text,
    p_need_id text,
    p_catalog_item_id uuid DEFAULT NULL,
    p_qty numeric DEFAULT NULL,
    p_job_id text DEFAULT NULL,
    p_job_name text DEFAULT NULL,
    p_reserved_from timestamp with time zone DEFAULT NULL,
    p_reserved_until timestamp with time zone DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $function$
DECLARE
    v_key TEXT;
    v_existing RECORD;
    v_job_ref JSONB;
    v_location UUID;
    v_reservation_id UUID;
BEGIN
    IF p_tenant_id IS NULL OR p_need_id IS NULL OR length(p_need_id) = 0 THEN
        RAISE EXCEPTION 'tenant_id and need_id are required'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF p_op NOT IN ('upsert', 'release') THEN
        RAISE EXCEPTION 'p_op must be upsert or release' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_key := 'ops-material:' || p_need_id;

    SELECT id, status INTO v_existing
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
    IF p_catalog_item_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'skipped_unmapped');
    END IF;
    IF p_qty IS NULL OR p_qty <= 0 THEN
        RETURN jsonb_build_object('outcome', 'skipped_no_qty');
    END IF;

    PERFORM 1 FROM inventory.catalog_items
    WHERE tenant_id = p_tenant_id AND id = p_catalog_item_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'skipped_unmapped');
    END IF;

    v_job_ref := jsonb_strip_nulls(jsonb_build_object(
        'source', 'operations',
        'job_id', p_job_id,
        'job_name', p_job_name
    ));

    IF v_existing.id IS NOT NULL THEN
        UPDATE inventory.reservations
        SET status = 'active',
            catalog_item_id = p_catalog_item_id,
            qty = p_qty,
            reserved_from = p_reserved_from,
            reserved_until = p_reserved_until,
            job_ref = v_job_ref,
            external_order_ref = COALESCE(p_job_id, external_order_ref),
            updated_at = NOW()
        WHERE id = v_existing.id;

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

    -- Reserve where the stock actually is: most available first, then the
    -- default ship-to, then any location at all.
    SELECT location_id INTO v_location
    FROM inventory.stock_balances
    WHERE tenant_id = p_tenant_id AND catalog_item_id = p_catalog_item_id
    ORDER BY qty_available DESC NULLS LAST
    LIMIT 1;
    IF v_location IS NULL THEN
        SELECT id INTO v_location FROM inventory.locations
        WHERE tenant_id = p_tenant_id AND is_default_ship_to = true
        LIMIT 1;
    END IF;
    IF v_location IS NULL THEN
        SELECT id INTO v_location FROM inventory.locations
        WHERE tenant_id = p_tenant_id ORDER BY created_at LIMIT 1;
    END IF;
    IF v_location IS NULL THEN
        RETURN jsonb_build_object('outcome', 'skipped_no_location');
    END IF;

    INSERT INTO inventory.reservations (
        tenant_id, catalog_item_id, location_id, qty,
        reservation_type, allocation_type, commitment_level,
        status, job_ref, external_order_ref,
        reserved_from, reserved_until, notes, last_event_id
    ) VALUES (
        p_tenant_id, p_catalog_item_id, v_location, p_qty,
        'fungible', 'job', 'soft',
        'active', v_job_ref, p_job_id,
        p_reserved_from, p_reserved_until,
        'Mirrored from Operations job material need', v_key
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_reservation_id;

    IF v_reservation_id IS NULL THEN
        SELECT id INTO v_reservation_id
        FROM inventory.reservations
        WHERE tenant_id = p_tenant_id AND last_event_id = v_key;
        RETURN jsonb_build_object('outcome', 'noop', 'reservation_id', v_reservation_id);
    END IF;

    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'reservation.created.fungible',
        p_aggregate_type => 'reservation',
        p_aggregate_id => v_reservation_id,
        p_payload => inventory.reservation_event_payload(p_tenant_id, v_reservation_id)
    );
    RETURN jsonb_build_object('outcome', 'created', 'reservation_id', v_reservation_id);
END;
$function$;

COMMENT ON FUNCTION inventory.rpc_inv_apply_ops_material_hold(uuid, text, text, uuid, numeric, text, text, timestamptz, timestamptz) IS
  'Idempotent apply of an Operations job material need as a fungible job reservation. '
  'Keyed last_event_id = ops-material:<need_id>. Outcomes: created | updated | released | '
  'noop | skipped_unmapped | skipped_no_qty | skipped_no_location.';

REVOKE ALL ON FUNCTION inventory.rpc_inv_apply_ops_material_hold(uuid, text, text, uuid, numeric, text, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inventory.rpc_inv_apply_ops_material_hold(uuid, text, text, uuid, numeric, text, text, timestamptz, timestamptz) TO service_role;
