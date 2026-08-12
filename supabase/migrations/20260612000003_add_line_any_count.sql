-- Allow adding discovered items to ANY in-progress cycle count, not just
-- initial counts. Finding stock the system didn't expect at a location is the
-- whole point of cycle counting: the new line's qty_expected comes from the
-- current stock balance at the count's location (usually 0 for a discovery),
-- so the counted quantity surfaces as a normal variance for review.
CREATE OR REPLACE FUNCTION inventory.rpc_inv_cycle_count_add_line(
  p_cycle_count_id uuid,
  p_catalog_item_id uuid,
  p_tenant_id uuid,
  p_last_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_count RECORD; v_expected NUMERIC := 0; v_line_id UUID;
  v_catalog_item RECORD; v_existing_line RECORD; v_next_line INT;
BEGIN
  SELECT * INTO v_count FROM inventory.cycle_counts WHERE id = p_cycle_count_id AND tenant_id = p_tenant_id;
  IF v_count IS NULL THEN RAISE EXCEPTION 'Cycle count not found'; END IF;
  IF v_count.status != 'in_progress' THEN RAISE EXCEPTION 'Cycle count is not in progress'; END IF;

  SELECT id, name, sku, barcode, tracking_mode, uom_term_id INTO v_catalog_item
  FROM inventory.catalog_items WHERE id = p_catalog_item_id AND tenant_id = p_tenant_id;
  IF v_catalog_item IS NULL THEN RAISE EXCEPTION 'Catalog item not found'; END IF;

  SELECT id, qty_expected INTO v_existing_line
  FROM inventory.cycle_count_lines
  WHERE cycle_count_id = p_cycle_count_id AND catalog_item_id = p_catalog_item_id AND tenant_id = p_tenant_id;

  IF v_existing_line IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', v_existing_line.id, 'catalog_item_id', p_catalog_item_id,
      'qty_expected', v_existing_line.qty_expected,
      'catalog_item', jsonb_build_object(
        'name', v_catalog_item.name, 'sku', v_catalog_item.sku,
        'barcode', v_catalog_item.barcode, 'tracking_mode', v_catalog_item.tracking_mode,
        'uom_term_id', v_catalog_item.uom_term_id
      )
    );
  END IF;

  SELECT COALESCE(sb.qty_on_hand, 0) INTO v_expected
  FROM inventory.stock_balances sb
  WHERE sb.catalog_item_id = p_catalog_item_id AND sb.location_id = v_count.location_id AND sb.tenant_id = p_tenant_id;
  IF v_expected IS NULL THEN v_expected := 0; END IF;

  SELECT COALESCE(MAX(line_number), 0) + 1 INTO v_next_line
  FROM inventory.cycle_count_lines
  WHERE cycle_count_id = p_cycle_count_id AND tenant_id = p_tenant_id;

  INSERT INTO inventory.cycle_count_lines (
    tenant_id, cycle_count_id, location_id, catalog_item_id, qty_expected, line_number, last_event_id
  ) VALUES (
    p_tenant_id, p_cycle_count_id, v_count.location_id, p_catalog_item_id, v_expected, v_next_line, p_last_event_id::TEXT
  ) ON CONFLICT (tenant_id, last_event_id) DO NOTHING RETURNING id INTO v_line_id;

  IF v_line_id IS NULL THEN
    SELECT id INTO v_line_id FROM inventory.cycle_count_lines
    WHERE tenant_id = p_tenant_id AND last_event_id = p_last_event_id::TEXT;
  END IF;

  RETURN jsonb_build_object(
    'id', v_line_id, 'catalog_item_id', p_catalog_item_id, 'qty_expected', v_expected,
    'catalog_item', jsonb_build_object(
      'name', v_catalog_item.name, 'sku', v_catalog_item.sku,
      'barcode', v_catalog_item.barcode, 'tracking_mode', v_catalog_item.tracking_mode,
      'uom_term_id', v_catalog_item.uom_term_id
    )
  );
END;
$function$;
