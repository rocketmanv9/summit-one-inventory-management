-- Migration: Global Search + Stock Snapshot RPC functions
-- Purpose: Enable "Where is it and how much do we have?" in < 10 seconds
--
-- Adds:
--   1. pg_trgm extension + GIN trigram indexes for fast ILIKE search
--   2. rpc_global_search()         - cross-entity search
--   3. rpc_item_stock_snapshot()   - item-level on_hand/reserved/available/inbound
--   4. rpc_location_inventory_snapshot() - location-level "what's here"
--
-- All functions are tenant-scoped via current_tenant_id().
-- No new tables; reads from existing stock_balances, reservations, PO lines.

-- =============================================================================
-- 1. Enable pg_trgm for trigram indexes (fast ILIKE / similarity search)
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================================================
-- 2. GIN trigram indexes for search (fast partial/prefix ILIKE)
-- =============================================================================

-- catalog_items: search by name, sku
CREATE INDEX IF NOT EXISTS idx_catalog_items_name_trgm
  ON inventory.catalog_items USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_catalog_items_sku_trgm
  ON inventory.catalog_items USING gin (sku gin_trgm_ops);

-- assets: search by asset_tag, serial_number
CREATE INDEX IF NOT EXISTS idx_assets_asset_tag_trgm
  ON inventory.assets USING gin (asset_tag gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_assets_serial_number_trgm
  ON inventory.assets USING gin (serial_number gin_trgm_ops);

-- locations: search by name
CREATE INDEX IF NOT EXISTS idx_locations_name_trgm
  ON inventory.locations USING gin (name gin_trgm_ops);

-- vendors: search by name, code
CREATE INDEX IF NOT EXISTS idx_vendors_name_trgm
  ON supply_chain.vendors USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_vendors_code_trgm
  ON supply_chain.vendors USING gin (code gin_trgm_ops);

-- purchase_orders: search by po_number
CREATE INDEX IF NOT EXISTS idx_purchase_orders_po_number_trgm
  ON supply_chain.purchase_orders USING gin (po_number gin_trgm_ops);

-- reservations: job_ref is jsonb so skip trigram index
-- (baseline already has idx_reservations_job_ref GIN index on the jsonb column)

-- =============================================================================
-- 3. rpc_global_search - Cross-entity search
-- =============================================================================
CREATE OR REPLACE FUNCTION inventory.rpc_global_search(
  p_query  text,
  p_limit  int DEFAULT 5
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public'
AS $$
DECLARE
  v_tenant_id  uuid;
  v_pattern    text;
  v_items      jsonb;
  v_assets     jsonb;
  v_locations  jsonb;
  v_vendors    jsonb;
  v_pos        jsonb;
  v_reservations jsonb;
BEGIN
  -- Auth
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Sanitize and build ILIKE pattern
  v_pattern := '%' || trim(p_query) || '%';

  -- Clamp limit
  IF p_limit < 1 THEN p_limit := 5; END IF;
  IF p_limit > 20 THEN p_limit := 20; END IF;

  -- Items
  SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT ci.id, ci.name, ci.sku,
           '/inventory/items/' || ci.id AS url_hint
    FROM inventory.catalog_items ci
    WHERE ci.tenant_id = v_tenant_id
      AND ci.deleted_at IS NULL
      AND (ci.name ILIKE v_pattern OR ci.sku ILIKE v_pattern)
    ORDER BY
      CASE WHEN ci.name ILIKE trim(p_query) || '%' THEN 0 ELSE 1 END,
      ci.name
    LIMIT p_limit
  ) r;

  -- Assets
  SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb), '[]'::jsonb)
  INTO v_assets
  FROM (
    SELECT a.id, a.asset_tag AS tag, a.serial_number, a.status,
           '/inventory/assets?asset_id=' || a.id AS url_hint
    FROM inventory.assets a
    WHERE a.tenant_id = v_tenant_id
      AND (a.asset_tag ILIKE v_pattern
           OR a.serial_number ILIKE v_pattern
           OR a.vin ILIKE v_pattern)
    ORDER BY
      CASE WHEN a.asset_tag ILIKE trim(p_query) || '%' THEN 0 ELSE 1 END,
      a.asset_tag
    LIMIT p_limit
  ) r;

  -- Locations
  SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb), '[]'::jsonb)
  INTO v_locations
  FROM (
    SELECT l.id, l.name, l.address,
           '/inventory/locations/' || l.id AS url_hint
    FROM inventory.locations l
    WHERE l.tenant_id = v_tenant_id
      AND l.active = true
      AND l.name ILIKE v_pattern
    ORDER BY
      CASE WHEN l.name ILIKE trim(p_query) || '%' THEN 0 ELSE 1 END,
      l.name
    LIMIT p_limit
  ) r;

  -- Vendors
  SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb), '[]'::jsonb)
  INTO v_vendors
  FROM (
    SELECT v.id, v.name, v.code,
           '/inventory/vendors/' || v.id || '/items' AS url_hint
    FROM supply_chain.vendors v
    WHERE v.tenant_id = v_tenant_id
      AND v.active = true
      AND (v.name ILIKE v_pattern OR v.code ILIKE v_pattern)
    ORDER BY
      CASE WHEN v.name ILIKE trim(p_query) || '%' THEN 0 ELSE 1 END,
      v.name
    LIMIT p_limit
  ) r;

  -- Purchase Orders
  SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb), '[]'::jsonb)
  INTO v_pos
  FROM (
    SELECT po.id, po.po_number, po.vendor_name_snapshot AS vendor_name, po.status,
           '/inventory/purchasing?po_id=' || po.id AS url_hint
    FROM supply_chain.purchase_orders po
    WHERE po.tenant_id = v_tenant_id
      AND (po.po_number ILIKE v_pattern
           OR po.vendor_name_snapshot ILIKE v_pattern
           OR po.external_order_number ILIKE v_pattern)
    ORDER BY po.created_at DESC
    LIMIT p_limit
  ) r;

  -- Reservations
  SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb), '[]'::jsonb)
  INTO v_reservations
  FROM (
    SELECT res.id,
           res.job_ref AS ref,
           res.status,
           res.qty,
           '/inventory/reservations?res_id=' || res.id AS url_hint
    FROM inventory.reservations res
    WHERE res.tenant_id = v_tenant_id
      AND res.job_ref::text ILIKE v_pattern
    ORDER BY res.created_at DESC
    LIMIT p_limit
  ) r;

  RETURN jsonb_build_object(
    'items', v_items,
    'assets', v_assets,
    'locations', v_locations,
    'vendors', v_vendors,
    'purchase_orders', v_pos,
    'reservations', v_reservations
  );
