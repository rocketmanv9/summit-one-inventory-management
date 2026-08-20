-- 20260820000001_ops_hold_mirror_tombstone_gc.sql
-- Ops equipment-hold mirror: stop the unbounded pile of 'released' tombstones
-- and stop showing raw job UUIDs (Grant, 2026-08-20).
--
-- BACKGROUND. rpc_inv_apply_ops_equipment_hold keys each mirror row by
-- last_event_id = 'ops-hold:<assignment_id>'. Operations mints a NEW
-- assignment_id every time a job is re-dispatched, so a re-plan can't be
-- recognized as the same hold: the supersede step marks the prior active row
-- 'released' and a fresh 'active' row is inserted. The live state stays correct
-- (one active row per asset), but the released tombstones accumulate forever —
-- on stage: 102 released rows for only 28 real asset/job pairs — and the
-- Reservations page rendered every one of them.
--
-- THIS MIGRATION:
--   1. GC — on every upsert, delete prior *released* ops-mirror tombstones for
--      the same asset (mirror shadows: never fulfilled, no stock movements).
--      Bounds tombstone growth instead of letting it run unbounded.
--   2. job_name retention — Operations frequently emits equipment.requested
--      WITHOUT job_name; on update, keep the previously-known job_id/job_name
--      instead of nulling them out (which is what surfaced raw UUIDs in the
--      "Job/Order" column). New rows still depend on Ops sending a name.
--   3. One-time purge of the existing tombstone backlog at the bottom.
--
-- Applied to inventory stage via MCP the same day.

CREATE OR REPLACE FUNCTION inventory.rpc_inv_apply_ops_equipment_hold(p_tenant_id uuid, p_op text, p_assignment_id text, p_fleet_asset_id uuid DEFAULT NULL::uuid, p_job_id text DEFAULT NULL::text, p_job_name text DEFAULT NULL::text, p_reserved_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reserved_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $function$
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

    SELECT id, status, asset_id, job_ref INTO v_existing
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

    -- A manual (non-ops) active reservation keeps the asset — ops yields.
    PERFORM 1 FROM inventory.reservations r
    WHERE r.tenant_id = p_tenant_id AND r.asset_id = v_asset.id AND r.status = 'active'
      AND r.last_event_id IS DISTINCT FROM v_key
      AND COALESCE(r.job_ref ->> 'source', '') <> 'operations';
    IF FOUND THEN
        RETURN jsonb_build_object('outcome', 'conflict_manual_reservation');
    END IF;

    -- Supersede stale OPS mirror rows on the same asset: a released +
    -- re-reserved hold mints a new assignment id, so the old key's active
    -- row would otherwise trip the one-active-reservation-per-asset index.
    UPDATE inventory.reservations r
    SET status = 'released', updated_at = NOW(),
        notes = COALESCE(r.notes, '') || ' [superseded by ' || v_key || ']'
    WHERE r.tenant_id = p_tenant_id AND r.asset_id = v_asset.id AND r.status = 'active'
      AND r.last_event_id IS DISTINCT FROM v_key
      AND r.job_ref ->> 'source' = 'operations';

    -- GC: purge prior *released* ops-mirror tombstones for this asset. They are
    -- pure mirror shadows (serialized holds, never fulfilled, no movements), so
    -- deletion is safe and keeps the tombstone count from growing without bound
    -- as jobs are re-dispatched. The current key's own row is left untouched.
    DELETE FROM inventory.reservations r
    WHERE r.tenant_id = p_tenant_id
      AND r.asset_id = v_asset.id
      AND r.status = 'released'
      AND r.last_event_id LIKE 'ops-hold:%'
      AND r.last_event_id IS DISTINCT FROM v_key
      AND r.fulfilled_at IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM inventory.stock_movements m
          WHERE m.source_ref_type = 'reservation' AND m.source_ref_id = r.id
      );

    -- Retain the last-known job_id/job_name when Operations omits them on a
    -- later event (common: equipment.requested arrives with job_name null), so
    -- the "Job/Order" column keeps its readable name instead of a raw UUID.
    v_job_ref := jsonb_strip_nulls(jsonb_build_object(
        'source', 'operations',
        'job_id', COALESCE(p_job_id, v_existing.job_ref ->> 'job_id'),
        'job_name', COALESCE(p_job_name, v_existing.job_ref ->> 'job_name')
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
        EXCEPTION WHEN exclusion_violation OR unique_violation THEN
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
    EXCEPTION WHEN exclusion_violation OR unique_violation THEN
        RETURN jsonb_build_object('outcome', 'conflict');
    END;

    IF v_reservation_id IS NULL THEN
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
$function$;

-- ── One-time purge of the accumulated tombstone backlog ──────────────────────
-- Every 'released' ops-mirror shadow: never fulfilled, no stock movements.
-- Live holds ('active') and any manual/non-ops reservations are untouched.
DELETE FROM inventory.reservations r
WHERE r.last_event_id LIKE 'ops-hold:%'
  AND r.status = 'released'
  AND r.fulfilled_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM inventory.stock_movements m
      WHERE m.source_ref_type = 'reservation' AND m.source_ref_id = r.id
  );
