-- ============================================================
-- Report RPC Functions
-- All use current_tenant_id() from JWT for tenant isolation
-- ============================================================

-- Drop old versions that took p_tenant_id parameter (from snippet)
DROP FUNCTION IF EXISTS inventory.rpc_report_stock_valuation(uuid);
DROP FUNCTION IF EXISTS inventory.rpc_report_movement_summary(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS inventory.rpc_report_reorder_suggestions(uuid);


-- ============================================================
-- 1. Stock Valuation by Location and Category
-- ============================================================
CREATE OR REPLACE FUNCTION inventory.rpc_report_stock_valuation()
RETURNS TABLE (
    location_name text,
    category_name text,
    item_count bigint,
    total_qty numeric,
    avg_unit_cost numeric,
    total_value numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public'
AS $$
DECLARE
    v_tenant_id uuid;
BEGIN
    v_tenant_id := current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    RETURN QUERY
    SELECT
        l.name AS location_name,
        COALESCE(ic.name, 'Uncategorized') AS category_name,
        COUNT(DISTINCT sb.catalog_item_id) AS item_count,
        SUM(sb.qty_on_hand) AS total_qty,
        ROUND(AVG(COALESCE(pol.unit_cost, 0)), 2) AS avg_unit_cost,
        ROUND(SUM(sb.qty_on_hand * COALESCE(pol.unit_cost, 0)), 2) AS total_value
    FROM inventory.stock_balances sb
    JOIN inventory.locations l ON sb.location_id = l.id
    JOIN inventory.catalog_items ci ON sb.catalog_item_id = ci.id
    LEFT JOIN inventory.item_categories ic ON ci.category_id = ic.id
    LEFT JOIN LATERAL (
        SELECT DISTINCT ON (pol2.catalog_item_id) pol2.unit_cost
        FROM supply_chain.purchase_order_lines pol2
        WHERE pol2.catalog_item_id = sb.catalog_item_id
          AND pol2.tenant_id = v_tenant_id
        ORDER BY pol2.catalog_item_id, pol2.created_at DESC
    ) pol ON true
    WHERE sb.tenant_id = v_tenant_id
      AND sb.qty_on_hand > 0
    GROUP BY l.name, ic.name
    ORDER BY total_value DESC NULLS LAST;
END;
$$;


-- ============================================================
-- 2. Movement Summary by Type and Date Range
-- ============================================================
CREATE OR REPLACE FUNCTION inventory.rpc_report_movement_summary(
    p_start_date timestamptz DEFAULT NOW() - INTERVAL '30 days',
    p_end_date timestamptz DEFAULT NOW()
)
RETURNS TABLE (
    event_type text,
    event_count bigint,
    total_qty_in numeric,
    total_qty_out numeric,
    net_movement numeric,
    unique_items bigint,
    unique_locations bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public'
AS $$
DECLARE
    v_tenant_id uuid;
BEGIN
    v_tenant_id := current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    RETURN QUERY
    SELECT
        ie.event_type,
        COUNT(*) AS event_count,
        SUM(CASE WHEN (ie.payload->>'qty')::numeric > 0 THEN (ie.payload->>'qty')::numeric ELSE 0 END) AS total_qty_in,
        SUM(CASE WHEN (ie.payload->>'qty')::numeric < 0 THEN ABS((ie.payload->>'qty')::numeric) ELSE 0 END) AS total_qty_out,
        SUM((ie.payload->>'qty')::numeric) AS net_movement,
        COUNT(DISTINCT ie.payload->>'catalog_item_id') AS unique_items,
        COUNT(DISTINCT ie.payload->>'location_id') AS unique_locations
    FROM inventory.inventory_events ie
    WHERE ie.tenant_id = v_tenant_id
      AND ie.occurred_at >= p_start_date
      AND ie.occurred_at <= p_end_date
    GROUP BY ie.event_type
    ORDER BY event_count DESC;
END;
$$;


-- ============================================================
-- 3. Reorder Suggestions (Items Below Reorder Point)
-- ============================================================
CREATE OR REPLACE FUNCTION inventory.rpc_report_reorder_suggestions()
RETURNS TABLE (
    sku text,
    item_name text,
    category_name text,
    location_name text,
    qty_on_hand numeric,
    qty_available numeric,
    reorder_point numeric,
    reorder_qty numeric,
    target_level numeric,
    shortage numeric,
    suggested_order_qty numeric,
    preferred_vendor text,
    lead_time_days integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public'
AS $$
DECLARE
    v_tenant_id uuid;
BEGIN
    v_tenant_id := current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    RETURN QUERY
    SELECT
        ci.sku,
        ci.name AS item_name,
        COALESCE(ic.name, 'Uncategorized') AS category_name,
        l.name AS location_name,
        sb.qty_on_hand,
        sb.qty_available,
        ci.reorder_point,
        ci.reorder_qty,
        ci.target_level,
        (ci.reorder_point - sb.qty_available) AS shortage,
        CASE
            WHEN ci.target_level IS NOT NULL THEN (ci.target_level - sb.qty_on_hand)
            WHEN ci.reorder_qty IS NOT NULL THEN ci.reorder_qty
            ELSE (ci.reorder_point * 1.5) - sb.qty_on_hand
        END AS suggested_order_qty,
        v.name AS preferred_vendor,
        ci.lead_time_days
    FROM inventory.stock_balances sb
    JOIN inventory.catalog_items ci ON sb.catalog_item_id = ci.id
    JOIN inventory.locations l ON sb.location_id = l.id
    LEFT JOIN inventory.item_categories ic ON ci.category_id = ic.id
    LEFT JOIN supply_chain.vendors v ON ci.preferred_vendor_id = v.id
    WHERE sb.tenant_id = v_tenant_id
      AND ci.reorder_point IS NOT NULL
      AND sb.qty_available <= ci.reorder_point
      AND ci.active = true
      AND ci.deleted_at IS NULL
      AND ci.deprecated = false
    ORDER BY shortage DESC;
END;
$$;


-- ============================================================
-- 4. Dead Stock Report (No movement in 90+ days)
-- ============================================================
CREATE OR REPLACE FUNCTION inventory.rpc_report_dead_stock()
RETURNS TABLE (
    sku text,
    item_name text,
    location_name text,
    qty_on_hand numeric,
    capital_locked numeric,
    last_movement_at timestamptz,
    days_since_movement integer,
    aging_status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public'
AS $$
DECLARE
    v_tenant_id uuid;
BEGIN
    v_tenant_id := current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    RETURN QUERY
    SELECT
        ds.sku,
        ds.item_name,
        ds.location_name,
        ds.qty_on_hand,
        ds.capital_locked,
        ds.last_movement_at,
        ds.days_since_movement,
        ds.aging_status
    FROM inventory.v_dead_stock_report ds
    WHERE ds.tenant_id = v_tenant_id
      AND ds.aging_status != 'active'
    ORDER BY ds.capital_locked DESC NULLS LAST;
END;
$$;


-- ============================================================
-- 5. Velocity Analysis (Consumption rates + days-of-stock)
-- ============================================================
CREATE OR REPLACE FUNCTION inventory.rpc_report_velocity_analysis()
RETURNS TABLE (
    sku text,
    item_name text,
    location_name text,
    qty_available numeric,
    usage_30d numeric,
    usage_60d numeric,
    usage_90d numeric,
    daily_rate numeric,
    days_of_stock numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public'
AS $$
DECLARE
    v_tenant_id uuid;
BEGIN
    v_tenant_id := current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    RETURN QUERY
    SELECT
        ci.sku,
        ci.name AS item_name,
        l.name AS location_name,
        v.qty_available,
        v.usage_30d,
        v.usage_60d,
        v.usage_90d,
        v.daily_rate_30d AS daily_rate,
        v.days_of_stock
    FROM inventory.mv_item_velocity v
    JOIN inventory.catalog_items ci ON ci.id = v.catalog_item_id AND ci.tenant_id = v.tenant_id
    JOIN inventory.locations l ON l.id = v.location_id AND l.tenant_id = v.tenant_id
    WHERE v.tenant_id = v_tenant_id
    ORDER BY v.daily_rate_30d DESC NULLS LAST;
END;
$$;


-- ============================================================
-- 6. Forecast Report (On-hand + incoming POs - demand)
-- ============================================================
CREATE OR REPLACE FUNCTION inventory.rpc_report_forecast()
RETURNS TABLE (
    sku text,
    item_name text,
    total_on_hand numeric,
    total_reserved numeric,
    total_available numeric,
    qty_incoming_po numeric,
    future_demand numeric,
    net_position numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public'
AS $$
DECLARE
    v_tenant_id uuid;
BEGIN
    v_tenant_id := current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    RETURN QUERY
    SELECT
        f.sku,
        f.item_name,
        f.total_on_hand,
        f.total_reserved,
        f.total_available,
        f.qty_incoming_po,
        f.future_demand,
        f.net_position
    FROM inventory.v_inventory_forecast f
    WHERE f.tenant_id = v_tenant_id
    ORDER BY f.net_position ASC;
END;
$$;


-- ============================================================
-- Permissions
-- ============================================================
ALTER FUNCTION inventory.rpc_report_stock_valuation OWNER TO postgres;
ALTER FUNCTION inventory.rpc_report_movement_summary OWNER TO postgres;
ALTER FUNCTION inventory.rpc_report_reorder_suggestions OWNER TO postgres;
ALTER FUNCTION inventory.rpc_report_dead_stock OWNER TO postgres;
ALTER FUNCTION inventory.rpc_report_velocity_analysis OWNER TO postgres;
ALTER FUNCTION inventory.rpc_report_forecast OWNER TO postgres;

GRANT EXECUTE ON FUNCTION inventory.rpc_report_stock_valuation TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION inventory.rpc_report_movement_summary TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION inventory.rpc_report_reorder_suggestions TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION inventory.rpc_report_dead_stock TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION inventory.rpc_report_velocity_analysis TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION inventory.rpc_report_forecast TO authenticated, service_role;
