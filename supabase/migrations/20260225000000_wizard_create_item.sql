-- Migration: Add Item Wizard atomic RPC function
-- Purpose: Creates an item + optional dependencies (category, vendor, location)
--          + optional initial stock in one transaction.
-- Triggers on each table handle event emission automatically.

-- =============================================================================
-- rpc_wizard_create_item
-- =============================================================================
-- Atomic "Add Item Wizard" that creates:
--   1. Category (if create_category is provided and category_id is NULL)
--   2. Vendor (if create_vendor is provided and vendor_id is NULL)
--   3. Location (if create_location is provided and location_id is NULL)
--   4. Catalog item (always)
--   5. Vendor-item link (if vendor resolved)
--   6. Inventory levels (reorder/target per location)
--   7. Initial stock movement + balance (if initial_stock provided)
--
-- Idempotency: p_idempotency_key prevents duplicate wizard runs.
-- Tenant isolation: current_tenant_id() from JWT.
-- Events: Each INSERT fires existing row-level triggers.

CREATE OR REPLACE FUNCTION inventory.rpc_wizard_create_item(
  -- Item fields
  p_name             text,
  p_description      text     DEFAULT NULL,
  p_unit_of_measure  text     DEFAULT 'EA',
  p_tracking_mode    text     DEFAULT 'stock',
  p_reorder_point    numeric  DEFAULT NULL,
  p_base_sku         text     DEFAULT NULL,
  p_sku              text     DEFAULT NULL,

  -- Category: pass existing id OR create payload
  p_category_id      uuid     DEFAULT NULL,
  p_create_category  jsonb    DEFAULT NULL,
  -- Expected shape: {"name": "...", "sku_prefix": "...", "sku_mode": "sequential|attribute_based|manual", "parent_category_id": null}

  -- Vendor: pass existing id OR create payload
  p_vendor_id        uuid     DEFAULT NULL,
  p_create_vendor    jsonb    DEFAULT NULL,
  -- Expected shape: {"name": "...", "code": null, "contact_name": null, "contact_email": null, "contact_phone": null, "payment_terms": "NET30", "lead_time_days": null}
  p_vendor_sku       text     DEFAULT NULL,
  p_vendor_unit_cost numeric  DEFAULT NULL,

  -- Location: pass existing id OR create payload
  p_location_id      uuid     DEFAULT NULL,
  p_create_location  jsonb    DEFAULT NULL,
  -- Expected shape: {"name": "...", "location_type_id": "uuid", "address": null}

  -- Initial stock
  p_initial_qty      numeric  DEFAULT NULL,
  p_initial_cost     numeric  DEFAULT NULL,

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
  v_item_result      record;
  v_item_id          uuid;
  v_item_sku         text;
  v_event_id         text;
  v_result           jsonb;
  v_created_entities jsonb := '[]'::jsonb;
  v_vendor_item_id   uuid;
BEGIN
  -- ── Auth ──────────────────────────────────────────────────────────────
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_user_id := (auth.jwt() ->> 'user_id')::uuid;
  IF v_user_id IS NULL THEN
    v_user_id := auth.uid();
  END IF;

  -- ── Idempotency check ────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    -- Check if an item was already created with this idempotency key
    SELECT ci.id, ci.sku, ci.last_event_id
    INTO v_item_result
    FROM inventory.catalog_items ci
    WHERE ci.tenant_id = v_tenant_id
      AND ci.last_event_id = p_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent_hit', true,
        'item_id', v_item_result.id,
        'item_sku', v_item_result.sku,
        'created_entities', '[]'::jsonb
      );
    END IF;
  ELSE
    p_idempotency_key := gen_random_uuid()::text;
  END IF;

  -- ── Validate required fields ─────────────────────────────────────────
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Item name is required';
  END IF;

  -- ── 1. Resolve or create CATEGORY ────────────────────────────────────
  v_category_id := p_category_id;

  IF v_category_id IS NULL AND p_create_category IS NOT NULL THEN
    INSERT INTO inventory.item_categories (
      tenant_id,
      name,
      sku_prefix,
      sku_mode,
      parent_category_id,
      last_event_id
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

    -- If ON CONFLICT hit, fetch the existing
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

    -- Also create sku_settings for new category
    IF v_category_id IS NOT NULL THEN
      INSERT INTO inventory.sku_settings (
        tenant_id,
        category_id,
        separator,
        next_sequence
      ) VALUES (
        v_tenant_id,
        v_category_id,
        '-',
        1
      ) ON CONFLICT (category_id) DO NOTHING;
    END IF;
  END IF;

  -- ── 2. Resolve or create VENDOR (supply_chain schema) ────────────────
  v_vendor_id := p_vendor_id;

  IF v_vendor_id IS NULL AND p_create_vendor IS NOT NULL THEN
    INSERT INTO supply_chain.vendors (
      tenant_id,
      name,
      code,
      contact_name,
      contact_email,
      contact_phone,
      payment_terms,
      lead_time_days,
      last_event_id
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

  -- ── 3. Resolve or create LOCATION ────────────────────────────────────
  v_location_id := p_location_id;

  IF v_location_id IS NULL AND p_create_location IS NOT NULL THEN
    INSERT INTO inventory.locations (
      tenant_id,
      name,
      location_type_id,
      address,
      last_event_id
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

  -- ── 4. Create CATALOG ITEM (delegates SKU gen to existing RPC) ───────
  SELECT * INTO v_item_result
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
  );

  v_item_id  := v_item_result.id;
  v_item_sku := v_item_result.sku;

  -- Set preferred_vendor_id on the item if vendor resolved
  IF v_vendor_id IS NOT NULL THEN
    UPDATE inventory.catalog_items
    SET preferred_vendor_id = v_vendor_id
    WHERE id = v_item_id AND tenant_id = v_tenant_id;
  END IF;

  v_created_entities := v_created_entities || jsonb_build_object(
    'type', 'item',
    'id', v_item_id,
    'sku', v_item_sku,
    'name', p_name
  );

  -- ── 5. Create VENDOR-ITEM link if vendor resolved ────────────────────
  IF v_vendor_id IS NOT NULL THEN
    INSERT INTO supply_chain.vendor_items (
      tenant_id,
      vendor_id,
      catalog_item_id,
      vendor_sku,
      unit_cost,
      is_preferred,
      last_event_id
    ) VALUES (
      v_tenant_id,
      v_vendor_id,
      v_item_id,
      COALESCE(p_vendor_sku, v_item_sku),
      p_vendor_unit_cost,
      true,
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

  -- ── 6. Create INVENTORY LEVEL (reorder config) if location provided ──
  IF v_location_id IS NOT NULL AND p_reorder_point IS NOT NULL THEN
    INSERT INTO inventory.inventory_levels (
      tenant_id,
      catalog_item_id,
      location_id,
      current_stock,
      reorder_point
    ) VALUES (
      v_tenant_id,
      v_item_id,
      v_location_id,
      0,
      p_reorder_point
    )
    ON CONFLICT (catalog_item_id, location_id) DO UPDATE
      SET reorder_point = EXCLUDED.reorder_point;
  END IF;

  -- ── 7. Create INITIAL STOCK via stock_movements ledger ───────────────
  IF v_location_id IS NOT NULL AND p_initial_qty IS NOT NULL AND p_initial_qty > 0 THEN
    v_event_id := 'wiz-stk-' || p_idempotency_key;

    -- Insert inventory event
    INSERT INTO inventory.inventory_events (
      tenant_id,
      event_type,
      occurred_at,
      actor_user_id,
      last_event_id,
      payload
    ) VALUES (
      v_tenant_id,
      'adjust',
      now(),
      v_user_id,
      v_event_id,
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

    -- Insert stock movement (triggers maintain_stock_balances + emit_stock_movement_event)
    INSERT INTO inventory.stock_movements (
      tenant_id,
      catalog_item_id,
      location_id,
      quantity_delta,
      movement_type,
      unit_cost,
      reason,
      notes,
      occurred_at,
      created_by_user_id,
      last_event_id
    ) VALUES (
      v_tenant_id,
      v_item_id,
      v_location_id,
      p_initial_qty,
      'adjusted',
      p_initial_cost,
      'initial_stock',
      'Initial stock set during item wizard creation',
      now(),
      v_user_id,
      v_event_id
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

  -- ── Build result ─────────────────────────────────────────────────────
  v_result := jsonb_build_object(
    'success', true,
    'idempotent_hit', false,
    'item_id', v_item_id,
    'item_sku', v_item_sku,
    'category_id', v_category_id,
    'vendor_id', v_vendor_id,
    'location_id', v_location_id,
    'created_entities', v_created_entities
  );

  RETURN v_result;
END;
$$;

ALTER FUNCTION inventory.rpc_wizard_create_item OWNER TO postgres;

COMMENT ON FUNCTION inventory.rpc_wizard_create_item IS
'Atomic "Add Item Wizard" - creates item + optional category/vendor/location/initial stock in one transaction.
Idempotent via p_idempotency_key. Events emitted automatically by row-level triggers on each table.';

-- Grant access to authenticated users and service role
GRANT EXECUTE ON FUNCTION inventory.rpc_wizard_create_item TO authenticated;
GRANT EXECUTE ON FUNCTION inventory.rpc_wizard_create_item TO service_role;

-- =============================================================================
-- Ensure unique constraints exist for idempotency ON CONFLICT clauses
-- These may already exist; using IF NOT EXISTS pattern via DO block.
-- =============================================================================

DO $$
BEGIN
  -- item_categories: (tenant_id, last_event_id) unique
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'item_categories_tenant_id_last_event_id_key'
  ) THEN
    ALTER TABLE inventory.item_categories
      ADD CONSTRAINT item_categories_tenant_id_last_event_id_key
      UNIQUE (tenant_id, last_event_id);
  END IF;

  -- locations: (tenant_id, last_event_id) unique
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'locations_tenant_id_last_event_id_key'
  ) THEN
    ALTER TABLE inventory.locations
      ADD CONSTRAINT locations_tenant_id_last_event_id_key
      UNIQUE (tenant_id, last_event_id);
  END IF;

  -- vendors: (tenant_id, last_event_id) unique
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vendors_tenant_id_last_event_id_key'
  ) THEN
    ALTER TABLE supply_chain.vendors
      ADD CONSTRAINT vendors_tenant_id_last_event_id_key
      UNIQUE (tenant_id, last_event_id);
  END IF;

  -- vendor_items: (tenant_id, last_event_id) unique
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vendor_items_tenant_id_last_event_id_key'
  ) THEN
    ALTER TABLE supply_chain.vendor_items
      ADD CONSTRAINT vendor_items_tenant_id_last_event_id_key
      UNIQUE (tenant_id, last_event_id);
  END IF;

  -- stock_movements: (tenant_id, last_event_id) unique
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stock_movements_tenant_id_last_event_id_key'
  ) THEN
    ALTER TABLE inventory.stock_movements
      ADD CONSTRAINT stock_movements_tenant_id_last_event_id_key
      UNIQUE (tenant_id, last_event_id);
  END IF;

  -- inventory_events: (tenant_id, last_event_id) unique
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_events_tenant_id_last_event_id_key'
  ) THEN
    ALTER TABLE inventory.inventory_events
      ADD CONSTRAINT inventory_events_tenant_id_last_event_id_key
      UNIQUE (tenant_id, last_event_id);
  END IF;
END $$;

-- =============================================================================
-- Register wizard event in event_catalog (for documentation)
-- =============================================================================
INSERT INTO public.event_catalog (event_key, display_name, description, owner_module, aggregate_type, event_version)
VALUES (
  'inventory.item.wizard_created',
  'Item Wizard Created',
  'Composite event: item created via wizard flow with optional inline category/vendor/location/initial stock creation. Individual entity events are emitted by row triggers.',
  'inventory',
  'catalog_item',
  1
)
ON CONFLICT (event_key) DO NOTHING;
