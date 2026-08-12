-- Min-level wizard (automagic 01): facts assembly + MV refresh helpers.
-- No new tables. Two SECURITY DEFINER functions the AI route calls:
--   rpc_min_level_facts(tenant)     -> one row per active, non-variant item with
--                                      the velocity / on-hand / count-variance /
--                                      category / cost facts the model needs.
--   rpc_refresh_min_level_views()   -> CONCURRENTLY refresh mv_item_velocity and
--                                      mv_low_stock_summary (both have unique
--                                      indexes) so proposals use fresh velocity
--                                      and Low Stock wakes right after accept.
-- UOM labels are resolved in the route via the GV SDK (GV is a separate project;
-- there is no gv schema here) — the function returns uom_term_id.
--
-- NOTE: rpc_min_level_facts is superseded by 20260806000003 (adds last_event_id
-- to the return type). This file is kept for migration history; the later file
-- drops-and-recreates the function.

CREATE OR REPLACE FUNCTION inventory.rpc_refresh_min_level_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY inventory.mv_item_velocity;
  REFRESH MATERIALIZED VIEW CONCURRENTLY inventory.mv_low_stock_summary;
END;
$$;

CREATE OR REPLACE FUNCTION inventory.rpc_min_level_facts(p_tenant_id uuid)
RETURNS TABLE (
  catalog_item_id   uuid,
  sku               text,
  name              text,
  category_name     text,
  tracking_mode     text,
  uom_term_id       uuid,
  seasonal          boolean,
  current_reorder_point numeric,
  current_min_stock_level numeric,
  qty_on_hand       numeric,
  qty_available     numeric,
  usage_30d         numeric,
  usage_60d         numeric,
  usage_90d         numeric,
  daily_rate_30d    numeric,
  days_of_stock     numeric,
  movement_days     integer,
  count_events      integer,
  count_variance_abs numeric,
  last_unit_cost    numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = inventory, public
AS $$
  WITH pos AS (
    SELECT p.catalog_item_id,
           SUM(p.qty_on_hand)   AS qty_on_hand,
           SUM(p.qty_available) AS qty_available
    FROM inventory.v_inventory_position p
    WHERE p.tenant_id = p_tenant_id
    GROUP BY p.catalog_item_id
  ),
  vel AS (
    SELECT v.catalog_item_id,
           SUM(v.usage_30d)              AS usage_30d,
           SUM(v.usage_60d)              AS usage_60d,
           SUM(v.usage_90d)              AS usage_90d,
           SUM(v.daily_rate_30d)         AS daily_rate_30d,
           MIN(v.days_of_stock)          AS days_of_stock
    FROM inventory.mv_item_velocity v
    WHERE v.tenant_id = p_tenant_id
    GROUP BY v.catalog_item_id
  ),
  mv AS (
    -- Distinct calendar days with a qualifying (posted, consumption) movement,
    -- so the model can tell "one big transfer" from "steady daily draw".
    SELECT sm.catalog_item_id,
           COUNT(DISTINCT date_trunc('day', sm.occurred_at)) AS movement_days
    FROM inventory.stock_movements sm
    WHERE sm.tenant_id = p_tenant_id
      AND sm.movement_type IN ('issued','consumed','transferred_out')
      AND sm.posting_status = 'posted'
      AND sm.occurred_at > now() - interval '90 days'
    GROUP BY sm.catalog_item_id
  ),
  cnt AS (
    SELECT ccl.catalog_item_id,
           COUNT(*)                                   AS count_events,
           COALESCE(SUM(abs(COALESCE(ccl.variance_qty, ccl.variance, 0))), 0) AS count_variance_abs
    FROM inventory.cycle_count_lines ccl
    WHERE ccl.tenant_id = p_tenant_id
      AND ccl.posted_at IS NOT NULL
      AND ccl.posted_at > now() - interval '180 days'
    GROUP BY ccl.catalog_item_id
  ),
  cost AS (
    -- Last known unit cost from the ledger (most recent movement carrying one).
    SELECT DISTINCT ON (sm.catalog_item_id)
           sm.catalog_item_id, sm.unit_cost
    FROM inventory.stock_movements sm
    WHERE sm.tenant_id = p_tenant_id AND sm.unit_cost IS NOT NULL AND sm.unit_cost > 0
    ORDER BY sm.catalog_item_id, sm.occurred_at DESC
  )
  SELECT
    ci.id,
    ci.sku,
    ci.name,
    cat.name,
    ci.tracking_mode,
    ci.uom_term_id,
    ci.seasonal,
    ci.reorder_point,
    ci.min_stock_level,
    COALESCE(pos.qty_on_hand, 0),
    COALESCE(pos.qty_available, 0),
    COALESCE(vel.usage_30d, 0),
    COALESCE(vel.usage_60d, 0),
    COALESCE(vel.usage_90d, 0),
    COALESCE(vel.daily_rate_30d, 0),
    vel.days_of_stock,
    COALESCE(mv.movement_days, 0)::int,
    COALESCE(cnt.count_events, 0)::int,
    COALESCE(cnt.count_variance_abs, 0),
    cost.unit_cost
  FROM inventory.catalog_items ci
  LEFT JOIN inventory.item_categories cat ON cat.id = ci.category_id
  LEFT JOIN pos  ON pos.catalog_item_id = ci.id
  LEFT JOIN vel  ON vel.catalog_item_id = ci.id
  LEFT JOIN mv   ON mv.catalog_item_id  = ci.id
  LEFT JOIN cnt  ON cnt.catalog_item_id = ci.id
  LEFT JOIN cost ON cost.catalog_item_id = ci.id
  WHERE ci.tenant_id = p_tenant_id
    AND ci.active = true
    AND ci.deleted_at IS NULL
    AND ci.parent_item_id IS NULL   -- item-level; variants roll up under parent
    AND ci.is_parent = false        -- parents hold no stock themselves
  ORDER BY cat.name NULLS LAST, ci.name;
$$;

GRANT EXECUTE ON FUNCTION inventory.rpc_refresh_min_level_views() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION inventory.rpc_min_level_facts(uuid) TO authenticated, service_role;
