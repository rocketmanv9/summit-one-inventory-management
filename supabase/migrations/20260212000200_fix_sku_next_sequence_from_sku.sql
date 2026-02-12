-- Compute next_sequence from existing sku/base_sku values

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

  SELECT COALESCE(MAX(base_sku::int), 0)
  INTO v_max_base
  FROM inventory.catalog_items ci
  WHERE ci.tenant_id = v_tenant_id
    AND ci.category_id = p_category_id
    AND ci.base_sku ~ '^[0-9]+$';

  SELECT COALESCE(MAX((regexp_match(ci.sku, '(\\d+)$'))[1]::int), 0)
  INTO v_max_sku
  FROM inventory.catalog_items ci
  WHERE ci.tenant_id = v_tenant_id
    AND ci.category_id = p_category_id
    AND ci.sku ~ '\\d+$';

  v_max_existing := GREATEST(v_max_base, v_max_sku);
  v_next_sequence := GREATEST(COALESCE(v_next_sequence, 1), v_max_existing + 1);
  v_separator := COALESCE(v_separator, '-');

  RETURN QUERY SELECT v_separator, v_next_sequence;
END;
$$;

COMMIT;
