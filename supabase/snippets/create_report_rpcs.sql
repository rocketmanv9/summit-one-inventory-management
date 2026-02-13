-- Report 1: Stock Valuation by Location and Category
CREATE OR REPLACE FUNCTION inventory.rpc_report_stock_valuation(
    p_tenant_id UUID
)
RETURNS TABLE (
    location_name TEXT,
    category_name TEXT,
    item_count BIGINT,
    total_qty NUMERIC,
    avg_unit_cost NUMERIC,
    total_value NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, supply_chain, public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        l.name as location_name,
        COALESCE(ic.name, 'Uncategorized') as category_name,
        COUNT(DISTINCT sb.catalog_item_id) as item_count,
        SUM(sb.qty_on_hand) as total_qty,
        ROUND(AVG(COALESCE(pol.unit_cost, 0)), 2) as avg_unit_cost,
        ROUND(SUM(sb.qty_on_hand * COALESCE(pol.unit_cost, 0)), 2) as total_value
    FROM inventory.stock_balances sb
    JOIN inventory.locations l ON sb.location_id = l.id
    JOIN inventory.catalog_items ci ON sb.catalog_item_id = ci.id
    LEFT JOIN inventory.item_categories ic ON ci.category_id = ic.id
    LEFT JOIN LATERAL (
        SELECT DISTINCT ON (pol.catalog_item_id) pol.unit_cost
        FROM supply_chain.purchase_order_lines pol
        WHERE pol.catalog_item_id = sb.catalog_item_id
          AND pol.tenant_id = p_tenant_id
        ORDER BY pol.catalog_item_id, pol.created_at DESC
    ) pol ON true
    WHERE sb.tenant_id = p_tenant_id
      AND sb.qty_on_hand > 0
    GROUP BY l.name, ic.name
    ORDER BY total_value DESC NULLS LAST;
END;
$$;

-- Report 2: Movement Summary by Type and Date Range
CREATE OR REPLACE FUNCTION inventory.rpc_report_movement_summary(
    p_tenant_id UUID,
    p_start_date TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days',
    p_end_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
    event_type TEXT,
    event_count BIGINT,
    total_qty_in NUMERIC,
    total_qty_out NUMERIC,
    net_movement NUMERIC,
    unique_items BIGINT,
    unique_locations BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, supply_chain, public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ie.event_type,
        COUNT(*) as event_count,
        SUM(CASE WHEN (ie.payload->>'qty')::NUMERIC > 0 THEN (ie.payload->>'qty')::NUMERIC ELSE 0 END) as total_qty_in,
        SUM(CASE WHEN (ie.payload->>'qty')::NUMERIC < 0 THEN ABS((ie.payload->>'qty')::NUMERIC) ELSE 0 END) as total_qty_out,
        SUM((ie.payload->>'qty')::NUMERIC) as net_movement,
        COUNT(DISTINCT ie.payload->>'catalog_item_id') as unique_items,
        COUNT(DISTINCT ie.payload->>'location_id') as unique_locations
    FROM inventory.inventory_events ie
    WHERE ie.tenant_id = p_tenant_id
      AND ie.occurred_at >= p_start_date
      AND ie.occurred_at <= p_end_date
    GROUP BY ie.event_type
    ORDER BY event_count DESC;
END;
$$;

-- Report 3: Reorder Suggestions (Items Below Reorder Point)
CREATE OR REPLACE FUNCTION inventory.rpc_report_reorder_suggestions(
    p_tenant_id UUID
)
RETURNS TABLE (
    sku TEXT,
    item_name TEXT,
    category_name TEXT,
    location_name TEXT,
    qty_on_hand NUMERIC,
    qty_available NUMERIC,
    reorder_point NUMERIC,
    reorder_qty NUMERIC,
    target_level NUMERIC,
    shortage NUMERIC,
    suggested_order_qty NUMERIC,
    preferred_vendor TEXT,
    lead_time_days INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, supply_chain, public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ci.sku,
        ci.name as item_name,
        COALESCE(ic.name, 'Uncategorized') as category_name,
        l.name as location_name,
        sb.qty_on_hand,
        sb.qty_available,
        ci.reorder_point,
        ci.reorder_qty,
        ci.target_level,
        (ci.reorder_point - sb.qty_available) as shortage,
        CASE 
            WHEN ci.target_level IS NOT NULL THEN (ci.target_level - sb.qty_on_hand)
            WHEN ci.reorder_qty IS NOT NULL THEN ci.reorder_qty
            ELSE (ci.reorder_point * 1.5) - sb.qty_on_hand
        END as suggested_order_qty,
        v.name as preferred_vendor,
        ci.lead_time_days
    FROM inventory.stock_balances sb
    JOIN inventory.catalog_items ci ON sb.catalog_item_id = ci.id
    JOIN inventory.locations l ON sb.location_id = l.id
    LEFT JOIN inventory.item_categories ic ON ci.category_id = ic.id
    LEFT JOIN supply_chain.vendors v ON ci.preferred_vendor_id = v.id
    WHERE sb.tenant_id = p_tenant_id
      AND ci.reorder_point IS NOT NULL
      AND sb.qty_available <= ci.reorder_point
      AND ci.active = true
      AND ci.deleted_at IS NULL
      AND ci.deprecated = false
    ORDER BY shortage DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION inventory.rpc_report_stock_valuation TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION inventory.rpc_report_movement_summary TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION inventory.rpc_report_reorder_suggestions TO authenticated, service_role;
