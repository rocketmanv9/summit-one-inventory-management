-- Fix stock_balances.qty_reserved double-counting + reservation action breakage.
--
-- Root cause: BOTH the per-row trigger `trigger_maintain_stock_reserved` AND the
-- reservation RPCs (rpc_inv_reserve_fungible / fulfill / release / undo_*) mutate
-- stock_balances.qty_reserved. So a single 15-unit reservation incremented
-- reserved by 30 on create, and release (which the trigger ignored — it only
-- handled active->fulfilled/cancelled, never 'released'/'expired') decremented by
-- only 15, leaving a phantom reserved=15 on a released reservation and a negative
-- qty_available (generated as on_hand - reserved). That phantom is what blocked
-- "undo release" with "insufficient stock available to restore the reservation".
--
-- Fix: make the RPCs the single source of truth for qty_reserved.
--   1. Drop the double-counting trigger (the RPCs already cover every transition).
--   2. Teach expire_old_reservations to release reserved qty (the trigger used to
--      be the only — incomplete — place this could have happened).
--   3. Stop undo-release from dead-ending: it's a reversal, so restore the
--      reservation even if current stock is short (negative available is then a
--      truthful "you removed stock after reserving" signal, not a corruption).
--   4. Repair existing balances: recompute qty_reserved from active reservations.

-- 1. Remove the second writer. The function is left in place but unused.
DROP TRIGGER IF EXISTS trigger_maintain_stock_reserved ON inventory.reservations;

-- 2. Expiry must release the reserved qty it frees (fungible only).
CREATE OR REPLACE FUNCTION inventory.expire_old_reservations(p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_count INTEGER;
BEGIN
    -- Capture the fungible reservations about to expire so we can release their
    -- reserved quantity from stock_balances.
    CREATE TEMP TABLE _expiring_res ON COMMIT DROP AS
    SELECT tenant_id, catalog_item_id, location_id, qty
    FROM inventory.reservations
    WHERE status = 'active'
      AND expiration_date IS NOT NULL
      AND expiration_date < CURRENT_DATE
      AND (p_tenant_id IS NULL OR tenant_id = p_tenant_id)
      AND reservation_type = 'fungible'
      AND location_id IS NOT NULL;

    UPDATE inventory.reservations
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'active'
      AND expiration_date IS NOT NULL
      AND expiration_date < CURRENT_DATE
      AND (p_tenant_id IS NULL OR tenant_id = p_tenant_id);

    GET DIAGNOSTICS v_count = ROW_COUNT;

    UPDATE inventory.stock_balances sb
    SET qty_reserved = GREATEST(0, sb.qty_reserved - e.total),
        updated_at = NOW()
    FROM (
        SELECT tenant_id, catalog_item_id, location_id, SUM(qty) AS total
        FROM _expiring_res
        GROUP BY tenant_id, catalog_item_id, location_id
    ) e
    WHERE sb.tenant_id = e.tenant_id
      AND sb.catalog_item_id = e.catalog_item_id
      AND sb.location_id = e.location_id;

    RETURN v_count;
END;
$function$;

-- 3. Undo-release is a reversal; allow it to restore the reservation regardless of
--    current availability (the guard that blocked this is removed). qty_reserved is
--    restored; if on-hand was reduced in the meantime, available simply goes
--    negative, which is a truthful signal rather than a dead end.
CREATE OR REPLACE FUNCTION inventory.rpc_inv_undo_release_reservation(p_tenant_id uuid, p_reservation_id uuid, p_user_id uuid, p_last_event_id text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
        -- Restore qty_reserved (reversal — no availability gate; negative
        -- available is a truthful "stock removed after reserving" signal).
        UPDATE inventory.stock_balances
        SET
            qty_reserved = qty_reserved + v_reservation.qty,
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
            SET
                status = 'assigned',
                updated_at = NOW()
            WHERE id = v_reservation.asset_id
            AND tenant_id = p_tenant_id;
        END;
    ELSE
        RAISE EXCEPTION 'Unknown reservation_type: %', v_reservation.reservation_type;
    END IF;

    UPDATE inventory.reservations
    SET
        status = 'active',
        updated_at = NOW()
    WHERE id = p_reservation_id;

    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'reservation.release_undone',
        p_aggregate_type => 'reservation',
        p_aggregate_id => p_reservation_id,
        p_payload => jsonb_build_object(
            'reservation_id', p_reservation_id,
            'reservation_type', v_reservation.reservation_type,
            'catalog_item_id', v_reservation.catalog_item_id,
            'asset_id', v_reservation.asset_id,
            'qty', v_reservation.qty
        )
    );

    RETURN TRUE;
END;
$function$;

-- 4. Repair: recompute qty_reserved for every balance from its ACTIVE fungible
--    reservations (releases all phantom reserved left by the double-count bug).
UPDATE inventory.stock_balances sb
SET qty_reserved = COALESCE((
        SELECT SUM(r.qty)
        FROM inventory.reservations r
        WHERE r.tenant_id = sb.tenant_id
          AND r.catalog_item_id = sb.catalog_item_id
          AND r.location_id = sb.location_id
          AND r.status = 'active'
          AND r.reservation_type = 'fungible'
    ), 0),
    updated_at = NOW()
WHERE sb.qty_reserved <> COALESCE((
        SELECT SUM(r.qty)
        FROM inventory.reservations r
        WHERE r.tenant_id = sb.tenant_id
          AND r.catalog_item_id = sb.catalog_item_id
          AND r.location_id = sb.location_id
          AND r.status = 'active'
          AND r.reservation_type = 'fungible'
    ), 0);
