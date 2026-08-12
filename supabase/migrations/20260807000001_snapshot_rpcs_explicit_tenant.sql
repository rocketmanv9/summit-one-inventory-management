-- Snapshot RPCs: accept an explicit tenant id so service-role callers don't
-- depend on a cross-request GUC.
--
-- ROOT CAUSE this fixes:
--   `rpc_item_stock_snapshot` and `rpc_location_inventory_snapshot` are
--   SECURITY DEFINER and resolve tenant via `public.current_tenant_id()`, which
--   for a service-role client reads the `app.current_tenant_id` GUC set by a
--   SEPARATE prior `set_claim` PostgREST request (chassis `setRLSContext`, using
--   `set_config(..., is_local => false)`). Over the pooled PostgREST/PgBouncer
--   connection, the snapshot RPC can land on a different backend than the one
--   that ran `set_claim`, so the GUC is absent, `current_tenant_id()` returns
--   NULL, and the RPC raises `Authentication required`. The API route
--   (`/api/inventory/items/[id]/snapshot`) caught this in a broad handler and
--   surfaced the opaque "Snapshot failed" Grant hit on 2026-08-06; the transfer
--   sheet's "no stock on hand at any location" was the same failure (empty
--   snapshot -> empty fromOptions).
--
-- FIX: add an optional `p_tenant_id uuid DEFAULT NULL`. When the caller passes a
-- tenant (service-role API routes, which have it from the authenticated session)
-- it is used directly, in the SAME call — no dependency on a prior request's
-- GUC. When NULL (browser/user-JWT callers) we fall back to
-- `current_tenant_id()`, preserving existing web behaviour unchanged.

-- Drop the old single-arg signatures first. Adding `p_tenant_id` with a DEFAULT
-- would otherwise create a SECOND overload alongside the 1-arg version, which
-- PostgREST cannot disambiguate (PGRST203). We keep exactly one signature; the
-- new one is call-compatible with every existing 1-arg caller (default NULL).
DROP FUNCTION IF EXISTS inventory.rpc_item_stock_snapshot(uuid);
DROP FUNCTION IF EXISTS inventory.rpc_location_inventory_snapshot(uuid);

-- ── rpc_item_stock_snapshot ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION inventory.rpc_item_stock_snapshot(
  p_catalog_item_id uuid,
  p_tenant_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'inventory', 'public'
AS $function$
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
  -- Auth: prefer the explicitly-passed tenant (service-role callers), else the
  -- session/JWT tenant (browser callers). Explicit id removes the cross-request
  -- GUC dependency that made this RPC flake for the mobile service path.
  v_tenant_id := COALESCE(p_tenant_id, public.current_tenant_id());
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
$function$;

-- ── rpc_location_inventory_snapshot ────────────────────────────────────────
CREATE OR REPLACE FUNCTION inventory.rpc_location_inventory_snapshot(
  p_location_id uuid,
  p_tenant_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'inventory', 'supply_chain', 'public'
AS $function$
DECLARE
  v_tenant_id   uuid;
  v_location    record;
  v_totals      record;
  v_items       jsonb;
  v_assets      jsonb;
  v_asset_count int;
BEGIN
  -- Auth: explicit tenant (service-role callers) wins, else session/JWT tenant.
  v_tenant_id := COALESCE(p_tenant_id, public.current_tenant_id());
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify location exists and belongs to tenant
  SELECT l.id, l.name, l.address, l.active,
         lt.name AS location_type_name,
         l.max_capacity, l.capacity_uom_term_id
  INTO v_location
  FROM inventory.locations l
  LEFT JOIN inventory.location_types lt ON lt.id = l.location_type_id AND lt.tenant_id = v_tenant_id
  WHERE l.id = p_location_id AND l.tenant_id = v_tenant_id;

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
      ci.name AS item_name,
      ci.sku,
      ci.uom_term_id,
      sb.qty_on_hand AS on_hand,
      sb.qty_reserved AS reserved,
      sb.qty_available AS available
    FROM inventory.stock_balances sb
    JOIN inventory.catalog_items ci ON ci.id = sb.catalog_item_id
      AND ci.tenant_id = v_tenant_id AND ci.deleted_at IS NULL
    WHERE sb.tenant_id = v_tenant_id
      AND sb.location_id = p_location_id
      AND (sb.qty_on_hand != 0 OR sb.qty_reserved != 0)
  ) r;

  -- Serialized assets at this location
  SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb ORDER BY r.item_name, r.asset_tag), '[]'::jsonb)
  INTO v_assets
  FROM (
    SELECT
      a.id AS asset_id,
      a.asset_tag,
      a.serial_number,
      a.status,
      a.catalog_item_id AS item_id,
      ci.name AS item_name,
      ci.sku
    FROM inventory.assets a
    LEFT JOIN inventory.catalog_items ci ON ci.id = a.catalog_item_id AND ci.tenant_id = v_tenant_id
    WHERE a.tenant_id = v_tenant_id
      AND a.location_id = p_location_id
      AND a.status != 'retired'
  ) r;

  SELECT COUNT(*) INTO v_asset_count
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
      'capacity_uom_term_id', v_location.capacity_uom_term_id
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
$function$;

-- Re-grant EXECUTE (DROP removed the old grants). Mirrors prior privileges:
-- authenticated (web/user JWT) and service_role (API routes); NOT anon.
REVOKE ALL ON FUNCTION inventory.rpc_item_stock_snapshot(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory.rpc_location_inventory_snapshot(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory.rpc_item_stock_snapshot(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION inventory.rpc_location_inventory_snapshot(uuid, uuid) TO authenticated, service_role;
