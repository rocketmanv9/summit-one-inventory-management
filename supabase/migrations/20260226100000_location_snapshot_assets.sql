-- Migration: Add assets to location inventory snapshot
-- The original rpc_location_inventory_snapshot only returned fungible stock_balances.
-- Serialized items (assets) at a location were missing. This adds an "assets" array.

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
  v_assets      jsonb;
  v_asset_count int;
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

  -- Aggregate totals (fungible stock)
  SELECT
    COALESCE(SUM(sb.qty_on_hand), 0)   AS on_hand,
    COALESCE(SUM(sb.qty_reserved), 0)  AS reserved,
    COALESCE(SUM(sb.qty_available), 0) AS available
  INTO v_totals
  FROM inventory.stock_balances sb
  WHERE sb.tenant_id = v_tenant_id
    AND sb.location_id = p_location_id;

  -- Fungible items at this location
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

  -- Serialized assets at this location
  SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb ORDER BY r.item_name, r.asset_tag), '[]'::jsonb)
  INTO v_assets
  FROM (
    SELECT
      a.id              AS asset_id,
      a.asset_tag,
      a.serial_number,
      a.status,
      a.catalog_item_id AS item_id,
      ci.name           AS item_name,
      ci.sku
    FROM inventory.assets a
    LEFT JOIN inventory.catalog_items ci
      ON ci.id = a.catalog_item_id
      AND ci.tenant_id = v_tenant_id
    WHERE a.tenant_id = v_tenant_id
      AND a.location_id = p_location_id
      AND a.status != 'retired'
  ) r;

  SELECT COUNT(*)
  INTO v_asset_count
  FROM inventory.assets a
  WHERE a.tenant_id = v_tenant_id
    AND a.location_id = p_location_id
    AND a.status != 'retired';

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
      'available', v_totals.available,
      'asset_count', v_asset_count
    ),
    'items', v_items,
    'assets', v_assets
  );
END;
$$;

COMMENT ON FUNCTION inventory.rpc_location_inventory_snapshot IS
'Returns "What is here?" for a location: fungible stock totals (on_hand, reserved, available),
itemized breakdown, and serialized assets. Tenant-scoped via current_tenant_id().';
