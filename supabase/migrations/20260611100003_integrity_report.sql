-- Inventory integrity report: invariant checks between the stock read model,
-- the movements ledger, reservations, and PO line quantities. Read-only.
-- Called nightly by cron and on demand from the Integrity panel.

CREATE OR REPLACE FUNCTION inventory.rpc_integrity_report(p_tenant_id UUID)
RETURNS TABLE (
  check_name TEXT,
  severity   TEXT,
  entity     JSONB,
  detail     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public'
AS $$
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id is required';
  END IF;

  -- 1. stock_balances.qty_on_hand must equal the sum of posted ledger movements.
  RETURN QUERY
  SELECT
    'balance_vs_ledger'::text,
    'error'::text,
    jsonb_build_object(
      'catalog_item_id', COALESCE(b.catalog_item_id, m.catalog_item_id),
      'location_id', COALESCE(b.location_id, m.location_id),
      'qty_on_hand', COALESCE(b.qty_on_hand, 0),
      'ledger_sum', COALESCE(m.ledger_sum, 0)
    ),
    format('Balance %s does not match posted ledger sum %s',
           COALESCE(b.qty_on_hand, 0), COALESCE(m.ledger_sum, 0))
  FROM (
    SELECT sb.catalog_item_id, sb.location_id, sb.qty_on_hand
    FROM inventory.stock_balances sb
    WHERE sb.tenant_id = p_tenant_id
  ) b
  FULL OUTER JOIN (
    SELECT sm.catalog_item_id, sm.location_id, SUM(sm.quantity_delta) AS ledger_sum
    FROM inventory.stock_movements sm
    WHERE sm.tenant_id = p_tenant_id AND sm.posting_status = 'posted'
    GROUP BY sm.catalog_item_id, sm.location_id
  ) m
    ON m.catalog_item_id = b.catalog_item_id AND m.location_id = b.location_id
  WHERE abs(COALESCE(b.qty_on_hand, 0) - COALESCE(m.ledger_sum, 0)) > 0.0001;

  -- 2. stock_balances.qty_reserved must equal active fungible reservations.
  RETURN QUERY
  SELECT
    'reserved_vs_reservations'::text,
    'error'::text,
    jsonb_build_object(
      'catalog_item_id', COALESCE(b.catalog_item_id, r.catalog_item_id),
      'location_id', COALESCE(b.location_id, r.location_id),
      'qty_reserved', COALESCE(b.qty_reserved, 0),
      'active_reservations', COALESCE(r.reserved_sum, 0)
    ),
    format('qty_reserved %s does not match active reservations %s',
           COALESCE(b.qty_reserved, 0), COALESCE(r.reserved_sum, 0))
  FROM (
    SELECT sb.catalog_item_id, sb.location_id, sb.qty_reserved
    FROM inventory.stock_balances sb
    WHERE sb.tenant_id = p_tenant_id AND sb.qty_reserved <> 0
  ) b
  FULL OUTER JOIN (
    SELECT res.catalog_item_id, res.location_id, SUM(res.qty) AS reserved_sum
    FROM inventory.reservations res
    WHERE res.tenant_id = p_tenant_id
      AND res.status = 'active'
      AND res.reservation_type = 'fungible'
    GROUP BY res.catalog_item_id, res.location_id
  ) r
    ON r.catalog_item_id = b.catalog_item_id AND r.location_id = b.location_id
  WHERE abs(COALESCE(b.qty_reserved, 0) - COALESCE(r.reserved_sum, 0)) > 0.0001;

  -- 3. Negative on-hand balances (warning — may be allowed by settings).
  RETURN QUERY
  SELECT
    'negative_on_hand'::text,
    'warning'::text,
    jsonb_build_object(
      'catalog_item_id', sb.catalog_item_id,
      'location_id', sb.location_id,
      'qty_on_hand', sb.qty_on_hand
    ),
    format('Negative on-hand quantity: %s', sb.qty_on_hand)
  FROM inventory.stock_balances sb
  WHERE sb.tenant_id = p_tenant_id AND sb.qty_on_hand < 0;

  -- 4. PO lines over-received without permission.
  RETURN QUERY
  SELECT
    'over_received_line'::text,
    'warning'::text,
    jsonb_build_object(
      'po_id', po.id,
      'po_number', po.po_number,
      'po_line_id', pol.id,
      'catalog_item_id', pol.catalog_item_id,
      'qty_ordered', pol.qty_ordered,
      'qty_received', pol.qty_received
    ),
    format('PO %s line %s received %s of %s ordered (over-delivery not allowed)',
           po.po_number, pol.line_number, pol.qty_received, pol.qty_ordered)
  FROM supply_chain.purchase_order_lines pol
  JOIN supply_chain.purchase_orders po ON po.id = pol.po_id
  WHERE pol.tenant_id = p_tenant_id
    AND COALESCE(pol.allow_over_delivery, false) = false
    AND pol.qty_received > pol.qty_ordered + 0.0001;

  -- 5. PO header says fully received but lines are still outstanding.
  RETURN QUERY
  SELECT
    'po_status_vs_lines'::text,
    'error'::text,
    jsonb_build_object('po_id', po.id, 'po_number', po.po_number, 'status', po.status),
    format('PO %s is marked %s but has outstanding line quantities', po.po_number, po.status)
  FROM supply_chain.purchase_orders po
  WHERE po.tenant_id = p_tenant_id
    AND po.status = 'fully_received'
    AND EXISTS (
      SELECT 1 FROM supply_chain.purchase_order_lines pol
      WHERE pol.po_id = po.id
        AND COALESCE(pol.qty_received, 0) < pol.qty_ordered - 0.0001
    );

  RETURN;
END;
$$;
