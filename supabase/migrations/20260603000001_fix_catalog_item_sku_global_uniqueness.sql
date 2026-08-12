-- Sequential SKU generation scoped the next-number search to the category, but
-- catalog_items_tenant_sku_unique is per-TENANT. Categories sharing a prefix (or
-- both empty) collided. Walk up from next_sequence to the first SKU that's free
-- tenant-wide. (Also removes the brittle regex-based max parsing.)
CREATE OR REPLACE FUNCTION inventory.rpc_create_catalog_item(
  p_name text, p_description text, p_category_id uuid, p_tracking_mode text,
  p_reorder_point numeric, p_base_sku text, p_sku text,
  p_last_event_id text DEFAULT NULL::text, p_uom_term_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(id uuid, sku text, base_sku text, last_event_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'public'
AS $function$
DECLARE
  v_tenant_id uuid; v_category record; v_separator text; v_next_sequence integer;
  v_base_sku text; v_sku text; v_prefix text; v_parent_prefix text; v_seq integer;
  v_out_id uuid; v_out_sku text; v_out_base_sku text; v_out_last_event_id text;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN RAISE EXCEPTION 'Name is required'; END IF;
  IF p_last_event_id IS NULL OR trim(p_last_event_id) = '' THEN p_last_event_id := gen_random_uuid()::text; END IF;

  -- No category → caller-supplied SKU.
  IF p_category_id IS NULL THEN
    IF p_sku IS NULL OR trim(p_sku) = '' THEN RAISE EXCEPTION 'SKU is required when no category is selected'; END IF;
    INSERT INTO inventory.catalog_items (tenant_id, name, sku, description, category_id, uom_term_id, tracking_mode, reorder_point, base_sku, last_event_id)
    VALUES (v_tenant_id, p_name, p_sku, p_description, NULL, p_uom_term_id, p_tracking_mode, p_reorder_point, p_sku, p_last_event_id)
    RETURNING catalog_items.id, catalog_items.sku, catalog_items.base_sku, catalog_items.last_event_id
      INTO v_out_id, v_out_sku, v_out_base_sku, v_out_last_event_id;
    RETURN QUERY SELECT v_out_id, v_out_sku, v_out_base_sku, v_out_last_event_id; RETURN;
  END IF;

  SELECT ic.id, ic.sku_prefix, ic.sku_mode, ic.parent_category_id INTO v_category
    FROM inventory.item_categories ic WHERE ic.id = p_category_id AND ic.tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Category not found'; END IF;

  SELECT ss.separator, ss.next_sequence INTO v_separator, v_next_sequence
    FROM inventory.sku_settings ss WHERE ss.category_id = p_category_id AND ss.tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    v_separator := '-'; v_next_sequence := 1;
    INSERT INTO inventory.sku_settings (tenant_id, category_id, separator, next_sequence)
    VALUES (v_tenant_id, p_category_id, v_separator, v_next_sequence) ON CONFLICT (category_id) DO NOTHING;
  END IF;

  v_prefix := COALESCE(v_category.sku_prefix, ''); v_parent_prefix := '';
  IF v_category.parent_category_id IS NOT NULL THEN
    SELECT COALESCE(ic2.sku_prefix, '') INTO v_parent_prefix FROM inventory.item_categories ic2
      WHERE ic2.id = v_category.parent_category_id AND ic2.tenant_id = v_tenant_id;
  END IF;

  IF v_category.sku_mode = 'manual' THEN
    IF p_sku IS NULL OR trim(p_sku) = '' THEN RAISE EXCEPTION 'SKU is required for manual SKU mode'; END IF;
    v_sku := p_sku; v_base_sku := p_sku;
  ELSIF v_category.sku_mode = 'attribute_based' THEN
    IF p_base_sku IS NULL OR trim(p_base_sku) = '' THEN RAISE EXCEPTION 'Base SKU is required for attribute-based SKU mode'; END IF;
    v_base_sku := upper(trim(p_base_sku));
    v_sku := concat_ws(v_separator, nullif(upper(v_parent_prefix), ''), nullif(upper(v_prefix), ''), v_base_sku);
  ELSE
    -- Sequential: first free number for this prefix, tenant-wide.
    v_seq := GREATEST(COALESCE(v_next_sequence, 1), 1);
    LOOP
      v_base_sku := lpad(v_seq::text, 3, '0');
      v_sku := CASE WHEN v_prefix = '' THEN v_base_sku ELSE upper(v_prefix) || v_separator || v_base_sku END;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM inventory.catalog_items ci WHERE ci.tenant_id = v_tenant_id AND ci.sku = v_sku
      );
      v_seq := v_seq + 1;
    END LOOP;
    UPDATE inventory.sku_settings SET next_sequence = v_seq + 1, updated_at = now()
      WHERE category_id = p_category_id AND tenant_id = v_tenant_id;
  END IF;

  INSERT INTO inventory.catalog_items (tenant_id, name, sku, description, category_id, uom_term_id, tracking_mode, reorder_point, base_sku, last_event_id)
  VALUES (v_tenant_id, p_name, v_sku, p_description, p_category_id, p_uom_term_id, p_tracking_mode, p_reorder_point, v_base_sku, p_last_event_id)
  RETURNING catalog_items.id, catalog_items.sku, catalog_items.base_sku, catalog_items.last_event_id
    INTO v_out_id, v_out_sku, v_out_base_sku, v_out_last_event_id;
  RETURN QUERY SELECT v_out_id, v_out_sku, v_out_base_sku, v_out_last_event_id;
END;
$function$;
