-- 20260812000003_reserved_availability_sync.sql
-- Make availability honest: wire reservations -> stock_balances.qty_reserved.
--
-- History / root cause:
--   * 20260611000003 dropped trigger_maintain_stock_reserved (it double-counted
--     against the RPCs' own qty_reserved writes) and made the RPCs the single
--     writer of stock_balances.qty_reserved.
--   * 20260803000001 then added rpc_inv_apply_ops_material_hold (the ops
--     sold-job material mirror), which creates/updates/releases FUNGIBLE
--     reservations but never touches stock_balances at all. Result on stage:
--     qty_reserved stuck at 0 tenant-wide while reservations are active, so the
--     GENERATED qty_available = qty_on_hand - qty_reserved overstates stock on
--     every surface (availability checks, v_items_needing_reorder, the ops
--     job-readiness card, metrics).
--
-- Fix (this migration): a single authoritative, RECOMPUTE-FROM-SCRATCH trigger
-- on inventory.reservations. On any INSERT/UPDATE/DELETE it sets
-- qty_reserved = SUM(qty of ACTIVE FUNGIBLE reservations) for the affected
-- (tenant, item, location) key(s) — both NEW and OLD keys when they differ, so
-- in-place qty edits, item/location moves, and ANY status vocabulary
-- (released / expired / fulfilled / cancelled / whatever comes next) are all
-- handled. Recompute is idempotent, so it cannot double-count.
--
-- Serialized reservations are EXCLUDED from the fungible sum by design: a
-- serialized hold reserves a specific asset_id (asset.status = 'assigned'
-- carries that state); it must not reduce fungible stock availability.
--
-- Writer-ordering cleanup: the reservation RPCs still carry manual
-- qty_reserved writes. Where the manual write runs BEFORE the reservations DML
-- (release / fulfill_issue / undo_release / undo_fulfill) the trigger fires
-- last and overwrites with the recomputed truth — harmless, left untouched.
-- But rpc_inv_reserve and both rpc_inv_reserve_fungible overloads write the
-- balance AFTER inserting the reservation, which would re-add the qty on top
-- of the trigger's correct value. Those three manual writes are removed below;
-- the trigger is now the sole writer on the reserve path.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Recompute helper: absolute truth for one (tenant, item, location) key.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION inventory.recompute_stock_reserved(
    p_tenant_id uuid,
    p_catalog_item_id uuid,
    p_location_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $function$
BEGIN
    IF p_tenant_id IS NULL OR p_catalog_item_id IS NULL OR p_location_id IS NULL THEN
        RETURN;
    END IF;

    -- Ensure the balance row exists so reservations against never-stocked
    -- item/location pairs still surface (on_hand 0 => available goes negative,
    -- which is a truthful shortage signal, not a corruption).
    INSERT INTO inventory.stock_balances (
        tenant_id, catalog_item_id, location_id, qty_on_hand, qty_reserved
    ) VALUES (
        p_tenant_id, p_catalog_item_id, p_location_id, 0, 0
    )
    ON CONFLICT (tenant_id, catalog_item_id, location_id) DO NOTHING;

    -- Take the row lock FIRST. Under READ COMMITTED the UPDATE below then runs
    -- on a fresh statement snapshot that includes whatever a concurrent
    -- transaction committed while we waited on this lock — that is what makes
    -- concurrent recomputes converge on the correct sum instead of losing
    -- updates.
    PERFORM 1
    FROM inventory.stock_balances
    WHERE tenant_id = p_tenant_id
      AND catalog_item_id = p_catalog_item_id
      AND location_id = p_location_id
    FOR UPDATE;

    UPDATE inventory.stock_balances sb
    SET qty_reserved = COALESCE((
            SELECT SUM(r.qty)
            FROM inventory.reservations r
            WHERE r.tenant_id = p_tenant_id
              AND r.catalog_item_id = p_catalog_item_id
              AND r.location_id = p_location_id
              AND r.status = 'active'
              AND r.reservation_type = 'fungible'
        ), 0),
        updated_at = NOW()
    WHERE sb.tenant_id = p_tenant_id
      AND sb.catalog_item_id = p_catalog_item_id
      AND sb.location_id = p_location_id;
END;
$function$;

COMMENT ON FUNCTION inventory.recompute_stock_reserved(uuid, uuid, uuid) IS
  'Sets stock_balances.qty_reserved to the absolute SUM of active fungible '
  'reservations for one (tenant, item, location) key. Locks the balance row '
  'before recomputing so concurrent callers serialize correctly. Serialized '
  'reservations are excluded by design (they hold a specific asset, not '
  'fungible qty).';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Trigger function: recompute affected key(s) on any reservation change.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION inventory.maintain_stock_reserved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $function$
BEGIN
    -- NEW side (INSERT / UPDATE): recompute the key the row now points at.
    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.reservation_type = 'fungible' THEN
        PERFORM inventory.recompute_stock_reserved(
            NEW.tenant_id, NEW.catalog_item_id, NEW.location_id
        );
    END IF;

    -- OLD side (UPDATE / DELETE): if the row left a different key (moved
    -- item/location, changed type) or disappeared, recompute that key too.
    IF TG_OP = 'DELETE' AND OLD.reservation_type = 'fungible' THEN
        PERFORM inventory.recompute_stock_reserved(
            OLD.tenant_id, OLD.catalog_item_id, OLD.location_id
        );
    ELSIF TG_OP = 'UPDATE' AND OLD.reservation_type = 'fungible' THEN
        IF NEW.reservation_type IS DISTINCT FROM 'fungible'
           OR (OLD.tenant_id, OLD.catalog_item_id, OLD.location_id)
              IS DISTINCT FROM (NEW.tenant_id, NEW.catalog_item_id, NEW.location_id) THEN
            PERFORM inventory.recompute_stock_reserved(
                OLD.tenant_id, OLD.catalog_item_id, OLD.location_id
            );
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$function$;

COMMENT ON FUNCTION inventory.maintain_stock_reserved() IS
  'Recompute-from-scratch sync of stock_balances.qty_reserved on any '
  'reservations change. Robust to every status vocabulary, in-place qty '
  'edits, and item/location moves (recomputes both OLD and NEW keys). '
  'Attached as trg_maintain_stock_reserved (20260812000003).';

DROP TRIGGER IF EXISTS trg_maintain_stock_reserved ON inventory.reservations;
DROP TRIGGER IF EXISTS trigger_maintain_stock_reserved ON inventory.reservations;

CREATE TRIGGER trg_maintain_stock_reserved
AFTER INSERT OR UPDATE OR DELETE ON inventory.reservations
FOR EACH ROW EXECUTE FUNCTION inventory.maintain_stock_reserved();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Remove the double-count hazard: the three reserve RPCs wrote the balance
--    AFTER inserting the reservation (so the manual increment would land on
--    top of the trigger's already-correct recompute). The trigger now owns the
--    reserve-path balance write; the RPCs' bodies are otherwise unchanged.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION inventory.rpc_inv_reserve(
    p_tenant_id uuid, p_catalog_item_id uuid, p_location_id uuid, p_qty numeric,
    p_allocation_type text DEFAULT NULL::text, p_job_ref jsonb DEFAULT NULL::jsonb,
    p_external_order_ref text DEFAULT NULL::text, p_needed_by date DEFAULT NULL::date,
    p_expiration_date date DEFAULT NULL::date, p_last_event_id text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $function$
DECLARE
    v_reservation_id UUID;
    v_event_id TEXT;
    v_available_qty NUMERIC;
BEGIN
    -- Validate
    IF p_tenant_id IS NULL OR p_catalog_item_id IS NULL OR p_location_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id, catalog_item_id, and location_id are required';
    END IF;

    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'qty must be greater than 0';
    END IF;

    -- Require event ID for strict idempotency
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required';
    END IF;
    v_event_id := p_last_event_id;

    -- Check available quantity
    SELECT COALESCE(qty_available, 0) INTO v_available_qty
    FROM inventory.stock_balances
    WHERE tenant_id = p_tenant_id
    AND catalog_item_id = p_catalog_item_id
    AND location_id = p_location_id;

    IF v_available_qty < p_qty THEN
        RAISE EXCEPTION 'Insufficient available quantity: % available, % requested',
            v_available_qty, p_qty;
    END IF;

    -- Create reservation (idempotent). trg_maintain_stock_reserved recomputes
    -- stock_balances.qty_reserved from this insert — no manual balance write.
    -- (reservation_type added: the column is NOT NULL with no default, so the
    -- previous body could never insert successfully — legacy fix in passing.)
    INSERT INTO inventory.reservations (
        tenant_id,
        catalog_item_id,
        location_id,
        qty,
        reservation_type,
        status,
        allocation_type,
        job_ref,
        external_order_ref,
        needed_by,
        expiration_date,
        last_event_id
    ) VALUES (
        p_tenant_id,
        p_catalog_item_id,
        p_location_id,
        p_qty,
        'fungible',
        'active',
        p_allocation_type,
        p_job_ref,
        p_external_order_ref,
        p_needed_by,
        p_expiration_date,
        v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_reservation_id;

    -- If no ID returned, reservation already exists
    IF v_reservation_id IS NULL THEN
        SELECT id INTO v_reservation_id
        FROM inventory.reservations
        WHERE tenant_id = p_tenant_id
        AND last_event_id = v_event_id;

        RETURN v_reservation_id;
    END IF;

    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'inventory',
        p_event_type => 'reservation.created',
        p_aggregate_type => 'reservation',
        p_aggregate_id => v_reservation_id,
        p_payload => jsonb_build_object(
            'reservation_id', v_reservation_id,
            'catalog_item_id', p_catalog_item_id,
            'location_id', p_location_id,
            'qty', p_qty,
            'allocation_type', p_allocation_type,
            'external_order_ref', p_external_order_ref
        )
    );

    RETURN v_reservation_id;
END;
$function$;

-- 13-arg overload (no destination_location_id)
CREATE OR REPLACE FUNCTION inventory.rpc_inv_reserve_fungible(
    p_tenant_id uuid, p_catalog_item_id uuid, p_location_id uuid, p_qty numeric,
    p_allocation_type text DEFAULT NULL::text, p_job_ref jsonb DEFAULT NULL::jsonb,
    p_external_order_ref text DEFAULT NULL::text, p_needed_by date DEFAULT NULL::date,
    p_expiration_date date DEFAULT NULL::date,
    p_reserved_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
    p_reserved_until timestamp with time zone DEFAULT NULL::timestamp with time zone,
    p_notes text DEFAULT NULL::text, p_last_event_id text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $function$
DECLARE
    v_reservation_id UUID;
    v_event_id TEXT;
    v_validation RECORD;
BEGIN
    -- Validate inputs
    IF p_tenant_id IS NULL OR p_catalog_item_id IS NULL OR p_location_id IS NULL OR p_qty IS NULL THEN
        RAISE EXCEPTION 'tenant_id, catalog_item_id, location_id, and qty are required'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'qty must be greater than 0'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Require event ID for strict idempotency
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_event_id := p_last_event_id;

    -- Validate availability
    SELECT * INTO v_validation
    FROM inventory.validate_fungible_reservation_availability(
        p_tenant_id,
        p_catalog_item_id,
        p_location_id,
        p_qty
    );

    IF NOT v_validation.is_available THEN
        RAISE EXCEPTION '%', v_validation.message
        USING ERRCODE = 'check_violation',
              HINT = 'Check stock levels or receive more inventory';
    END IF;

    -- Create reservation (idempotent on last_event_id).
    -- trg_maintain_stock_reserved recomputes stock_balances.qty_reserved from
    -- this insert — no manual balance write.
    INSERT INTO inventory.reservations (
        tenant_id,
        catalog_item_id,
        location_id,
        qty,
        asset_id,
        reservation_type,
        status,
        allocation_type,
        job_ref,
        external_order_ref,
        needed_by,
        expiration_date,
        reserved_from,
        reserved_until,
        notes,
        last_event_id
    ) VALUES (
        p_tenant_id,
        p_catalog_item_id,
        p_location_id,
        p_qty,
        NULL, -- No asset_id for fungible
        'fungible',
        'active',
        p_allocation_type,
        p_job_ref,
        p_external_order_ref,
        p_needed_by,
        p_expiration_date,
        p_reserved_from,
        p_reserved_until,
        p_notes,
        v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_reservation_id;

    -- If no ID returned, reservation already exists (idempotent)
    IF v_reservation_id IS NULL THEN
        SELECT id INTO v_reservation_id
        FROM inventory.reservations
        WHERE tenant_id = p_tenant_id
          AND last_event_id = v_event_id;

        RETURN v_reservation_id;
    END IF;

    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'reservation.created.fungible',
        p_aggregate_type => 'reservation',
        p_aggregate_id => v_reservation_id,
        p_payload => jsonb_build_object(
            'reservation_id', v_reservation_id,
            'reservation_type', 'fungible',
            'catalog_item_id', p_catalog_item_id,
            'location_id', p_location_id,
            'qty', p_qty,
            'allocation_type', p_allocation_type,
            'external_order_ref', p_external_order_ref,
            'reserved_from', p_reserved_from,
            'reserved_until', p_reserved_until
        )
    );

    RETURN v_reservation_id;
END;
$function$;

-- 14-arg overload (with destination_location_id)
CREATE OR REPLACE FUNCTION inventory.rpc_inv_reserve_fungible(
    p_tenant_id uuid, p_catalog_item_id uuid, p_location_id uuid, p_qty numeric,
    p_allocation_type text DEFAULT NULL::text, p_job_ref jsonb DEFAULT NULL::jsonb,
    p_external_order_ref text DEFAULT NULL::text, p_needed_by date DEFAULT NULL::date,
    p_expiration_date date DEFAULT NULL::date,
    p_reserved_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
    p_reserved_until timestamp with time zone DEFAULT NULL::timestamp with time zone,
    p_notes text DEFAULT NULL::text, p_destination_location_id uuid DEFAULT NULL::uuid,
    p_last_event_id text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $function$
DECLARE
    v_reservation_id UUID;
    v_event_id TEXT;
    v_validation RECORD;
BEGIN
    -- Validate inputs
    IF p_tenant_id IS NULL OR p_catalog_item_id IS NULL OR p_location_id IS NULL OR p_qty IS NULL THEN
        RAISE EXCEPTION 'tenant_id, catalog_item_id, location_id, and qty are required'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'qty must be greater than 0'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Require event ID for strict idempotency
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_event_id := p_last_event_id;

    -- Validate availability
    SELECT * INTO v_validation
    FROM inventory.validate_fungible_reservation_availability(
        p_tenant_id,
        p_catalog_item_id,
        p_location_id,
        p_qty
    );

    IF NOT v_validation.is_available THEN
        RAISE EXCEPTION '%', v_validation.message
        USING ERRCODE = 'check_violation',
              HINT = 'Check stock levels or receive more inventory';
    END IF;

    -- Create reservation (idempotent on last_event_id).
    -- trg_maintain_stock_reserved recomputes stock_balances.qty_reserved from
    -- this insert — no manual balance write.
    INSERT INTO inventory.reservations (
        tenant_id,
        catalog_item_id,
        location_id,
        destination_location_id,
        qty,
        asset_id,
        reservation_type,
        status,
        allocation_type,
        job_ref,
        external_order_ref,
        needed_by,
        expiration_date,
        reserved_from,
        reserved_until,
        notes,
        last_event_id
    ) VALUES (
        p_tenant_id,
        p_catalog_item_id,
        p_location_id,
        p_destination_location_id,
        p_qty,
        NULL,
        'fungible',
        'active',
        p_allocation_type,
        p_job_ref,
        p_external_order_ref,
        p_needed_by,
        p_expiration_date,
        p_reserved_from,
        p_reserved_until,
        p_notes,
        v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_reservation_id;

    -- If no ID returned, reservation already exists (idempotent)
    IF v_reservation_id IS NULL THEN
        SELECT id INTO v_reservation_id
        FROM inventory.reservations
        WHERE tenant_id = p_tenant_id
          AND last_event_id = v_event_id;

        RETURN v_reservation_id;
    END IF;

    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'reservation.created.fungible',
        p_aggregate_type => 'reservation',
        p_aggregate_id => v_reservation_id,
        p_payload => jsonb_build_object(
            'reservation_id', v_reservation_id,
            'reservation_type', 'fungible',
            'catalog_item_id', p_catalog_item_id,
            'location_id', p_location_id,
            'destination_location_id', p_destination_location_id,
            'qty', p_qty,
            'allocation_type', p_allocation_type,
            'external_order_ref', p_external_order_ref,
            'reserved_from', p_reserved_from,
            'reserved_until', p_reserved_until
        )
    );

    RETURN v_reservation_id;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Backfill: create any missing balance rows for active fungible
--    reservations, then recompute qty_reserved for every balance row that is
--    out of sync (this zeroes phantom reserved AND surfaces the stuck-at-0s).
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO inventory.stock_balances (
    tenant_id, catalog_item_id, location_id, qty_on_hand, qty_reserved
)
SELECT DISTINCT r.tenant_id, r.catalog_item_id, r.location_id, 0, 0
FROM inventory.reservations r
WHERE r.status = 'active'
  AND r.reservation_type = 'fungible'
ON CONFLICT (tenant_id, catalog_item_id, location_id) DO NOTHING;

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
