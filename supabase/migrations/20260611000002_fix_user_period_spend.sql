-- Fix user_period_spend: it required approved_at IS NOT NULL, so auto-approved /
-- Amazon punchout POs (which never stamp approved_at) counted as $0 spend. It also
-- omitted the 'ordered'/'in_transit' statuses. Use COALESCE(approved_at, created_at)
-- for the period window and include the full committed status set.

CREATE OR REPLACE FUNCTION supply_chain.user_period_spend(
  p_tenant UUID,
  p_user   UUID,
  p_start  DATE,
  p_end    DATE
) RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'supply_chain','public' AS $$
  SELECT COALESCE(SUM(pol.qty_ordered * COALESCE(pol.unit_cost, pol.estimated_unit_cost, 0)), 0)
  FROM supply_chain.purchase_orders po
  JOIN supply_chain.purchase_order_lines pol
    ON pol.po_id = po.id AND pol.tenant_id = po.tenant_id
  WHERE po.tenant_id = p_tenant
    AND po.created_by_user_id = p_user
    AND po.status IN ('approved','sent','placed','acknowledged','ordered','in_transit','partially_received','fully_received','closed')
    AND COALESCE(po.approved_at, po.created_at) >= p_start::timestamptz
    AND COALESCE(po.approved_at, po.created_at) <  p_end::timestamptz;
$$;
