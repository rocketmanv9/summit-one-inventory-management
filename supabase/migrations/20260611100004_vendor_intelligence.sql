-- Vendor intelligence: derive real price history and lead-time actuals from
-- receipts and POs, instead of relying on manually maintained vendor_items
-- fields. Views use security_invoker so tenant RLS on the base tables applies;
-- the RPC takes an explicit tenant id (cron/service-client safe).

CREATE OR REPLACE VIEW supply_chain.v_vendor_price_history
WITH (security_invoker = true) AS
SELECT
  r.tenant_id,
  r.vendor_id,
  rl.catalog_item_id,
  r.received_at AS observed_at,
  rl.unit_cost_actual AS unit_cost,
  rl.qty_received AS qty,
  r.po_id,
  'receipt'::text AS source
FROM supply_chain.receipt_lines rl
JOIN supply_chain.receipts r ON r.id = rl.receipt_id
WHERE rl.unit_cost_actual IS NOT NULL
  AND rl.catalog_item_id IS NOT NULL
UNION ALL
SELECT
  po.tenant_id,
  po.vendor_id,
  pol.catalog_item_id,
  COALESCE(po.ordered_at, po.sent_at, po.created_at) AS observed_at,
  pol.unit_cost,
  pol.qty_ordered AS qty,
  po.id AS po_id,
  'po'::text AS source
FROM supply_chain.purchase_order_lines pol
JOIN supply_chain.purchase_orders po ON po.id = pol.po_id
WHERE pol.unit_cost IS NOT NULL
  AND pol.catalog_item_id IS NOT NULL
  AND po.status NOT IN ('cancelled', 'voided');

CREATE OR REPLACE VIEW supply_chain.v_vendor_lead_time_actuals
WITH (security_invoker = true) AS
SELECT
  po.tenant_id,
  po.vendor_id,
  po.id AS po_id,
  po.po_number,
  po.ordered_at,
  MIN(r.received_at) AS first_received_at,
  EXTRACT(EPOCH FROM (MIN(r.received_at) - po.ordered_at)) / 86400.0 AS lead_days
FROM supply_chain.purchase_orders po
JOIN supply_chain.receipts r ON r.po_id = po.id
WHERE po.ordered_at IS NOT NULL
GROUP BY po.tenant_id, po.vendor_id, po.id, po.po_number, po.ordered_at;

-- Aggregated per-vendor intelligence for the UI: lead-time actual vs configured,
-- and per-item price trend (latest vs trailing-90d average).
CREATE OR REPLACE FUNCTION supply_chain.rpc_vendor_intelligence(
  p_tenant_id UUID,
  p_vendor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'supply_chain', 'inventory', 'public'
AS $$
  WITH lead AS (
    SELECT
      lt.vendor_id,
      round(avg(lt.lead_days)::numeric, 1) AS avg_lead_days,
      round((percentile_cont(0.9) WITHIN GROUP (ORDER BY lt.lead_days))::numeric, 1) AS p90_lead_days,
      count(*) AS delivery_count,
      max(lt.first_received_at) AS last_delivery_at
    FROM supply_chain.v_vendor_lead_time_actuals lt
    WHERE lt.tenant_id = p_tenant_id
      AND (p_vendor_id IS NULL OR lt.vendor_id = p_vendor_id)
    GROUP BY lt.vendor_id
  ),
  configured AS (
    SELECT vi.vendor_id, round(avg(vi.lead_time_days)::numeric, 1) AS configured_lead_days
    FROM supply_chain.vendor_items vi
    WHERE vi.tenant_id = p_tenant_id AND vi.lead_time_days IS NOT NULL
    GROUP BY vi.vendor_id
  ),
  priced AS (
    SELECT
      ph.vendor_id,
      ph.catalog_item_id,
      ci.name AS item_name,
      ci.sku AS item_sku,
      (array_agg(ph.unit_cost ORDER BY ph.observed_at DESC))[1] AS latest_cost,
      (array_agg(ph.observed_at ORDER BY ph.observed_at DESC))[1] AS latest_at,
      avg(ph.unit_cost) FILTER (
        WHERE ph.observed_at < now() - interval '30 days'
          AND ph.observed_at >= now() - interval '120 days'
      ) AS trailing_avg_cost,
      count(*) AS price_points
    FROM supply_chain.v_vendor_price_history ph
    LEFT JOIN inventory.catalog_items ci ON ci.id = ph.catalog_item_id
    WHERE ph.tenant_id = p_tenant_id
      AND (p_vendor_id IS NULL OR ph.vendor_id = p_vendor_id)
    GROUP BY ph.vendor_id, ph.catalog_item_id, ci.name, ci.sku
  )
  SELECT COALESCE(jsonb_object_agg(v.id, jsonb_build_object(
    'vendor_id', v.id,
    'vendor_name', v.name,
    'lead_time', CASE WHEN l.vendor_id IS NULL THEN NULL ELSE jsonb_build_object(
      'avg_actual_days', l.avg_lead_days,
      'p90_actual_days', l.p90_lead_days,
      'configured_days', c.configured_lead_days,
      'delivery_count', l.delivery_count,
      'last_delivery_at', l.last_delivery_at
    ) END,
    'price_trends', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'catalog_item_id', p.catalog_item_id,
        'item_name', p.item_name,
        'item_sku', p.item_sku,
        'latest_cost', round(p.latest_cost::numeric, 4),
        'latest_at', p.latest_at,
        'trailing_avg_cost', round(p.trailing_avg_cost::numeric, 4),
        'pct_change', CASE
          WHEN p.trailing_avg_cost IS NULL OR p.trailing_avg_cost = 0 THEN NULL
          ELSE round(((p.latest_cost - p.trailing_avg_cost) / p.trailing_avg_cost * 100)::numeric, 1)
        END,
        'price_points', p.price_points
      ) ORDER BY abs(COALESCE(
            CASE WHEN p.trailing_avg_cost IS NULL OR p.trailing_avg_cost = 0 THEN NULL
                 ELSE (p.latest_cost - p.trailing_avg_cost) / p.trailing_avg_cost END, 0)) DESC)
      FROM priced p WHERE p.vendor_id = v.id
    ), '[]'::jsonb)
  )), '{}'::jsonb)
  FROM supply_chain.vendors v
  LEFT JOIN lead l ON l.vendor_id = v.id
  LEFT JOIN configured c ON c.vendor_id = v.id
  WHERE v.tenant_id = p_tenant_id
    AND (p_vendor_id IS NULL OR v.id = p_vendor_id)
    AND (l.vendor_id IS NOT NULL OR EXISTS (
      SELECT 1 FROM priced p WHERE p.vendor_id = v.id
    ));
$$;
