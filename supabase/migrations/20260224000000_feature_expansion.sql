-- =============================================================================
-- Feature Expansion Migration
-- Date: 2026-02-24
-- Features: UOM conversions, location capacity, negative inventory config,
--           reservation enhancements, dead stock view, item velocity,
--           replenishment suggestions, transfer optimization, cycle count
--           suggestions, ledger running balance, inventory forecast
-- =============================================================================

-- ============================================================
-- 1A. Multi-UOM Conversion System (#11)
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory.uom_conversions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    from_uom        text NOT NULL,
    to_uom          text NOT NULL,
    conversion_factor numeric(18,8) NOT NULL CHECK (conversion_factor > 0),
    is_bidirectional boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by_user_id uuid,
    last_event_id   text NOT NULL DEFAULT gen_random_uuid()::text,
    CONSTRAINT uom_conversions_unique UNIQUE (tenant_id, from_uom, to_uom),
    CONSTRAINT uom_conversions_event_unique UNIQUE (last_event_id)
);

CREATE INDEX idx_uom_conversions_tenant ON inventory.uom_conversions (tenant_id);

ALTER TABLE inventory.uom_conversions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uom_conversions_service_role ON inventory.uom_conversions;
CREATE POLICY uom_conversions_service_role
    ON inventory.uom_conversions TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS uom_conversions_tenant_isolation ON inventory.uom_conversions;
CREATE POLICY uom_conversions_tenant_isolation
    ON inventory.uom_conversions TO authenticated
    USING (tenant_id = public.current_tenant_id())
    WITH CHECK (tenant_id = public.current_tenant_id());