END;
$$;

ALTER FUNCTION inventory.rpc_global_search OWNER TO postgres;
GRANT EXECUTE ON FUNCTION inventory.rpc_global_search TO authenticated;
GRANT EXECUTE ON FUNCTION inventory.rpc_global_search TO service_role;

COMMENT ON FUNCTION inventory.rpc_global_search IS
'Cross-entity search: items, assets, locations, vendors, POs, reservations.
Tenant-scoped via current_tenant_id(). Uses ILIKE with GIN trigram indexes.';

-- =============================================================================
-- 4. rpc_item_stock_snapshot - Item-level stock aggregation
-- =============================================================================
CREATE OR REPLACE FUNCTION inventory.rpc_item_stock_snapshot(
  p_catalog_item_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public'
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
  SELECT ci.id, ci.name, ci.sku, ci.unit_of_measure, ci.tracking_mode,
         ci.reorder_point, ci.active,
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

  -- Last count timestamp (from cycle counts or 'counted' movements)
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
      'unit_of_measure', v_item.unit_of_measure,
      'tracking_mode', v_item.tracking_mode,
      'reorder_point', v_item.reorder_point,
      'category_name', v_item.category_name,
      'active', v_item.active
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

ALTER FUNCTION inventory.rpc_item_stock_snapshot OWNER TO postgres;
GRANT EXECUTE ON FUNCTION inventory.rpc_item_stock_snapshot TO authenticated;
GRANT EXECUTE ON FUNCTION inventory.rpc_item_stock_snapshot TO service_role;

COMMENT ON FUNCTION inventory.rpc_item_stock_snapshot IS
'Returns a complete stock snapshot for a catalog item:
on_hand, reserved, available (from stock_balances trigger-maintained read model),
inbound (from open PO lines), per-location breakdown, and last movement/count timestamps.
Tenant-scoped via current_tenant_id(). No new tables - reads existing data.';

-- =============================================================================
-- 5. rpc_location_inventory_snapshot - Location-level "what is here"
-- =============================================================================
CREATE OR REPLACE FUNCTION inventory.rpc_location_inventory_snapshot(
  p_location_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public'
AS $$
DECLARE
  v_tenant_id   uuid;
  v_location    record;
  v_totals      record;
  v_items       jsonb;
BEGIN
  -- Auth
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify location exists and belongs to tenant
  SELECT l.id, l.name, l.address, l.active,
         lt.name AS location_type_name,
         l.max_capacity, l.capacity_uom
  INTO v_location
  FROM inventory.locations l
  LEFT JOIN inventory.location_types lt ON lt.id = l.location_type_id AND lt.tenant_id = v_tenant_id
  WHERE l.id = p_location_id
    AND l.tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Location not found';
  END IF;

  -- Aggregate totals
  SELECT
    COALESCE(SUM(sb.qty_on_hand), 0)   AS on_hand,
    COALESCE(SUM(sb.qty_reserved), 0)  AS reserved,
    COALESCE(SUM(sb.qty_available), 0) AS available
  INTO v_totals
  FROM inventory.stock_balances sb
  WHERE sb.tenant_id = v_tenant_id
    AND sb.location_id = p_location_id;

  -- Items at this location
  SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb ORDER BY r.item_name), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      sb.catalog_item_id AS item_id,
      ci.name            AS item_name,
      ci.sku,
      ci.unit_of_measure,
      sb.qty_on_hand     AS on_hand,
      sb.qty_reserved    AS reserved,
      sb.qty_available   AS available
    FROM inventory.stock_balances sb
    JOIN inventory.catalog_items ci
      ON ci.id = sb.catalog_item_id
      AND ci.tenant_id = v_tenant_id
      AND ci.deleted_at IS NULL
    WHERE sb.tenant_id = v_tenant_id
      AND sb.location_id = p_location_id
      AND (sb.qty_on_hand != 0 OR sb.qty_reserved != 0)
  ) r;

  RETURN jsonb_build_object(
    'location', jsonb_build_object(
      'id', v_location.id,
      'name', v_location.name,
      'address', v_location.address,
      'active', v_location.active,
      'location_type', v_location.location_type_name,
      'max_capacity', v_location.max_capacity,
      'capacity_uom', v_location.capacity_uom
    ),
    'totals', jsonb_build_object(
      'on_hand', v_totals.on_hand,
      'reserved', v_totals.reserved,
      'available', v_totals.available
    ),
    'items', v_items
  );
