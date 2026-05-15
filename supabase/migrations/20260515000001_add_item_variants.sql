-- Migration: Add item variants (parent/child) support to catalog_items
-- Purpose: Enable parent items with dimensions (e.g., Size, Color) and
--          child variant items that inherit from the parent.
--          Variants ARE regular catalog_items, so stock_balances, stock_movements,
--          cycle_count_lines, purchase_order_lines, reservations, and assets
--          all reference the variant's catalog_item_id directly — zero schema changes needed.

-- =============================================================================
-- 1. Add variant columns to catalog_items
-- =============================================================================

ALTER TABLE inventory.catalog_items
  ADD COLUMN IF NOT EXISTS parent_item_id    uuid          NULL REFERENCES inventory.catalog_items(id),
  ADD COLUMN IF NOT EXISTS variant_attributes jsonb         NULL,
  ADD COLUMN IF NOT EXISTS is_parent         boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS variant_dimensions jsonb         NULL,
  ADD COLUMN IF NOT EXISTS variant_options   jsonb         NULL;

COMMENT ON COLUMN inventory.catalog_items.parent_item_id IS 'Self-referential FK to parent item — NULL for standalone/parent items';
COMMENT ON COLUMN inventory.catalog_items.variant_attributes IS 'e.g. {"size":"M","color":"Red"} — set on child variants only';
COMMENT ON COLUMN inventory.catalog_items.is_parent IS 'True for parent template items that have child variants';
COMMENT ON COLUMN inventory.catalog_items.variant_dimensions IS 'Axes available for this parent, e.g. ["size","color"]';
COMMENT ON COLUMN inventory.catalog_items.variant_options IS 'Values per axis, e.g. {"size":["S","M","L","XL"],"color":["Red","Blue"]}';

-- =============================================================================
-- 2. Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_catalog_items_parent_item
  ON inventory.catalog_items (tenant_id, parent_item_id)
  WHERE parent_item_id IS NOT NULL;

-- =============================================================================
-- 3. Constraints
-- =============================================================================

-- Parent items must NOT have a parent_item_id
ALTER TABLE inventory.catalog_items
  ADD CONSTRAINT chk_parent_no_parent
  CHECK (NOT (is_parent = true AND parent_item_id IS NOT NULL));

-- Variant items (those with parent_item_id) must have variant_attributes
ALTER TABLE inventory.catalog_items
  ADD CONSTRAINT chk_variant_has_attributes
  CHECK (parent_item_id IS NULL OR variant_attributes IS NOT NULL);

-- Only parent items may have dimensions / options
ALTER TABLE inventory.catalog_items
  ADD CONSTRAINT chk_only_parent_has_dimensions
  CHECK (is_parent = true OR (variant_dimensions IS NULL AND variant_options IS NULL));

-- =============================================================================
-- 4. RPC: Create item variants atomically
-- =============================================================================

