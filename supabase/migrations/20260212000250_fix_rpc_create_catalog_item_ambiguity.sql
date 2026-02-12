-- Fix ambiguous column references in rpc_create_catalog_item

BEGIN;

CREATE OR REPLACE FUNCTION inventory.rpc_create_catalog_item(
  p_name text,
  p_description text,
  p_category_id uuid,
  p_unit_of_measure text,
  p_tracking_mode text,
  p_reorder_point numeric,
  p_base_sku text,
  p_sku text,
  p_last_event_id text DEFAULT NULL
) RETURNS TABLE(
  id uuid,
  sku text,
  base_sku text,
  last_event_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO inventory, public
AS $$
DECLARE
  v_tenant_id uuid;
  v_category record;
  v_separator text;
  v_next_sequence integer;
  v_base_sku text;
  v_sku text;
  v_prefix text;
  v_parent_prefix text;
  v_prefix_escaped text;
  v_sep_escaped text;
  v_max_base integer;
  v_max_sku integer;
  v_max_existing integer;
  v_seq integer;
  v_out_id uuid;
  v_out_sku text;
  v_out_base_sku text;
  v_out_last_event_id text;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Name is required';
  END IF;

  IF p_last_event_id IS NULL OR trim(p_last_event_id) = '' THEN
    p_last_event_id := gen_random_uuid()::text;
  END IF;

  IF p_category_id IS NULL THEN
    IF p_sku IS NULL OR trim(p_sku) = '' THEN
      RAISE EXCEPTION 'SKU is required when no category is selected';
    END IF;

    INSERT INTO inventory.catalog_items (
      tenant_id,
      name,
      sku,
      description,
      category_id,
      unit_of_measure,
      tracking_mode,
      reorder_point,
      base_sku,
      last_event_id
    ) VALUES (
      v_tenant_id,
      p_name,
      p_sku,
      p_description,
      p_category_id,
      p_unit_of_measure,
      p_tracking_mode,
      p_reorder_point,
      p_base_sku,
      p_last_event_id
    ) RETURNING inventory.catalog_items.id,
              inventory.catalog_items.sku,
              inventory.catalog_items.base_sku,
              inventory.catalog_items.last_event_id
      INTO v_out_id, v_out_sku, v_out_base_sku, v_out_last_event_id;

    RETURN QUERY SELECT v_out_id, v_out_sku, v_out_base_sku, v_out_last_event_id;
  END IF;

  SELECT c.id, c.sku_mode, c.sku_prefix, c.parent_category_id
  INTO v_category
  FROM inventory.item_categories c
  WHERE c.id = p_category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found';
  END IF;

  SELECT s.separator, s.next_sequence
  INTO v_separator, v_next_sequence
  FROM inventory.sku_settings s
  WHERE s.category_id = p_category_id
    AND s.tenant_id = v_tenant_id
  FOR UPDATE;

  IF v_separator IS NULL THEN
    INSERT INTO inventory.sku_settings (tenant_id, category_id, separator, next_sequence)
    VALUES (v_tenant_id, p_category_id, '-', 1)
    ON CONFLICT (category_id) DO NOTHING;

    SELECT s.separator, s.next_sequence
    INTO v_separator, v_next_sequence
    FROM inventory.sku_settings s
    WHERE s.category_id = p_category_id
      AND s.tenant_id = v_tenant_id
    FOR UPDATE;
  END IF;

  v_separator := COALESCE(v_separator, '-');
  v_prefix := COALESCE(v_category.sku_prefix, '');

  SELECT c.sku_prefix
  INTO v_parent_prefix
  FROM inventory.item_categories c
  WHERE c.id = v_category.parent_category_id;

  v_parent_prefix := COALESCE(v_parent_prefix, '');
  v_prefix_escaped := regexp_replace(upper(v_prefix), '([\\.^$|?*+()\[\]{}-])', '\\\\1', 'g');
  v_sep_escaped := regexp_replace(v_separator, '([\\.^$|?*+()\[\]{}-])', '\\\\1', 'g');

  IF v_category.sku_mode = 'manual' THEN
    IF p_sku IS NULL OR trim(p_sku) = '' THEN
      RAISE EXCEPTION 'SKU is required for manual categories';
    END IF;
    v_sku := p_sku;
    v_base_sku := p_base_sku;
  ELSE
    SELECT COALESCE(MAX(base_sku::int), 0)
    INTO v_max_base
    FROM inventory.catalog_items ci
    WHERE ci.tenant_id = v_tenant_id
      AND ci.base_sku ~ '^[0-9]+$';

    IF v_prefix <> '' THEN
      SELECT COALESCE(MAX((regexp_match(upper(ci.sku), '^' || v_prefix_escaped || v_sep_escaped || '([0-9]+)$'))[1]::int), 0)
      INTO v_max_sku
      FROM inventory.catalog_items ci
      WHERE ci.tenant_id = v_tenant_id
        AND upper(ci.sku) ~ ('^' || v_prefix_escaped || v_sep_escaped || '[0-9]+$');
    ELSE
      SELECT COALESCE(MAX((regexp_match(ci.sku, '([0-9]+)$'))[1]::int), 0)
      INTO v_max_sku
      FROM inventory.catalog_items ci
      WHERE ci.tenant_id = v_tenant_id
        AND ci.sku ~ '^[0-9]+$';
    END IF;

    v_max_existing := GREATEST(v_max_base, v_max_sku);
    v_seq := GREATEST(COALESCE(v_next_sequence, 1), v_max_existing + 1);

    IF v_category.sku_mode = 'attribute_based' AND p_base_sku IS NOT NULL AND trim(p_base_sku) <> '' THEN
      v_base_sku := upper(p_base_sku);
    ELSE
      v_base_sku := lpad(v_seq::text, 3, '0');
    END IF;

    IF v_category.sku_mode = 'attribute_based' THEN
      v_sku := concat_ws(v_separator, nullif(upper(v_parent_prefix), ''), nullif(upper(v_prefix), ''), v_base_sku);
    ELSE
      v_sku := CASE
        WHEN v_prefix = '' THEN v_base_sku
        ELSE upper(v_prefix) || v_separator || v_base_sku
      END;
    END IF;

    UPDATE inventory.sku_settings
    SET next_sequence = v_seq + 1,
        updated_at = now()
    WHERE category_id = p_category_id
      AND tenant_id = v_tenant_id;
  END IF;

  INSERT INTO inventory.catalog_items (
    tenant_id,
    name,
    sku,
    description,
    category_id,
    unit_of_measure,
    tracking_mode,
    reorder_point,
    base_sku,
    last_event_id
  ) VALUES (
    v_tenant_id,
    p_name,
    v_sku,
    p_description,
    p_category_id,
    p_unit_of_measure,
    p_tracking_mode,
    p_reorder_point,
    v_base_sku,
    p_last_event_id
  ) RETURNING inventory.catalog_items.id,
            inventory.catalog_items.sku,
            inventory.catalog_items.base_sku,
            inventory.catalog_items.last_event_id
    INTO v_out_id, v_out_sku, v_out_base_sku, v_out_last_event_id;

  RETURN QUERY SELECT v_out_id, v_out_sku, v_out_base_sku, v_out_last_event_id;
END;
$$;

COMMIT;