END;
$$;

ALTER FUNCTION inventory.rpc_location_inventory_snapshot OWNER TO postgres;
GRANT EXECUTE ON FUNCTION inventory.rpc_location_inventory_snapshot TO authenticated;
GRANT EXECUTE ON FUNCTION inventory.rpc_location_inventory_snapshot TO service_role;

COMMENT ON FUNCTION inventory.rpc_location_inventory_snapshot IS
'Returns "What is here?" for a location: totals (on_hand, reserved, available) and
itemized breakdown with SKU/name. Tenant-scoped via current_tenant_id().';

-- =============================================================================
-- 6. Register new RPC events in event_catalog (documentation only)
-- =============================================================================
INSERT INTO public.event_catalog (event_key, display_name, description, owner_module, aggregate_type, event_version)
VALUES
  ('inventory.search.global', 'Global Search', 'Cross-entity search across items, assets, locations, vendors, POs, reservations', 'inventory', 'search', 1),
  ('inventory.item.stock_snapshot', 'Item Stock Snapshot', 'On-the-fly aggregation of stock_balances + open PO inbound for a catalog item', 'inventory', 'catalog_item', 1),
  ('inventory.location.inventory_snapshot', 'Location Inventory Snapshot', 'On-the-fly aggregation of stock_balances for a location', 'inventory', 'location', 1)
ON CONFLICT (event_key) DO NOTHING;