CREATE OR REPLACE FUNCTION inventory.rpc_create_item_variants(
  p_parent_item_id uuid,
  p_variants       jsonb,           -- array of {attributes, sku_suffix, barcode?}
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'public'
AS $$
DECLARE
  v_tenant_id    uuid;
  v_user_id      uuid;
  v_parent       record;
  v_variant      jsonb;
  v_child_id     uuid;
  v_child_sku    text;
  v_child_ids    jsonb := '[]'::jsonb;
  v_suffix       text;
  v_barcode      text;
  v_attrs        jsonb;
  v_event_key    text;
  v_idx          int := 0;
BEGIN
  -- Auth
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_user_id := (auth.jwt() ->> 'user_id')::uuid;
  IF v_user_id IS NULL THEN
    v_user_id := auth.uid();
  END IF;

  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    p_idempotency_key := gen_random_uuid()::text;
  END IF;

  -- Fetch parent
  SELECT ci.id, ci.name, ci.sku, ci.category_id, ci.unit_of_measure,
         ci.tracking_mode, ci.reorder_point, ci.preferred_vendor_id, ci.is_parent
  INTO v_parent
  FROM inventory.catalog_items ci
  WHERE ci.id = p_parent_item_id
    AND ci.tenant_id = v_tenant_id
    AND ci.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent item not found';
  END IF;

  IF v_parent.is_parent IS NOT TRUE THEN
    RAISE EXCEPTION 'Item is not a parent item';
  END IF;

  -- Create each variant
  FOR v_variant IN SELECT * FROM jsonb_array_elements(p_variants) LOOP
    v_idx := v_idx + 1;
    v_suffix  := v_variant ->> 'sku_suffix';
    v_barcode := v_variant ->> 'barcode';
    v_attrs   := v_variant -> 'attributes';
    v_event_key := 'var-' || v_idx || '-' || p_idempotency_key;

    IF v_suffix IS NULL OR trim(v_suffix) = '' THEN
      RAISE EXCEPTION 'sku_suffix is required for each variant';
    END IF;

    IF v_attrs IS NULL OR v_attrs = '{}'::jsonb THEN
      RAISE EXCEPTION 'attributes is required for each variant';
    END IF;

    v_child_sku := v_parent.sku || '-' || upper(trim(v_suffix));

    INSERT INTO inventory.catalog_items (
      tenant_id,
      name,
      sku,
      description,
      category_id,
      unit_of_measure,
      tracking_mode,
      reorder_point,
      preferred_vendor_id,
      parent_item_id,
      variant_attributes,
      is_parent,
      barcode,
      base_sku,
      last_event_id,
      created_by
    ) VALUES (
      v_tenant_id,
      v_parent.name || ' (' || array_to_string(ARRAY(SELECT value FROM jsonb_each_text(v_attrs) ORDER BY key), ', ') || ')',
      v_child_sku,
      NULL,
      v_parent.category_id,
      v_parent.unit_of_measure,
      v_parent.tracking_mode,
      v_parent.reorder_point,
      v_parent.preferred_vendor_id,
      p_parent_item_id,
      v_attrs,
      false,
      v_barcode,
      upper(trim(v_suffix)),
      v_event_key,
      v_user_id
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_child_id;

    -- If idempotent duplicate, look it up
    IF v_child_id IS NULL THEN
      SELECT ci.id INTO v_child_id
      FROM inventory.catalog_items ci
      WHERE ci.tenant_id = v_tenant_id
        AND ci.last_event_id = v_event_key;
    END IF;

    v_child_ids := v_child_ids || to_jsonb(v_child_id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'parent_item_id', p_parent_item_id,
    'variant_ids', v_child_ids,
    'count', jsonb_array_length(v_child_ids)
  );
END;
$$;

ALTER FUNCTION inventory.rpc_create_item_variants OWNER TO postgres;
GRANT EXECUTE ON FUNCTION inventory.rpc_create_item_variants TO authenticated;
GRANT EXECUTE ON FUNCTION inventory.rpc_create_item_variants TO service_role;

-- =============================================================================
-- 5. Update rpc_item_stock_snapshot to return variant data for parent items
-- =============================================================================

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
  v_variants        jsonb := NULL;
  v_variant_totals  record;
BEGIN
  -- Auth
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify item exists and belongs to tenant
  SELECT ci.id, ci.name, ci.sku, ci.barcode, ci.unit_of_measure, ci.tracking_mode,
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
      'unit_of_measure', v_item.unit_of_measure,
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

-- =============================================================================
-- 6. Update wizard to support parent item creation with variants
-- =============================================================================

CREATE OR REPLACE FUNCTION inventory.rpc_wizard_create_item(
  -- Item fields
  p_name             text,
  p_description      text     DEFAULT NULL,
  p_unit_of_measure  text     DEFAULT 'EA',
  p_tracking_mode    text     DEFAULT 'stock',
  p_reorder_point    numeric  DEFAULT NULL,
  p_base_sku         text     DEFAULT NULL,
  p_sku              text     DEFAULT NULL,

  -- Category
  p_category_id      uuid     DEFAULT NULL,
  p_create_category  jsonb    DEFAULT NULL,

  -- Vendor
  p_vendor_id        uuid     DEFAULT NULL,
  p_create_vendor    jsonb    DEFAULT NULL,
  p_vendor_sku       text     DEFAULT NULL,
  p_vendor_unit_cost numeric  DEFAULT NULL,

  -- Location
  p_location_id      uuid     DEFAULT NULL,
  p_create_location  jsonb    DEFAULT NULL,

  -- Initial stock
  p_initial_qty      numeric  DEFAULT NULL,
  p_initial_cost     numeric  DEFAULT NULL,

  -- Barcode
  p_barcode          text     DEFAULT NULL,

  -- Batch asset creation
  p_create_assets    jsonb    DEFAULT NULL,

  -- NEW: Variant support
  p_has_variants       boolean  DEFAULT false,
  p_variant_dimensions jsonb    DEFAULT NULL,  -- e.g. ["size","color"]
  p_variant_options    jsonb    DEFAULT NULL,  -- e.g. {"size":["S","M","L"],"color":["Red","Blue"]}

  -- Idempotency
  p_idempotency_key  text     DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public'
AS $$
DECLARE
  v_tenant_id        uuid;
  v_user_id          uuid;
  v_category_id      uuid;
  v_vendor_id        uuid;
  v_location_id      uuid;
  v_item_id          uuid;
  v_item_sku         text;
  v_event_id         text;
  v_result           jsonb;
  v_created_entities jsonb := '[]'::jsonb;
  v_vendor_item_id   uuid;
  v_asset_row        jsonb;
  v_asset_id         uuid;
  v_asset_tags       jsonb := '[]'::jsonb;
  v_variant_result   jsonb;
BEGIN
  -- Auth
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_user_id := (auth.jwt() ->> 'user_id')::uuid;
  IF v_user_id IS NULL THEN
    v_user_id := auth.uid();
  END IF;

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    SELECT ci.id, ci.sku
    INTO v_item_id, v_item_sku
    FROM inventory.catalog_items ci
    WHERE ci.tenant_id = v_tenant_id
      AND ci.last_event_id = p_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent_hit', true,
        'item_id', v_item_id,
        'item_sku', v_item_sku,
        'created_entities', '[]'::jsonb
      );
    END IF;
  ELSE
    p_idempotency_key := gen_random_uuid()::text;
  END IF;

  -- Validate
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Item name is required';
  END IF;

  -- 1. Resolve or create CATEGORY
  v_category_id := p_category_id;

  IF v_category_id IS NULL AND p_create_category IS NOT NULL THEN
    INSERT INTO inventory.item_categories (
      tenant_id, name, sku_prefix, sku_mode, parent_category_id, last_event_id
    ) VALUES (
      v_tenant_id,
      p_create_category ->> 'name',
      p_create_category ->> 'sku_prefix',
      COALESCE(p_create_category ->> 'sku_mode', 'sequential'),
      (p_create_category ->> 'parent_category_id')::uuid,
      'wiz-cat-' || p_idempotency_key
    )
    ON CONFLICT ON CONSTRAINT item_categories_tenant_id_last_event_id_key
      DO NOTHING
    RETURNING id INTO v_category_id;

    IF v_category_id IS NULL THEN
      SELECT id INTO v_category_id
      FROM inventory.item_categories
      WHERE tenant_id = v_tenant_id
        AND last_event_id = 'wiz-cat-' || p_idempotency_key;
    END IF;

    v_created_entities := v_created_entities || jsonb_build_object(
      'type', 'category',
      'id', v_category_id,
      'name', p_create_category ->> 'name'
    );

    IF v_category_id IS NOT NULL THEN
      INSERT INTO inventory.sku_settings (
        tenant_id, category_id, separator, next_sequence
      ) VALUES (
        v_tenant_id, v_category_id, '-', 1
      ) ON CONFLICT (category_id) DO NOTHING;
    END IF;
  END IF;

  -- 2. Resolve or create VENDOR
  v_vendor_id := p_vendor_id;

  IF v_vendor_id IS NULL AND p_create_vendor IS NOT NULL THEN
    INSERT INTO supply_chain.vendors (
      tenant_id, name, code, contact_name, contact_email, contact_phone,
      payment_terms, lead_time_days, last_event_id
    ) VALUES (
      v_tenant_id,
      p_create_vendor ->> 'name',
      p_create_vendor ->> 'code',
      p_create_vendor ->> 'contact_name',
      p_create_vendor ->> 'contact_email',
      p_create_vendor ->> 'contact_phone',
      COALESCE(p_create_vendor ->> 'payment_terms', 'NET30'),
      (p_create_vendor ->> 'lead_time_days')::integer,
      'wiz-ven-' || p_idempotency_key
    )
    ON CONFLICT ON CONSTRAINT vendors_tenant_id_last_event_id_key
      DO NOTHING
    RETURNING id INTO v_vendor_id;

    IF v_vendor_id IS NULL THEN
      SELECT id INTO v_vendor_id
      FROM supply_chain.vendors
      WHERE tenant_id = v_tenant_id
        AND last_event_id = 'wiz-ven-' || p_idempotency_key;
    END IF;

    v_created_entities := v_created_entities || jsonb_build_object(
      'type', 'vendor',
      'id', v_vendor_id,
      'name', p_create_vendor ->> 'name'
    );
  END IF;

  -- 3. Resolve or create LOCATION
  v_location_id := p_location_id;

  IF v_location_id IS NULL AND p_create_location IS NOT NULL THEN
    INSERT INTO inventory.locations (
      tenant_id, name, location_type_id, address, last_event_id
    ) VALUES (
      v_tenant_id,
      p_create_location ->> 'name',
      (p_create_location ->> 'location_type_id')::uuid,
      p_create_location ->> 'address',
      'wiz-loc-' || p_idempotency_key
    )
    ON CONFLICT ON CONSTRAINT locations_tenant_id_last_event_id_key
      DO NOTHING
    RETURNING id INTO v_location_id;

    IF v_location_id IS NULL THEN
      SELECT id INTO v_location_id
      FROM inventory.locations
      WHERE tenant_id = v_tenant_id
        AND last_event_id = 'wiz-loc-' || p_idempotency_key;
    END IF;

    v_created_entities := v_created_entities || jsonb_build_object(
      'type', 'location',
      'id', v_location_id,
      'name', p_create_location ->> 'name'
    );
  END IF;

  -- 4. Create CATALOG ITEM
  SELECT ci.id, ci.sku
  INTO v_item_id, v_item_sku
  FROM inventory.rpc_create_catalog_item(
    p_name            := p_name,
    p_description     := p_description,
    p_category_id     := v_category_id,
    p_unit_of_measure := p_unit_of_measure,
    p_tracking_mode   := p_tracking_mode,
    p_reorder_point   := p_reorder_point,
    p_base_sku        := p_base_sku,
    p_sku             := p_sku,
    p_last_event_id   := p_idempotency_key
  ) ci;

  -- Set vendor + barcode + variant flags on the item
  UPDATE inventory.catalog_items
  SET preferred_vendor_id = CASE WHEN v_vendor_id IS NOT NULL THEN v_vendor_id ELSE preferred_vendor_id END,
      barcode = CASE WHEN p_barcode IS NOT NULL AND trim(p_barcode) <> '' THEN p_barcode ELSE barcode END,
      is_parent = COALESCE(p_has_variants, false),
      variant_dimensions = CASE WHEN p_has_variants THEN p_variant_dimensions ELSE NULL END,
      variant_options = CASE WHEN p_has_variants THEN p_variant_options ELSE NULL END
  WHERE id = v_item_id AND tenant_id = v_tenant_id;

  v_created_entities := v_created_entities || jsonb_build_object(
    'type', 'item',
    'id', v_item_id,
    'sku', v_item_sku,
    'name', p_name
  );

  -- 5. Create VENDOR-ITEM link
  IF v_vendor_id IS NOT NULL THEN
    INSERT INTO supply_chain.vendor_items (
      tenant_id, vendor_id, catalog_item_id, vendor_sku, unit_cost,
      is_preferred, last_event_id
    ) VALUES (
      v_tenant_id, v_vendor_id, v_item_id,
      COALESCE(p_vendor_sku, v_item_sku),
      p_vendor_unit_cost, true,
      'wiz-vi-' || p_idempotency_key
    )
    ON CONFLICT ON CONSTRAINT vendor_items_tenant_id_last_event_id_key
      DO NOTHING
    RETURNING id INTO v_vendor_item_id;

    IF v_vendor_item_id IS NOT NULL THEN
      v_created_entities := v_created_entities || jsonb_build_object(
        'type', 'vendor_item',
        'id', v_vendor_item_id
      );
    END IF;
  END IF;

  -- 6. Create INVENTORY LEVEL
  IF v_location_id IS NOT NULL AND p_reorder_point IS NOT NULL THEN
    INSERT INTO inventory.inventory_levels (
      tenant_id, catalog_item_id, location_id, current_stock, reorder_point
    ) VALUES (
      v_tenant_id, v_item_id, v_location_id, 0, p_reorder_point
    )
    ON CONFLICT (catalog_item_id, location_id) DO UPDATE
      SET reorder_point = EXCLUDED.reorder_point;
  END IF;

  -- 7. Create INITIAL STOCK
  IF v_location_id IS NOT NULL AND p_initial_qty IS NOT NULL AND p_initial_qty > 0 THEN
    v_event_id := 'wiz-stk-' || p_idempotency_key;

    INSERT INTO inventory.inventory_events (
      tenant_id, event_type, occurred_at, actor_user_id, last_event_id, payload
    ) VALUES (
      v_tenant_id, 'adjust', now(), v_user_id, v_event_id,
      jsonb_build_object(
        'catalog_item_id', v_item_id,
        'location_id', v_location_id,
        'reason', 'initial_stock',
        'old_qty', 0,
        'new_qty', p_initial_qty,
        'notes', 'Initial stock set during item wizard creation'
      )
    )
    ON CONFLICT ON CONSTRAINT inventory_events_tenant_id_last_event_id_key
      DO NOTHING;

    INSERT INTO inventory.stock_movements (
      tenant_id, catalog_item_id, location_id, quantity_delta, movement_type,
      unit_cost, reason, notes, occurred_at, created_by_user_id, last_event_id
    ) VALUES (
      v_tenant_id, v_item_id, v_location_id, p_initial_qty, 'adjusted',
      p_initial_cost, 'initial_stock',
      'Initial stock set during item wizard creation',
      now(), v_user_id, v_event_id
    )
    ON CONFLICT ON CONSTRAINT stock_movements_tenant_id_last_event_id_key
      DO NOTHING;

    v_created_entities := v_created_entities || jsonb_build_object(
      'type', 'initial_stock',
      'location_id', v_location_id,
      'quantity', p_initial_qty,
      'unit_cost', p_initial_cost
    );
  END IF;

  -- 8. Batch create ASSETS
  IF p_create_assets IS NOT NULL AND jsonb_array_length(p_create_assets) > 0 THEN
    FOR v_asset_row IN SELECT * FROM jsonb_array_elements(p_create_assets) LOOP
      INSERT INTO inventory.assets (
        tenant_id, catalog_item_id, asset_tag, serial_number, status,
        location_id, created_by, last_event_id
      ) VALUES (
        v_tenant_id, v_item_id,
        v_asset_row ->> 'asset_tag',
        v_asset_row ->> 'serial_number',
        'available', v_location_id, v_user_id,
        'wiz-asset-' || (v_asset_row ->> 'asset_tag') || '-' || p_idempotency_key
      )
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_asset_id;

      IF v_asset_id IS NOT NULL THEN
        v_asset_tags := v_asset_tags || to_jsonb(v_asset_row ->> 'asset_tag');
        v_created_entities := v_created_entities || jsonb_build_object(
          'type', 'asset',
          'id', v_asset_id,
          'name', v_asset_row ->> 'asset_tag'
        );
      END IF;
    END LOOP;
  END IF;

  -- 9. NEW: Auto-generate variant children if this is a parent with dimensions
  IF p_has_variants AND p_variant_dimensions IS NOT NULL AND p_variant_options IS NOT NULL THEN
    -- Build variant combos from dimensions × options using rpc_create_item_variants
    DECLARE
      v_combos      jsonb := '[]'::jsonb;
      v_dim_count   int;
      v_dims        text[];
      v_opt_arrays  jsonb[];
      v_combo       jsonb;
      v_idx_arr     int[];
      v_sizes       int[];
      v_total       int := 1;
      v_suffix      text;
      v_attrs       jsonb;
      v_i           int;
      v_d           int;
    BEGIN
      -- Extract dimension names
      SELECT array_agg(value::text ORDER BY ordinality)
      INTO v_dims
      FROM jsonb_array_elements_text(p_variant_dimensions) WITH ORDINALITY;

      v_dim_count := array_length(v_dims, 1);

      -- Extract option arrays for each dimension
      v_opt_arrays := ARRAY[]::jsonb[];
      v_sizes := ARRAY[]::int[];
      FOR v_d IN 1..v_dim_count LOOP
        v_opt_arrays := v_opt_arrays || (p_variant_options -> v_dims[v_d]);
        v_sizes := v_sizes || jsonb_array_length(p_variant_options -> v_dims[v_d]);
        v_total := v_total * jsonb_array_length(p_variant_options -> v_dims[v_d]);
      END LOOP;

      -- Generate all combinations via counter array
      v_idx_arr := ARRAY[]::int[];
      FOR v_d IN 1..v_dim_count LOOP
        v_idx_arr := v_idx_arr || 0;
      END LOOP;

      FOR v_i IN 1..v_total LOOP
        v_attrs := '{}'::jsonb;
        v_suffix := '';
        FOR v_d IN 1..v_dim_count LOOP
          v_attrs := v_attrs || jsonb_build_object(
            v_dims[v_d],
            v_opt_arrays[v_d] ->> v_idx_arr[v_d]
          );
          IF v_d > 1 THEN v_suffix := v_suffix || '-'; END IF;
          v_suffix := v_suffix || upper(v_opt_arrays[v_d] ->> v_idx_arr[v_d]);
        END LOOP;

        v_combos := v_combos || jsonb_build_object(
          'attributes', v_attrs,
          'sku_suffix', v_suffix
        );

        -- Increment counter (rightmost first)
        FOR v_d IN REVERSE v_dim_count..1 LOOP
          v_idx_arr[v_d] := v_idx_arr[v_d] + 1;
          IF v_idx_arr[v_d] < v_sizes[v_d] THEN
            EXIT;
          ELSE
            v_idx_arr[v_d] := 0;
          END IF;
        END LOOP;
      END LOOP;

      IF jsonb_array_length(v_combos) > 0 THEN
        v_variant_result := inventory.rpc_create_item_variants(
          p_parent_item_id  := v_item_id,
          p_variants        := v_combos,
          p_idempotency_key := 'wiz-vars-' || p_idempotency_key
        );

        v_created_entities := v_created_entities || jsonb_build_object(
          'type', 'variants',
          'count', v_variant_result -> 'count',
          'variant_ids', v_variant_result -> 'variant_ids'
        );
      END IF;
    END;
  END IF;

  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'idempotent_hit', false,
    'item_id', v_item_id,
    'item_sku', v_item_sku,
    'item_barcode', COALESCE(p_barcode, ''),
    'category_id', v_category_id,
    'vendor_id', v_vendor_id,
    'location_id', v_location_id,
    'created_asset_tags', v_asset_tags,
    'created_entities', v_created_entities
  );

  RETURN v_result;
END;
$$;

ALTER FUNCTION inventory.rpc_wizard_create_item OWNER TO postgres;

COMMENT ON FUNCTION inventory.rpc_wizard_create_item IS
'Atomic "Add Item Wizard" - creates item + optional category/vendor/location/initial stock/barcode/assets/variants in one transaction.
Idempotent via p_idempotency_key. Events emitted automatically by row-level triggers on each table.';

GRANT EXECUTE ON FUNCTION inventory.rpc_wizard_create_item TO authenticated;
GRANT EXECUTE ON FUNCTION inventory.rpc_wizard_create_item TO service_role;
