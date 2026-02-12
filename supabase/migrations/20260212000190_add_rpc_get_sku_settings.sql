-- Return SKU settings with next_sequence computed from existing items

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

  v_next_sequence := GREATEST(COALESCE(v_next_sequence, 1), v_max_base + 1);
  v_separator := COALESCE(v_separator, '-');

  RETURN QUERY SELECT v_separator, v_next_sequence;
END;
$$;

GRANT EXECUTE ON FUNCTION inventory.rpc_get_sku_settings(uuid) TO authenticated;

COMMIT;
