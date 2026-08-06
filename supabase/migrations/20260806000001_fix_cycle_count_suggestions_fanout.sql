-- Fix duplicate item-location rows in get_cycle_count_suggestions.
--
-- The LEFT JOIN on supply_chain.vendor_items fanned out: an item with N vendor
-- rows produced N suggestion rows for the same location, each with a different
-- unit_cost-derived value_score (seen on stage: Fuel Can @ Portland listed at
-- scores 45 and 35 simultaneously). Collapse the vendor cost to MAX(unit_cost)
-- per item so each item-location appears exactly once, scored by its most
-- valuable sourcing cost.

CREATE OR REPLACE FUNCTION inventory.get_cycle_count_suggestions(p_tenant_id uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(catalog_item_id uuid, sku text, item_name text, location_id uuid, location_name text, priority_score integer, abc_class text, days_since_last_count integer, last_variance_pct numeric, movement_frequency numeric, reasons text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $function$
BEGIN
    RETURN QUERY
    WITH last_counts AS (
        SELECT
            ccl.catalog_item_id,
            ccl.location_id,
            MAX(ABS(ccl.variance_pct)) AS last_var_pct,
            MAX(cc.completed_at) AS last_counted_at
        FROM inventory.cycle_count_lines ccl
        JOIN inventory.cycle_counts cc ON cc.id = ccl.cycle_count_id
        WHERE cc.tenant_id = p_tenant_id
          AND cc.status IN ('posted', 'closed')
        GROUP BY ccl.catalog_item_id, ccl.location_id
    ),
    item_scores AS (
        SELECT
            sb.catalog_item_id,
            sb.location_id,
            COALESCE(lc.last_var_pct, 0) AS last_var_pct,
            CASE WHEN COALESCE(lc.last_var_pct, 0) > 5 THEN 25 ELSE 0 END AS variance_score,
            COALESCE(mv.usage_30d, 0) AS mov_freq,
            CASE WHEN COALESCE(mv.usage_30d, 0) > 100 THEN 20
                 WHEN COALESCE(mv.usage_30d, 0) > 50 THEN 15
                 WHEN COALESCE(mv.usage_30d, 0) > 10 THEN 10
                 ELSE 0
            END AS movement_score,
            COALESCE(EXTRACT(days FROM NOW() - lc.last_counted_at)::int, 999) AS days_last_count,
            CASE WHEN COALESCE(EXTRACT(days FROM NOW() - lc.last_counted_at)::int, 999) > 90 THEN 15
                 WHEN COALESCE(EXTRACT(days FROM NOW() - lc.last_counted_at)::int, 999) > 30 THEN 10
                 ELSE 0
            END AS time_score,
            CASE WHEN sb.qty_on_hand * COALESCE(vi.unit_cost, 0) > 10000 THEN 40
                 WHEN sb.qty_on_hand * COALESCE(vi.unit_cost, 0) > 1000 THEN 20
                 WHEN sb.qty_on_hand * COALESCE(vi.unit_cost, 0) > 100 THEN 10
                 ELSE 0
            END AS value_score
        FROM inventory.stock_balances sb
        LEFT JOIN last_counts lc
            ON lc.catalog_item_id = sb.catalog_item_id AND lc.location_id = sb.location_id
        LEFT JOIN inventory.mv_item_velocity mv
            ON mv.catalog_item_id = sb.catalog_item_id
            AND mv.location_id = sb.location_id
            AND mv.tenant_id = sb.tenant_id
        LEFT JOIN LATERAL (
            SELECT MAX(vi2.unit_cost) AS unit_cost
            FROM supply_chain.vendor_items vi2
            WHERE vi2.catalog_item_id = sb.catalog_item_id
              AND vi2.tenant_id = sb.tenant_id
        ) vi ON TRUE
        WHERE sb.tenant_id = p_tenant_id
          AND sb.qty_on_hand > 0
    )
    SELECT
        s.catalog_item_id,
        ci.sku,
        ci.name AS item_name,
        s.location_id,
        l.name AS location_name,
        (s.variance_score + s.movement_score + s.time_score + s.value_score)::int AS priority_score,
        'C'::text AS abc_class,
        s.days_last_count::int AS days_since_last_count,
        s.last_var_pct AS last_variance_pct,
        s.mov_freq AS movement_frequency,
        ARRAY_REMOVE(ARRAY[
            CASE WHEN s.variance_score > 0 THEN 'High variance in last count' END,
            CASE WHEN s.movement_score >= 15 THEN 'High movement frequency' END,
            CASE WHEN s.time_score >= 15 THEN 'Not counted in 90+ days' END,
            CASE WHEN s.value_score >= 20 THEN 'High dollar value' END
        ], NULL) AS reasons
    FROM item_scores s
    JOIN inventory.catalog_items ci ON ci.id = s.catalog_item_id AND ci.tenant_id = p_tenant_id
    JOIN inventory.locations l ON l.id = s.location_id AND l.tenant_id = p_tenant_id
    ORDER BY (s.variance_score + s.movement_score + s.time_score + s.value_score) DESC
    LIMIT p_limit;
END;
$function$;
