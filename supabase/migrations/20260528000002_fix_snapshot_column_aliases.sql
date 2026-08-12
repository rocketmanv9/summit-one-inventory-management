-- ============================================================================
-- Fix: rpc_item_stock_snapshot missing column aliases on v_totals
-- The deployed function was missing AS on_hand / AS reserved / AS available
-- aliases on the SELECT INTO v_totals queries, causing:
--   "record v_totals has no field on_hand"
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory.rpc_item_stock_snapshot(p_catalog_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'public'
AS $$
DECLARE
  v_tenant_id       uuid;
  v_item            record;
  v_totals          record;
  v_inbound         numeric(18,4);
  v_locations       jsonb;
  v_last_movement   timestamptz;
  v_last_count      timestamptz;
  v_variants        jsonb := NULL;
BEGIN
  -- Auth
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify item exists and belongs to tenant
  SELECT ci.id, ci.name, ci.sku, ci.barcode,
         ci.uom_term_id, ci.tracking_mode,
         ci.reorder_point, ci.active, ci.last_event_id,
         ci.is_parent, ci.parent_item_id, ci.variant_attributes,
         ci.variant_dimensions, ci.variant_options,
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

  -- If this is a parent item, aggregate stock across ALL variants
  IF v_item.is_parent THEN
    SELECT
      COALESCE(SUM(sb.qty_on_hand), 0)   AS on_hand,
      COALESCE(SUM(sb.qty_reserved), 0)  AS reserved,
      COALESCE(SUM(sb.qty_available), 0) AS available
    INTO v_totals
    FROM inventory.stock_balances sb
    WHERE sb.tenant_id = v_tenant_id
      AND sb.catalog_item_id IN (
        SELECT ci2.id FROM inventory.catalog_items ci2
        WHERE ci2.tenant_id = v_tenant_id
          AND ci2.parent_item_id = p_catalog_item_id
          AND ci2.deleted_at IS NULL
      );

    -- Inbound across all variants
    SELECT COALESCE(SUM(pol.qty_ordered - pol.qty_received), 0)
    INTO v_inbound
    FROM supply_chain.purchase_order_lines pol
    JOIN supply_chain.purchase_orders po ON po.id = pol.po_id AND po.tenant_id = v_tenant_id
    WHERE pol.tenant_id = v_tenant_id
      AND pol.catalog_item_id IN (
        SELECT ci2.id FROM inventory.catalog_items ci2
        WHERE ci2.tenant_id = v_tenant_id
          AND ci2.parent_item_id = p_catalog_item_id
          AND ci2.deleted_at IS NULL
      )
      AND pol.status IN ('open', 'partially_received', 'pending')
      AND po.status NOT IN ('cancelled', 'closed', 'fully_received', 'draft');

    -- Per-location breakdown (aggregate all variants per location)
    SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb ORDER BY r.location_name), '[]'::jsonb)
    INTO v_locations
    FROM (
      SELECT
        sb.location_id,
        l.name AS location_name,
        SUM(sb.qty_on_hand)   AS on_hand,
        SUM(sb.qty_reserved)  AS reserved,
        SUM(sb.qty_available) AS available
      FROM inventory.stock_balances sb
      JOIN inventory.locations l ON l.id = sb.location_id AND l.tenant_id = v_tenant_id
      WHERE sb.tenant_id = v_tenant_id
        AND sb.catalog_item_id IN (
          SELECT ci2.id FROM inventory.catalog_items ci2
          WHERE ci2.tenant_id = v_tenant_id
            AND ci2.parent_item_id = p_catalog_item_id
            AND ci2.deleted_at IS NULL
        )
      GROUP BY sb.location_id, l.name
      HAVING SUM(sb.qty_on_hand) != 0 OR SUM(sb.qty_reserved) != 0
    ) r;

    -- Last movement for any variant
    SELECT MAX(sm.occurred_at)
    INTO v_last_movement
    FROM inventory.stock_movements sm
    WHERE sm.tenant_id = v_tenant_id
      AND sm.catalog_item_id IN (
        SELECT ci2.id FROM inventory.catalog_items ci2
        WHERE ci2.tenant_id = v_tenant_id
          AND ci2.parent_item_id = p_catalog_item_id
          AND ci2.deleted_at IS NULL
      )
      AND sm.posting_status = 'posted';

    -- Last count for any variant
    SELECT MAX(sm.occurred_at)
    INTO v_last_count
    FROM inventory.stock_movements sm
    WHERE sm.tenant_id = v_tenant_id
      AND sm.catalog_item_id IN (
        SELECT ci2.id FROM inventory.catalog_items ci2
        WHERE ci2.tenant_id = v_tenant_id
          AND ci2.parent_item_id = p_catalog_item_id
          AND ci2.deleted_at IS NULL
      )
      AND sm.movement_type = 'counted'
      AND sm.posting_status = 'posted';

    -- Build per-variant stock breakdown
    SELECT COALESCE(jsonb_agg(row_to_json(vr)::jsonb ORDER BY vr.variant_name), '[]'::jsonb)
    INTO v_variants
    FROM (
      SELECT
        ci2.id AS variant_id,
        ci2.name AS variant_name,
        ci2.sku AS variant_sku,
        ci2.barcode AS variant_barcode,
        ci2.variant_attributes,
        COALESCE(SUM(sb.qty_on_hand), 0) AS on_hand,
        COALESCE(SUM(sb.qty_reserved), 0) AS reserved,
        COALESCE(SUM(sb.qty_available), 0) AS available
      FROM inventory.catalog_items ci2
      LEFT JOIN inventory.stock_balances sb
        ON sb.catalog_item_id = ci2.id AND sb.tenant_id = v_tenant_id
      WHERE ci2.tenant_id = v_tenant_id
        AND ci2.parent_item_id = p_catalog_item_id
        AND ci2.deleted_at IS NULL
      GROUP BY ci2.id, ci2.name, ci2.sku, ci2.barcode, ci2.variant_attributes
    ) vr;

  ELSE
    -- Regular item or variant child — return its own stock
    SELECT
      COALESCE(SUM(sb.qty_on_hand), 0)   AS on_hand,
      COALESCE(SUM(sb.qty_reserved), 0)  AS reserved,
      COALESCE(SUM(sb.qty_available), 0) AS available
    INTO v_totals
    FROM inventory.stock_balances sb
    WHERE sb.tenant_id = v_tenant_id
      AND sb.catalog_item_id = p_catalog_item_id;

    -- Inbound
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

    -- Last movement
    SELECT MAX(sm.occurred_at)
    INTO v_last_movement
    FROM inventory.stock_movements sm
    WHERE sm.tenant_id = v_tenant_id
      AND sm.catalog_item_id = p_catalog_item_id
      AND sm.posting_status = 'posted';

    -- Last count
    SELECT MAX(sm.occurred_at)
    INTO v_last_count
    FROM inventory.stock_movements sm
    WHERE sm.tenant_id = v_tenant_id
      AND sm.catalog_item_id = p_catalog_item_id
      AND sm.movement_type = 'counted'
      AND sm.posting_status = 'posted';
  END IF;

  RETURN jsonb_build_object(
    'item', jsonb_build_object(
      'id', v_item.id,
      'name', v_item.name,
      'sku', v_item.sku,
      'barcode', v_item.barcode,
      'uom_term_id', v_item.uom_term_id,
      'tracking_mode', v_item.tracking_mode,
      'reorder_point', v_item.reorder_point,
      'category_name', v_item.category_name,
      'active', v_item.active,
      'last_event_id', v_item.last_event_id,
      'is_parent', v_item.is_parent,
      'parent_item_id', v_item.parent_item_id,
      'variant_attributes', v_item.variant_attributes,
      'variant_dimensions', v_item.variant_dimensions,
      'variant_options', v_item.variant_options
    ),
    'on_hand', v_totals.on_hand,
    'reserved', v_totals.reserved,
    'available', v_totals.available,
    'inbound', v_inbound,
    'locations', v_locations,
    'last_movement_at', v_last_movement,
    'last_count_at', v_last_count,
    'variants', v_variants
  );
END;
$$;

ALTER FUNCTION inventory.rpc_item_stock_snapshot(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION inventory.rpc_item_stock_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION inventory.rpc_item_stock_snapshot(uuid) TO service_role;
