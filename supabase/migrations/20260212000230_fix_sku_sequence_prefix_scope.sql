-- Compute next_sequence from prefix-matched SKUs across tenant

BEGIN;

CREATE OR REPLACE FUNCTION inventory.rpc_get_sku_settings(
  p_category_id uuid
) RETURNS TABLE(
  separator text,
  next_sequence integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO inventory, public
AS $$
DECLARE
  v_tenant_id uuid;
  v_separator text;
  v_next_sequence integer;
  v_max_base integer;
  v_max_sku integer;
  v_max_existing integer;
  v_prefix text;
  v_prefix_escaped text;
  v_sep_escaped text;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT s.separator, s.next_sequence
  INTO v_separator, v_next_sequence
  FROM inventory.sku_settings s
  WHERE s.category_id = p_category_id
    AND s.tenant_id = v_tenant_id;

  SELECT c.sku_prefix
  INTO v_prefix
  FROM inventory.item_categories c
  WHERE c.id = p_category_id;

  v_separator := COALESCE(v_separator, '-');
  v_prefix := COALESCE(v_prefix, '');
  v_prefix_escaped := regexp_replace(upper(v_prefix), '([\\.^$|?*+()\[\]{}-])', '\\\\1', 'g');
  v_sep_escaped := regexp_replace(v_separator, '([\\.^$|?*+()\[\]{}-])', '\\\\1', 'g');

  SELECT COALESCE(MAX(base_sku::int), 0)
  INTO v_max_base
  FROM inventory.catalog_items ci
  WHERE ci.tenant_id = v_tenant_id
    AND ci.category_id = p_category_id
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
  v_next_sequence := GREATEST(COALESCE(v_next_sequence, 1), v_max_existing + 1);

  RETURN QUERY SELECT v_separator, v_next_sequence;
END;
$$;

COMMIT;