-- UOM conversion function: direct, reverse, or chained (A->B->C)
CREATE OR REPLACE FUNCTION inventory.convert_uom(
    p_tenant_id uuid,
    p_qty       numeric,
    p_from_uom  text,
    p_to_uom    text
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
    v_factor numeric;
    v_intermediate text;
    v_factor_a numeric;
    v_factor_b numeric;
BEGIN
    -- Same UOM, no conversion needed
    IF upper(p_from_uom) = upper(p_to_uom) THEN
        RETURN p_qty;
    END IF;

    -- Try direct conversion
    SELECT conversion_factor INTO v_factor
    FROM inventory.uom_conversions
    WHERE tenant_id = p_tenant_id
      AND upper(from_uom) = upper(p_from_uom)
      AND upper(to_uom) = upper(p_to_uom);

    IF v_factor IS NOT NULL THEN
        RETURN p_qty * v_factor;
    END IF;

    -- Try reverse conversion (bidirectional)
    SELECT 1.0 / conversion_factor INTO v_factor
    FROM inventory.uom_conversions
    WHERE tenant_id = p_tenant_id
      AND upper(from_uom) = upper(p_to_uom)
      AND upper(to_uom) = upper(p_from_uom)
      AND is_bidirectional = true;

    IF v_factor IS NOT NULL THEN
        RETURN p_qty * v_factor;
    END IF;

    -- Try chained conversion (A -> intermediate -> B)
    SELECT a.to_uom, a.conversion_factor, b.conversion_factor
    INTO v_intermediate, v_factor_a, v_factor_b
    FROM inventory.uom_conversions a
    JOIN inventory.uom_conversions b
      ON b.tenant_id = a.tenant_id
      AND upper(b.from_uom) = upper(a.to_uom)
      AND upper(b.to_uom) = upper(p_to_uom)
    WHERE a.tenant_id = p_tenant_id
      AND upper(a.from_uom) = upper(p_from_uom)
    LIMIT 1;

    IF v_factor_a IS NOT NULL AND v_factor_b IS NOT NULL THEN
        RETURN p_qty * v_factor_a * v_factor_b;
    END IF;

    RAISE EXCEPTION 'No UOM conversion path found from % to % for tenant %', p_from_uom, p_to_uom, p_tenant_id;
END;
$$;

-- Seed common conversions (will be inserted per-tenant via app, but provide an RPC helper)
-- Tenants can add these via the UI


-- ============================================================
-- 1B. Location Capacity Tracking (#6)
-- ============================================================

ALTER TABLE inventory.locations
    ADD COLUMN IF NOT EXISTS max_capacity numeric(18,4),
    ADD COLUMN IF NOT EXISTS capacity_uom text;

COMMENT ON COLUMN inventory.locations.max_capacity IS 'Maximum storage capacity. NULL means unlimited.';
COMMENT ON COLUMN inventory.locations.capacity_uom IS 'Unit for capacity: pallet, sqft, unit, etc.';

-- Location utilization view
CREATE OR REPLACE VIEW inventory.v_location_utilization AS
SELECT
    l.tenant_id,
    l.id AS location_id,
    l.name AS location_name,
    lt.name AS location_type,
    l.max_capacity,
    l.capacity_uom,
    COALESCE(SUM(sb.qty_on_hand), 0) AS current_qty,
    CASE
        WHEN l.max_capacity IS NOT NULL AND l.max_capacity > 0
        THEN ROUND(COALESCE(SUM(sb.qty_on_hand), 0) / l.max_capacity * 100, 1)
        ELSE NULL
    END AS utilization_pct,
    CASE
        WHEN l.max_capacity IS NOT NULL AND COALESCE(SUM(sb.qty_on_hand), 0) > l.max_capacity
        THEN true
        ELSE false
    END AS is_over_capacity,
    l.active
FROM inventory.locations l
LEFT JOIN inventory.location_types lt ON lt.id = l.location_type_id AND lt.tenant_id = l.tenant_id
LEFT JOIN inventory.stock_balances sb ON sb.location_id = l.id AND sb.tenant_id = l.tenant_id
GROUP BY l.tenant_id, l.id, l.name, lt.name, l.max_capacity, l.capacity_uom, l.active;


-- ============================================================
-- 1C. Negative Inventory Guardrails (#13)
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory.negative_inventory_config (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    scope           text NOT NULL CHECK (scope IN ('global', 'category', 'item')),
    category_id     uuid REFERENCES inventory.item_categories(id),
    catalog_item_id uuid REFERENCES inventory.catalog_items(id),
    allow_negative  boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    last_event_id   text NOT NULL DEFAULT gen_random_uuid()::text,
    CONSTRAINT negative_inv_config_event_unique UNIQUE (last_event_id),
    CONSTRAINT negative_inv_config_scope_check CHECK (
        (scope = 'global' AND category_id IS NULL AND catalog_item_id IS NULL) OR
        (scope = 'category' AND category_id IS NOT NULL AND catalog_item_id IS NULL) OR
        (scope = 'item' AND catalog_item_id IS NOT NULL)
    )
);

CREATE INDEX idx_negative_inv_config_tenant ON inventory.negative_inventory_config (tenant_id, scope);

CREATE UNIQUE INDEX idx_negative_inv_config_scope_unique
    ON inventory.negative_inventory_config (
        tenant_id, scope,
        COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(catalog_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

ALTER TABLE inventory.negative_inventory_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS negative_inv_config_service_role ON inventory.negative_inventory_config;
CREATE POLICY negative_inv_config_service_role
    ON inventory.negative_inventory_config TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS negative_inv_config_tenant_isolation ON inventory.negative_inventory_config;
CREATE POLICY negative_inv_config_tenant_isolation
    ON inventory.negative_inventory_config TO authenticated
    USING (tenant_id = public.current_tenant_id())
    WITH CHECK (tenant_id = public.current_tenant_id());

-- Check if negative inventory is allowed for a given item
CREATE OR REPLACE FUNCTION inventory.check_negative_allowed(
    p_tenant_id      uuid,
    p_catalog_item_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
    v_allowed boolean;
    v_category_id uuid;
BEGIN
    -- Check item-level config first
    SELECT allow_negative INTO v_allowed
    FROM inventory.negative_inventory_config
    WHERE tenant_id = p_tenant_id
      AND scope = 'item'
      AND catalog_item_id = p_catalog_item_id;

    IF v_allowed IS NOT NULL THEN
        RETURN v_allowed;
    END IF;

    -- Check category-level config
    SELECT category_id INTO v_category_id
    FROM inventory.catalog_items
    WHERE id = p_catalog_item_id AND tenant_id = p_tenant_id;

    IF v_category_id IS NOT NULL THEN
        SELECT allow_negative INTO v_allowed
        FROM inventory.negative_inventory_config
        WHERE tenant_id = p_tenant_id
          AND scope = 'category'
          AND category_id = v_category_id;

        IF v_allowed IS NOT NULL THEN
            RETURN v_allowed;
        END IF;
    END IF;

    -- Check global config
    SELECT allow_negative INTO v_allowed
    FROM inventory.negative_inventory_config
    WHERE tenant_id = p_tenant_id
      AND scope = 'global';

    IF v_allowed IS NOT NULL THEN
        RETURN v_allowed;
    END IF;

    -- Default: negative inventory NOT allowed
    RETURN false;
END;
$$;

-- Update maintain_stock_balances to use the negative inventory config
CREATE OR REPLACE FUNCTION inventory.maintain_stock_balances() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO inventory.stock_balances (
        tenant_id,
        catalog_item_id,
        location_id,
        qty_on_hand
    ) VALUES (
        NEW.tenant_id,
        NEW.catalog_item_id,
        NEW.location_id,
        GREATEST(0, NEW.quantity_delta)
    )
    ON CONFLICT (tenant_id, catalog_item_id, location_id)
    DO UPDATE SET
        qty_on_hand = inventory.stock_balances.qty_on_hand + NEW.quantity_delta,
        updated_at = NOW();

    -- Check negative inventory config before rejecting
    IF (SELECT qty_on_hand FROM inventory.stock_balances
        WHERE tenant_id = NEW.tenant_id
        AND catalog_item_id = NEW.catalog_item_id
        AND location_id = NEW.location_id) < 0 THEN

        -- Check if negative inventory is allowed for this item
        IF NOT inventory.check_negative_allowed(NEW.tenant_id, NEW.catalog_item_id) THEN
            -- Roll back the balance change
            UPDATE inventory.stock_balances
            SET qty_on_hand = inventory.stock_balances.qty_on_hand - NEW.quantity_delta,
                updated_at = NOW()
            WHERE tenant_id = NEW.tenant_id
              AND catalog_item_id = NEW.catalog_item_id
              AND location_id = NEW.location_id;

            RAISE EXCEPTION 'Insufficient stock: Cannot deduct % units from location. Negative inventory is not allowed for this item.',
                ABS(NEW.quantity_delta);
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


-- ============================================================
-- 1D. Soft vs Hard Reservations (#5)
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'inventory' AND table_name = 'reservations' AND column_name = 'commitment_level'
    ) THEN
        ALTER TABLE inventory.reservations
            ADD COLUMN commitment_level text NOT NULL DEFAULT 'soft';
        ALTER TABLE inventory.reservations
            ADD CONSTRAINT reservations_commitment_level_check CHECK (commitment_level IN ('soft', 'hard'));
    END IF;
END $$;

COMMENT ON COLUMN inventory.reservations.commitment_level IS 'soft = intent (can be bumped), hard = committed to job (protected)';


-- ============================================================
-- 1E. Reservation Conflict Engine (#4)
-- ============================================================

-- Prevent double-booking of serialized assets
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_active_asset
    ON inventory.reservations (tenant_id, asset_id)
    WHERE status = 'active' AND asset_id IS NOT NULL;

-- Check reservation availability for fungible items
CREATE OR REPLACE FUNCTION inventory.check_reservation_availability(
    p_tenant_id       uuid,
    p_catalog_item_id uuid,
    p_location_id     uuid,
    p_qty             numeric
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
    v_qty_available numeric;
    v_qty_after numeric;
    v_conflicts jsonb;
BEGIN
    -- Get current available qty
    SELECT COALESCE(sb.qty_available, 0) INTO v_qty_available
    FROM inventory.stock_balances sb
    WHERE sb.tenant_id = p_tenant_id
      AND sb.catalog_item_id = p_catalog_item_id
      AND sb.location_id = p_location_id;

    -- If no stock balance row exists, available = 0
    IF v_qty_available IS NULL THEN
        v_qty_available := 0;
    END IF;

    v_qty_after := v_qty_available - p_qty;

    -- Get conflicting reservations if over-reserved
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'reservation_id', r.id,
        'qty', r.qty,
        'commitment_level', r.commitment_level,
        'allocation_type', r.allocation_type,
        'needed_by', r.needed_by,
        'job_ref', r.job_ref
    )), '[]'::jsonb)
    INTO v_conflicts
    FROM inventory.reservations r
    WHERE r.tenant_id = p_tenant_id
      AND r.catalog_item_id = p_catalog_item_id
      AND r.location_id = p_location_id
      AND r.status = 'active';

    RETURN jsonb_build_object(
        'available', v_qty_after >= 0,
        'qty_available', v_qty_available,
        'qty_after_reserve', v_qty_after,
        'conflicts', v_conflicts
    );
END;
$$;


-- ============================================================
-- 1F. Dead Stock / Aged Inventory View (#8)
-- ============================================================

CREATE OR REPLACE VIEW inventory.v_dead_stock_report AS
SELECT
    sb.tenant_id,
    sb.catalog_item_id,
    ci.sku,
    ci.name AS item_name,
    sb.location_id,
    l.name AS location_name,
    sb.qty_on_hand,
    sb.qty_on_hand * COALESCE(vi.unit_cost, 0) AS capital_locked,
    MAX(sm.occurred_at) AS last_movement_at,
    EXTRACT(days FROM NOW() - MAX(sm.occurred_at))::int AS days_since_movement,
    CASE
        WHEN MAX(sm.occurred_at) < NOW() - INTERVAL '365 days' THEN 'critical'
        WHEN MAX(sm.occurred_at) < NOW() - INTERVAL '180 days' THEN 'warning'
        WHEN MAX(sm.occurred_at) < NOW() - INTERVAL '90 days' THEN 'stale'
        ELSE 'active'
    END AS aging_status
FROM inventory.stock_balances sb
JOIN inventory.catalog_items ci ON ci.id = sb.catalog_item_id AND ci.tenant_id = sb.tenant_id
JOIN inventory.locations l ON l.id = sb.location_id AND l.tenant_id = sb.tenant_id
LEFT JOIN inventory.stock_movements sm
    ON sm.catalog_item_id = sb.catalog_item_id
    AND sm.location_id = sb.location_id
    AND sm.tenant_id = sb.tenant_id
LEFT JOIN supply_chain.vendor_items vi
    ON vi.catalog_item_id = sb.catalog_item_id
    AND vi.tenant_id = sb.tenant_id
WHERE sb.qty_on_hand > 0
GROUP BY sb.tenant_id, sb.catalog_item_id, ci.sku, ci.name,
         sb.location_id, l.name, sb.qty_on_hand, vi.unit_cost;


-- ============================================================
-- 1G. Smart Replenishment / Usage Velocity (#3)
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS inventory.mv_item_velocity AS
SELECT
    sm.tenant_id,
    sm.catalog_item_id,
    sm.location_id,
    SUM(ABS(sm.quantity_delta)) FILTER (WHERE sm.occurred_at > NOW() - INTERVAL '30 days') AS usage_30d,
    SUM(ABS(sm.quantity_delta)) FILTER (WHERE sm.occurred_at > NOW() - INTERVAL '60 days') AS usage_60d,
    SUM(ABS(sm.quantity_delta)) FILTER (WHERE sm.occurred_at > NOW() - INTERVAL '90 days') AS usage_90d,
    COALESCE(
        SUM(ABS(sm.quantity_delta)) FILTER (WHERE sm.occurred_at > NOW() - INTERVAL '30 days') / NULLIF(30.0, 0),
        0
    ) AS daily_rate_30d,
    CASE
        WHEN COALESCE(SUM(ABS(sm.quantity_delta)) FILTER (WHERE sm.occurred_at > NOW() - INTERVAL '30 days') / NULLIF(30.0, 0), 0) > 0
        THEN ROUND(sb.qty_available / (SUM(ABS(sm.quantity_delta)) FILTER (WHERE sm.occurred_at > NOW() - INTERVAL '30 days') / 30.0), 1)
        ELSE NULL
    END AS days_of_stock,
    sb.qty_available,
    NOW() AS refreshed_at
FROM inventory.stock_movements sm
JOIN inventory.stock_balances sb
    ON sb.tenant_id = sm.tenant_id
    AND sb.catalog_item_id = sm.catalog_item_id
    AND sb.location_id = sm.location_id
WHERE sm.movement_type IN ('issued', 'consumed', 'transferred_out')
  AND sm.posting_status = 'posted'
  AND sm.occurred_at > NOW() - INTERVAL '90 days'
GROUP BY sm.tenant_id, sm.catalog_item_id, sm.location_id, sb.qty_available;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_item_velocity_pk
    ON inventory.mv_item_velocity (tenant_id, catalog_item_id, location_id);

-- Replenishment suggestions function
CREATE OR REPLACE FUNCTION inventory.get_replenishment_suggestions(p_tenant_id uuid)
RETURNS TABLE (
    catalog_item_id uuid,
    sku text,
    item_name text,
    location_id uuid,
    location_name text,
    qty_available numeric,
    daily_rate numeric,
    days_of_stock numeric,
    lead_time_days int,
    reorder_point numeric,
    suggested_order_qty numeric,
    urgency text,
    preferred_vendor_id uuid,
    preferred_vendor_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ci.id AS catalog_item_id,
        ci.sku,
        ci.name AS item_name,
        v.location_id,
        l.name AS location_name,
        v.qty_available,
        v.daily_rate_30d AS daily_rate,
        v.days_of_stock,
        ci.lead_time_days,
        ci.reorder_point,
        GREATEST(
            COALESCE(ci.reorder_qty, 0),
            COALESCE(v.daily_rate_30d * COALESCE(ci.lead_time_days, 7), 0)
        ) AS suggested_order_qty,
        CASE
            WHEN v.days_of_stock IS NOT NULL AND v.days_of_stock < COALESCE(ci.lead_time_days, 7) THEN 'critical'
            WHEN v.days_of_stock IS NOT NULL AND v.days_of_stock < COALESCE(ci.lead_time_days, 7) * 1.5 THEN 'high'
            WHEN v.qty_available <= COALESCE(ci.reorder_point, 0) THEN 'medium'
            ELSE 'low'
        END AS urgency,
        ci.preferred_vendor_id,
        vn.name AS preferred_vendor_name
    FROM inventory.mv_item_velocity v
    JOIN inventory.catalog_items ci ON ci.id = v.catalog_item_id AND ci.tenant_id = v.tenant_id
    JOIN inventory.locations l ON l.id = v.location_id AND l.tenant_id = v.tenant_id
    LEFT JOIN supply_chain.vendors vn ON vn.id = ci.preferred_vendor_id AND vn.tenant_id = v.tenant_id
    WHERE v.tenant_id = p_tenant_id
      AND ci.active = true
      AND (
          v.qty_available <= COALESCE(ci.reorder_point, 0)
          OR (v.days_of_stock IS NOT NULL AND v.days_of_stock < COALESCE(ci.lead_time_days, 7) * 2)
      )
    ORDER BY
        CASE
            WHEN v.days_of_stock IS NOT NULL AND v.days_of_stock < COALESCE(ci.lead_time_days, 7) THEN 1
            WHEN v.days_of_stock IS NOT NULL AND v.days_of_stock < COALESCE(ci.lead_time_days, 7) * 1.5 THEN 2
            WHEN v.qty_available <= COALESCE(ci.reorder_point, 0) THEN 3
            ELSE 4
        END,
        v.days_of_stock NULLS LAST;
END;
$$;


-- ============================================================
-- 1H. Transfer Optimization (#7)
-- ============================================================

CREATE OR REPLACE FUNCTION inventory.get_transfer_suggestions(p_tenant_id uuid)
RETURNS TABLE (
    catalog_item_id uuid,
    sku text,
    item_name text,
    from_location_id uuid,
    from_location_name text,
    from_qty_available numeric,
    to_location_id uuid,
    to_location_name text,
    to_qty_available numeric,
    to_reorder_point numeric,
    suggested_qty numeric,
    reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        surplus.catalog_item_id,
        ci.sku,
        ci.name AS item_name,
        surplus.location_id AS from_location_id,
        sl.name AS from_location_name,
        surplus.qty_available AS from_qty_available,
        deficit.location_id AS to_location_id,
        dl.name AS to_location_name,
        deficit.qty_available AS to_qty_available,
        ci.reorder_point AS to_reorder_point,
        LEAST(
            surplus.qty_available - COALESCE(ci.max_stock_level, surplus.qty_available),
            COALESCE(ci.reorder_point, 0) - deficit.qty_available
        ) AS suggested_qty,
        'Surplus at ' || sl.name || ', deficit at ' || dl.name AS reason
    FROM inventory.stock_balances surplus
    JOIN inventory.stock_balances deficit
        ON deficit.tenant_id = surplus.tenant_id
        AND deficit.catalog_item_id = surplus.catalog_item_id
        AND deficit.location_id <> surplus.location_id
    JOIN inventory.catalog_items ci
        ON ci.id = surplus.catalog_item_id
        AND ci.tenant_id = surplus.tenant_id
    JOIN inventory.locations sl ON sl.id = surplus.location_id AND sl.tenant_id = surplus.tenant_id
    JOIN inventory.locations dl ON dl.id = deficit.location_id AND dl.tenant_id = deficit.tenant_id
    WHERE surplus.tenant_id = p_tenant_id
      AND surplus.qty_available > COALESCE(ci.max_stock_level, surplus.qty_available * 2)
      AND deficit.qty_available < COALESCE(ci.reorder_point, 0)
      AND ci.active = true
    ORDER BY (COALESCE(ci.reorder_point, 0) - deficit.qty_available) DESC;
END;
$$;


-- ============================================================
-- 1I. Low Stock Engine Enhancement (#2) - Event emission
-- ============================================================

-- Auto-create draft PO from a reorder alert
CREATE OR REPLACE FUNCTION inventory.auto_create_draft_po(
    p_alert_id  uuid,
    p_tenant_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_alert RECORD;
    v_vendor_id uuid;
    v_vendor_item RECORD;
    v_po_id uuid;
    v_po_number text;
    v_next_num int;
BEGIN
    -- Get alert details
    SELECT ra.*, ci.preferred_vendor_id, ci.name AS item_name, ci.sku AS item_sku,
           ci.unit_of_measure, ci.reorder_qty
    INTO v_alert
    FROM inventory.reorder_alerts ra
    JOIN inventory.catalog_items ci ON ci.id = ra.catalog_item_id AND ci.tenant_id = ra.tenant_id
    WHERE ra.id = p_alert_id
      AND ra.tenant_id = p_tenant_id;

    IF v_alert IS NULL THEN
        RAISE EXCEPTION 'Reorder alert not found';
    END IF;

    v_vendor_id := v_alert.preferred_vendor_id;
    IF v_vendor_id IS NULL THEN
        RETURN NULL; -- No preferred vendor configured
    END IF;

    -- Get vendor item pricing
    SELECT * INTO v_vendor_item
    FROM supply_chain.vendor_items
    WHERE vendor_id = v_vendor_id
      AND catalog_item_id = v_alert.catalog_item_id
      AND tenant_id = p_tenant_id
    LIMIT 1;

    -- Generate PO number
    UPDATE supply_chain.po_number_sequences
    SET next_number = next_number + 1
    WHERE tenant_id = p_tenant_id
    RETURNING next_number - 1 INTO v_next_num;

    IF v_next_num IS NULL THEN
        INSERT INTO supply_chain.po_number_sequences (tenant_id, next_number, prefix)
        VALUES (p_tenant_id, 2, 'PO')
        RETURNING next_number - 1 INTO v_next_num;
    END IF;

    v_po_number := 'PO-' || LPAD(v_next_num::text, 6, '0');

    -- Create draft PO
    INSERT INTO supply_chain.purchase_orders (
        tenant_id, po_number, vendor_id, vendor_name_snapshot,
        delivery_location_id, status, order_date,
        notes, last_event_id, created_by
    )
    SELECT
        p_tenant_id, v_po_number, v_vendor_id, vn.name,
        v_alert.location_id, 'draft', CURRENT_DATE,
        'Auto-generated from reorder alert for ' || v_alert.item_name,
        gen_random_uuid()::text, NULL
    FROM supply_chain.vendors vn
    WHERE vn.id = v_vendor_id AND vn.tenant_id = p_tenant_id
    RETURNING id INTO v_po_id;

    -- Add PO line
    INSERT INTO supply_chain.purchase_order_lines (
        po_id, line_number, catalog_item_id,
        item_description, item_vendor_sku, unit_of_measure,
        qty_ordered, unit_cost, last_event_id
    ) VALUES (
        v_po_id, 1, v_alert.catalog_item_id,
        v_alert.item_name, COALESCE(v_vendor_item.vendor_sku, v_alert.item_sku),
        v_alert.unit_of_measure,
        COALESCE(v_alert.suggested_order_qty, v_alert.reorder_qty, 1),
        COALESCE(v_vendor_item.unit_cost, 0),
        gen_random_uuid()::text
    );

    RETURN v_po_id;
END;
$$;


-- ============================================================
-- 1J. Cycle Count Suggestions (#15)
-- ============================================================

CREATE OR REPLACE FUNCTION inventory.get_cycle_count_suggestions(
    p_tenant_id uuid,
    p_limit     int DEFAULT 20
)
RETURNS TABLE (
    catalog_item_id uuid,
    sku text,
    item_name text,
    location_id uuid,
    location_name text,
    priority_score int,
    abc_class text,
    days_since_last_count int,
    last_variance_pct numeric,
    movement_frequency numeric,
    reasons text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH item_scores AS (
        SELECT
            sb.catalog_item_id,
            sb.location_id,
            -- ABC classification score
            CASE WHEN abc.classification = 'A' THEN 30
                 WHEN abc.classification = 'B' THEN 15
                 ELSE 5
            END AS abc_score,
            abc.classification AS abc_classification,
            -- High variance in last cycle count
            COALESCE((
                SELECT MAX(ABS(ccl.variance_pct))
                FROM inventory.cycle_count_lines ccl
                JOIN inventory.cycle_counts cc ON cc.id = ccl.cycle_count_id
                WHERE ccl.catalog_item_id = sb.catalog_item_id
                  AND ccl.location_id = sb.location_id
                  AND cc.tenant_id = sb.tenant_id
                  AND cc.status IN ('posted', 'closed')
                ORDER BY cc.completed_at DESC
                LIMIT 1
            ), 0) AS last_var_pct,
            CASE WHEN COALESCE((
                SELECT MAX(ABS(ccl.variance_pct))
                FROM inventory.cycle_count_lines ccl
                JOIN inventory.cycle_counts cc ON cc.id = ccl.cycle_count_id
                WHERE ccl.catalog_item_id = sb.catalog_item_id
                  AND ccl.location_id = sb.location_id
                  AND cc.tenant_id = sb.tenant_id
                  AND cc.status IN ('posted', 'closed')
            ), 0) > 5 THEN 25 ELSE 0 END AS variance_score,
            -- Movement frequency score
            COALESCE(mv.usage_30d, 0) AS mov_freq,
            CASE WHEN COALESCE(mv.usage_30d, 0) > 100 THEN 20
                 WHEN COALESCE(mv.usage_30d, 0) > 50 THEN 15
                 WHEN COALESCE(mv.usage_30d, 0) > 10 THEN 10
                 ELSE 0
            END AS movement_score,
            -- Days since last count
            COALESCE(EXTRACT(days FROM NOW() - (
                SELECT MAX(cc.completed_at)
                FROM inventory.cycle_counts cc
                JOIN inventory.cycle_count_lines ccl ON ccl.cycle_count_id = cc.id
                WHERE ccl.catalog_item_id = sb.catalog_item_id
                  AND ccl.location_id = sb.location_id
                  AND cc.tenant_id = sb.tenant_id
                  AND cc.status IN ('posted', 'closed')
            ))::int, 999) AS days_last_count,
            CASE WHEN COALESCE(EXTRACT(days FROM NOW() - (
                SELECT MAX(cc.completed_at)
                FROM inventory.cycle_counts cc
                JOIN inventory.cycle_count_lines ccl ON ccl.cycle_count_id = cc.id
                WHERE ccl.catalog_item_id = sb.catalog_item_id
                  AND ccl.location_id = sb.location_id
                  AND cc.tenant_id = sb.tenant_id
                  AND cc.status IN ('posted', 'closed')
            ))::int, 999) > 90 THEN 15
            WHEN COALESCE(EXTRACT(days FROM NOW() - (
                SELECT MAX(cc.completed_at)
                FROM inventory.cycle_counts cc
                JOIN inventory.cycle_count_lines ccl ON ccl.cycle_count_id = cc.id
                WHERE ccl.catalog_item_id = sb.catalog_item_id
                  AND ccl.location_id = sb.location_id
                  AND cc.tenant_id = sb.tenant_id
                  AND cc.status IN ('posted', 'closed')
            ))::int, 999) > 30 THEN 10
            ELSE 0 END AS time_score,
            -- Dollar value score
            CASE WHEN sb.qty_on_hand * COALESCE(vi.unit_cost, 0) > 10000 THEN 10
                 WHEN sb.qty_on_hand * COALESCE(vi.unit_cost, 0) > 1000 THEN 5
                 ELSE 0
            END AS value_score
        FROM inventory.stock_balances sb
        LEFT JOIN inventory.abc_classification abc
            ON abc.catalog_item_id = sb.catalog_item_id AND abc.tenant_id = sb.tenant_id
        LEFT JOIN inventory.mv_item_velocity mv
            ON mv.catalog_item_id = sb.catalog_item_id
            AND mv.location_id = sb.location_id
            AND mv.tenant_id = sb.tenant_id
        LEFT JOIN supply_chain.vendor_items vi
            ON vi.catalog_item_id = sb.catalog_item_id AND vi.tenant_id = sb.tenant_id
        WHERE sb.tenant_id = p_tenant_id
          AND sb.qty_on_hand > 0
    )
    SELECT
        s.catalog_item_id,
        ci.sku,
        ci.name AS item_name,
        s.location_id,
        l.name AS location_name,
        (s.abc_score + s.variance_score + s.movement_score + s.time_score + s.value_score)::int AS priority_score,
        COALESCE(s.abc_classification, 'C') AS abc_class,
        s.days_last_count::int AS days_since_last_count,
        s.last_var_pct AS last_variance_pct,
        s.mov_freq AS movement_frequency,
        ARRAY_REMOVE(ARRAY[
            CASE WHEN s.abc_score >= 30 THEN 'ABC Class A item' END,
            CASE WHEN s.variance_score > 0 THEN 'High variance in last count' END,
            CASE WHEN s.movement_score >= 15 THEN 'High movement frequency' END,
            CASE WHEN s.time_score >= 15 THEN 'Not counted in 90+ days' END,
            CASE WHEN s.value_score >= 10 THEN 'High dollar value' END
        ], NULL) AS reasons
    FROM item_scores s
    JOIN inventory.catalog_items ci ON ci.id = s.catalog_item_id AND ci.tenant_id = p_tenant_id
    JOIN inventory.locations l ON l.id = s.location_id AND l.tenant_id = p_tenant_id
    ORDER BY (s.abc_score + s.variance_score + s.movement_score + s.time_score + s.value_score) DESC
    LIMIT p_limit;
END;
$$;


-- ============================================================
-- 1K. Inventory Ledger Explorer Enhancement (#14)
-- ============================================================

CREATE OR REPLACE FUNCTION inventory.get_ledger_with_running_balance(
    p_tenant_id       uuid,
    p_catalog_item_id uuid,
    p_location_id     uuid,
    p_limit           int DEFAULT 100
)
RETURNS TABLE (
    movement_id uuid,
    occurred_at timestamptz,
    movement_type text,
    quantity_delta numeric,
    qty_before numeric,
    qty_after numeric,
    reason text,
    source_ref_type text,
    source_ref_id text,
    posting_status text,
    created_by_user_id uuid,
    last_event_id text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        sm.id AS movement_id,
        sm.occurred_at,
        sm.movement_type,
        sm.quantity_delta,
        SUM(sm.quantity_delta) OVER (ORDER BY sm.occurred_at, sm.created_at ROWS UNBOUNDED PRECEDING) - sm.quantity_delta AS qty_before,
        SUM(sm.quantity_delta) OVER (ORDER BY sm.occurred_at, sm.created_at ROWS UNBOUNDED PRECEDING) AS qty_after,
        sm.reason,
        sm.source_ref_type,
        sm.source_ref_id,
        sm.posting_status,
        sm.created_by_user_id,
        sm.last_event_id
    FROM inventory.stock_movements sm
    WHERE sm.tenant_id = p_tenant_id
      AND sm.catalog_item_id = p_catalog_item_id
      AND sm.location_id = p_location_id
      AND sm.posting_status = 'posted'
    ORDER BY sm.occurred_at DESC, sm.created_at DESC
    LIMIT p_limit;
END;
$$;


-- ============================================================
-- 1L. Inventory Forecast View (#12)
-- ============================================================

CREATE OR REPLACE VIEW inventory.v_inventory_forecast AS
SELECT
    sb.tenant_id,
    sb.catalog_item_id,
    ci.sku,
    ci.name AS item_name,
    SUM(sb.qty_on_hand) AS total_on_hand,
    SUM(sb.qty_reserved) AS total_reserved,
    SUM(sb.qty_available) AS total_available,
    COALESCE(po_incoming.qty_incoming, 0) AS qty_incoming_po,
    COALESCE(res_demand.qty_demanded, 0) AS future_demand,
    SUM(sb.qty_available)
        + COALESCE(po_incoming.qty_incoming, 0)
        - COALESCE(res_demand.qty_demanded, 0) AS net_position
FROM inventory.stock_balances sb
JOIN inventory.catalog_items ci ON ci.id = sb.catalog_item_id AND ci.tenant_id = sb.tenant_id
LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(pol.qty_ordered - COALESCE(pol.qty_received, 0)), 0) AS qty_incoming
    FROM supply_chain.purchase_order_lines pol
    JOIN supply_chain.purchase_orders po ON po.id = pol.po_id
    WHERE pol.catalog_item_id = sb.catalog_item_id
      AND po.tenant_id = sb.tenant_id
      AND po.status IN ('approved', 'placed', 'acknowledged', 'partially_received')
) po_incoming ON true
LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(r.qty), 0) AS qty_demanded
    FROM inventory.reservations r
    WHERE r.catalog_item_id = sb.catalog_item_id
      AND r.tenant_id = sb.tenant_id
      AND r.status = 'active'
) res_demand ON true
GROUP BY sb.tenant_id, sb.catalog_item_id, ci.sku, ci.name,
         po_incoming.qty_incoming, res_demand.qty_demanded;


-- ============================================================
-- Event emission triggers for new config tables
-- ============================================================

CREATE OR REPLACE FUNCTION inventory.emit_uom_conversion_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_event_name TEXT;
    v_payload JSONB;
    v_tenant UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_event_name := 'inventory.uom_conversion.deleted';
        v_payload := jsonb_build_object('uom_conversion_id', OLD.id, 'from_uom', OLD.from_uom, 'to_uom', OLD.to_uom);
        v_tenant := OLD.tenant_id;
    ELSIF TG_OP = 'INSERT' THEN
        v_event_name := 'inventory.uom_conversion.created';
        v_payload := jsonb_build_object('uom_conversion_id', NEW.id, 'from_uom', NEW.from_uom, 'to_uom', NEW.to_uom, 'factor', NEW.conversion_factor);
        v_tenant := NEW.tenant_id;
    ELSIF TG_OP = 'UPDATE' THEN
        v_event_name := 'inventory.uom_conversion.updated';
        v_payload := jsonb_build_object('uom_conversion_id', NEW.id, 'from_uom', NEW.from_uom, 'to_uom', NEW.to_uom, 'factor', NEW.conversion_factor);
        v_tenant := NEW.tenant_id;
    END IF;

    PERFORM public.emit_event(
        p_type := v_event_name,
        p_payload := v_payload,
        p_tenant_id := v_tenant
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_uom_conversion_events ON inventory.uom_conversions;
CREATE TRIGGER trigger_uom_conversion_events
    AFTER INSERT OR UPDATE OR DELETE ON inventory.uom_conversions
    FOR EACH ROW EXECUTE FUNCTION inventory.emit_uom_conversion_event();

CREATE OR REPLACE FUNCTION inventory.emit_negative_inv_config_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_event_name TEXT;
    v_payload JSONB;
    v_tenant UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_event_name := 'inventory.negative_inventory_config.deleted';
        v_payload := jsonb_build_object('config_id', OLD.id, 'scope', OLD.scope);
        v_tenant := OLD.tenant_id;
    ELSIF TG_OP = 'INSERT' THEN
        v_event_name := 'inventory.negative_inventory_config.created';
        v_payload := jsonb_build_object('config_id', NEW.id, 'scope', NEW.scope, 'allow_negative', NEW.allow_negative);
        v_tenant := NEW.tenant_id;
    ELSIF TG_OP = 'UPDATE' THEN
        v_event_name := 'inventory.negative_inventory_config.updated';
        v_payload := jsonb_build_object('config_id', NEW.id, 'scope', NEW.scope, 'allow_negative', NEW.allow_negative);
        v_tenant := NEW.tenant_id;
    END IF;

    PERFORM public.emit_event(
        p_type := v_event_name,
        p_payload := v_payload,
        p_tenant_id := v_tenant
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_negative_inv_config_events ON inventory.negative_inventory_config;
CREATE TRIGGER trigger_negative_inv_config_events
    AFTER INSERT OR UPDATE OR DELETE ON inventory.negative_inventory_config
    FOR EACH ROW EXECUTE FUNCTION inventory.emit_negative_inv_config_event();


-- ============================================================
-- Register new event types in event_catalog
-- ============================================================

INSERT INTO public.event_catalog (event_key, display_name, description, owner_module, aggregate_type, event_version)
VALUES
    ('inventory.uom_conversion.created', 'UOM Conversion Created', 'A new UOM conversion rule was created', 'inventory', 'uom_conversion', 1),
    ('inventory.uom_conversion.updated', 'UOM Conversion Updated', 'A UOM conversion rule was updated', 'inventory', 'uom_conversion', 1),
    ('inventory.uom_conversion.deleted', 'UOM Conversion Deleted', 'A UOM conversion rule was deleted', 'inventory', 'uom_conversion', 1),
    ('inventory.negative_inventory_config.created', 'Negative Inv Config Created', 'Negative inventory config was created', 'inventory', 'negative_inventory_config', 1),
    ('inventory.negative_inventory_config.updated', 'Negative Inv Config Updated', 'Negative inventory config was updated', 'inventory', 'negative_inventory_config', 1),
    ('inventory.negative_inventory_config.deleted', 'Negative Inv Config Deleted', 'Negative inventory config was deleted', 'inventory', 'negative_inventory_config', 1)
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO public.event_definitions (event_name, version, producer, description, status)
VALUES
    ('inventory.uom_conversion.created', 1, 'inventory', 'A new UOM conversion rule was created', 'active'),
    ('inventory.uom_conversion.updated', 1, 'inventory', 'A UOM conversion rule was updated', 'active'),
    ('inventory.uom_conversion.deleted', 1, 'inventory', 'A UOM conversion rule was deleted', 'active'),
    ('inventory.negative_inventory_config.created', 1, 'inventory', 'Negative inventory config was created', 'active'),
    ('inventory.negative_inventory_config.updated', 1, 'inventory', 'Negative inventory config was updated', 'active'),
    ('inventory.negative_inventory_config.deleted', 1, 'inventory', 'Negative inventory config was deleted', 'active')
ON CONFLICT (event_name, version) DO NOTHING;

-- ============================================================
-- Add mv_item_velocity to the refresh schedule
-- (refresh_dashboard_views already exists, update it)
-- ============================================================

DROP FUNCTION IF EXISTS inventory.refresh_dashboard_views();

CREATE OR REPLACE FUNCTION inventory.refresh_dashboard_views()
RETURNS TABLE(view_name text, row_count bigint, refresh_time_ms numeric)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_start TIMESTAMPTZ;
    v_count BIGINT;
BEGIN
    -- Refresh inventory summary
    v_start := clock_timestamp();
    REFRESH MATERIALIZED VIEW CONCURRENTLY inventory.mv_inventory_summary;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN QUERY SELECT
        'mv_inventory_summary'::TEXT,
        v_count,
        EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start));

    -- Refresh low stock summary
    v_start := clock_timestamp();
    REFRESH MATERIALIZED VIEW CONCURRENTLY inventory.mv_low_stock_summary;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN QUERY SELECT
        'mv_low_stock_summary'::TEXT,
        v_count,
        EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start));

    -- Refresh asset utilization
    v_start := clock_timestamp();
    REFRESH MATERIALIZED VIEW CONCURRENTLY inventory.mv_asset_utilization;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN QUERY SELECT
        'mv_asset_utilization'::TEXT,
        v_count,
        EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start));

    -- Refresh item velocity (NEW)
    v_start := clock_timestamp();
    REFRESH MATERIALIZED VIEW CONCURRENTLY inventory.mv_item_velocity;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN QUERY SELECT
        'mv_item_velocity'::TEXT,
        v_count,
        EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start));
END;
$$;

GRANT ALL ON FUNCTION inventory.refresh_dashboard_views() TO service_role;
