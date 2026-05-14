-- Update rpc_item_stock_snapshot to also return barcode and last_event_id
-- so the item detail page can edit identifiers with optimistic concurrency.

CREATE OR REPLACE FUNCTION inventory.rpc_item_stock_snapshot(p_catalog_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id       uuid;
  v_item            record;
  v_totals          record;
  v_inbound         numeric(18,4);
  v_locations       jsonb;
  v_last_movement   timestamptz;
  v_last_count      timestamptz;
BEGIN
  -- Auth
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify item exists and belongs to tenant
  SELECT ci.id, ci.name, ci.sku, ci.barcode, ci.unit_of_measure, ci.tracking_mode,
         ci.reorder_point, ci.active, ci.last_event_id,
         ic.name AS category_name
  INTO v_item
  FROM inventory.catalog_items ci
  LEFT JOIN inventory.item_categories ic ON ic.id = ci.category_id AND ic.tenant_id = v_tenant_id
  WHERE ci.id = p_catalog_item_id
    AND ci.tenant_id = v_tenant_id
    AND ci.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  -- Aggregate totals from stock_balances
  SELECT
    COALESCE(SUM(sb.qty_on_hand), 0)   AS on_hand,
    COALESCE(SUM(sb.qty_reserved), 0)  AS reserved,
    COALESCE(SUM(sb.qty_available), 0) AS available
  INTO v_totals
  FROM inventory.stock_balances sb
  WHERE sb.tenant_id = v_tenant_id
    AND sb.catalog_item_id = p_catalog_item_id;

  -- Inbound: open PO lines qty remaining to receive
  SELECT COALESCE(SUM(pol.qty_ordered - pol.qty_received), 0)
  INTO v_inbound
  FROM supply_chain.purchase_order_lines pol
  JOIN supply_chain.purchase_orders po ON po.id = pol.po_id AND po.tenant_id = v_tenant_id
  WHERE pol.tenant_id = v_tenant_id
    AND pol.catalog_item_id = p_catalog_item_id
    AND pol.status IN ('open', 'partially_received', 'pending')
    AND po.status NOT IN ('cancelled', 'closed', 'fully_received', 'draft');

  -- Per-location breakdown
  SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb ORDER BY r.location_name), '[]'::jsonb)
  INTO v_locations
  FROM (
    SELECT
      sb.location_id,
      l.name AS location_name,
      sb.qty_on_hand  AS on_hand,
      sb.qty_reserved AS reserved,
      sb.qty_available AS available
    FROM inventory.stock_balances sb
    JOIN inventory.locations l ON l.id = sb.location_id AND l.tenant_id = v_tenant_id
    WHERE sb.tenant_id = v_tenant_id
      AND sb.catalog_item_id = p_catalog_item_id
      AND (sb.qty_on_hand != 0 OR sb.qty_reserved != 0)
  ) r;

  -- Last movement timestamp
  SELECT MAX(sm.occurred_at)
  INTO v_last_movement
  FROM inventory.stock_movements sm
  WHERE sm.tenant_id = v_tenant_id
    AND sm.catalog_item_id = p_catalog_item_id
    AND sm.posting_status = 'posted';

  -- Last count timestamp
  SELECT MAX(sm.occurred_at)
  INTO v_last_count
  FROM inventory.stock_movements sm
  WHERE sm.tenant_id = v_tenant_id
    AND sm.catalog_item_id = p_catalog_item_id
    AND sm.movement_type = 'counted'
    AND sm.posting_status = 'posted';

  RETURN jsonb_build_object(
    'item', jsonb_build_object(
      'id', v_item.id,
      'name', v_item.name,
      'sku', v_item.sku,
      'barcode', v_item.barcode,
      'unit_of_measure', v_item.unit_of_measure,
      'tracking_mode', v_item.tracking_mode,
      'reorder_point', v_item.reorder_point,
      'category_name', v_item.category_name,
      'active', v_item.active,
      'last_event_id', v_item.last_event_id
    ),
    'on_hand', v_totals.on_hand,
    'reserved', v_totals.reserved,
    'available', v_totals.available,
    'inbound', v_inbound,
    'locations', v_locations,
    'last_movement_at', v_last_movement,
    'last_count_at', v_last_count
  );
END;
$$;
