-- Monthly material usage & storage trend report.
--
-- Powers the "Usage Trends" view and the Isabelle `query_usage_trends` tool.
-- For every non-serialized (consumable/fungible) catalog item, returns a
-- per-month series over the last p_months months:
--   usage_qty    — units consumed out the door  (issued + consumed)
--   received_qty — units received in            (received)
--   net_delta    — net ledger change that month (all posted movement types)
--   end_on_hand  — on-hand at month end (cumulative posted ledger balance)
--
-- Tenant is passed explicitly (not read from JWT) because the AI executor runs
-- under a pooled service-role client where current_tenant_id() is unreliable.
-- SECURITY DEFINER bypasses RLS; the explicit p_tenant_id filter enforces
-- isolation and callers always pass a session-derived tenant id.

CREATE OR REPLACE FUNCTION inventory.rpc_report_monthly_usage(
  p_tenant_id uuid,
  p_months integer DEFAULT 13
)
RETURNS TABLE (
  catalog_item_id uuid,
  sku text,
  name text,
  tracking_mode text,
  month date,
  usage_qty numeric,
  received_qty numeric,
  net_delta numeric,
  end_on_hand numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'inventory', 'public'
AS $$
  WITH months AS (
    SELECT generate_series(
      date_trunc('month', now()) - make_interval(months => GREATEST(p_months, 1) - 1),
      date_trunc('month', now()),
      interval '1 month'
    ) AS month_start
  ),
  items AS (
    SELECT id, sku, name, tracking_mode
    FROM inventory.catalog_items
    WHERE tenant_id = p_tenant_id
      AND tracking_mode <> 'serialized'
      AND COALESCE(active, true)
  ),
  monthly AS (
    SELECT
      sm.catalog_item_id,
      date_trunc('month', sm.occurred_at) AS month_start,
      SUM(CASE WHEN sm.movement_type IN ('issued', 'consumed') THEN ABS(sm.quantity_delta) ELSE 0 END) AS usage_qty,
      SUM(CASE WHEN sm.movement_type = 'received' THEN sm.quantity_delta ELSE 0 END) AS received_qty,
      SUM(sm.quantity_delta) AS net_delta
    FROM inventory.stock_movements sm
    WHERE sm.tenant_id = p_tenant_id
      AND sm.posting_status = 'posted'
    GROUP BY sm.catalog_item_id, date_trunc('month', sm.occurred_at)
  ),
  cum AS (
    SELECT
      i.id AS catalog_item_id,
      m.month_start,
      COALESCE((
        SELECT SUM(sm.quantity_delta)
        FROM inventory.stock_movements sm
        WHERE sm.catalog_item_id = i.id
          AND sm.tenant_id = p_tenant_id
          AND sm.posting_status = 'posted'
          AND sm.occurred_at < (m.month_start + interval '1 month')
      ), 0) AS end_on_hand
    FROM items i
    CROSS JOIN months m
  )
  SELECT
    i.id,
    i.sku,
    i.name,
    i.tracking_mode,
    m.month_start::date AS month,
    COALESCE(mo.usage_qty, 0) AS usage_qty,
    COALESCE(mo.received_qty, 0) AS received_qty,
    COALESCE(mo.net_delta, 0) AS net_delta,
    COALESCE(c.end_on_hand, 0) AS end_on_hand
  FROM items i
  CROSS JOIN months m
  LEFT JOIN monthly mo ON mo.catalog_item_id = i.id AND mo.month_start = m.month_start
  LEFT JOIN cum c ON c.catalog_item_id = i.id AND c.month_start = m.month_start
  ORDER BY i.name, m.month_start;
$$;

GRANT EXECUTE ON FUNCTION inventory.rpc_report_monthly_usage(uuid, integer) TO authenticated, service_role;
