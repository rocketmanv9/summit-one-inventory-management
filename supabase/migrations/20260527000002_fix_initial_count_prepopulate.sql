-- Fix broken RPCs: wrong column name (expected_qty → qty_expected),
-- missing location_id and line_number in INSERTs, and make initial counts
-- pre-populate from stock_balances like full counts do.

-- 1. Fix newer start RPC overload (used by desktop)
CREATE OR REPLACE FUNCTION inventory.rpc_inv_cycle_count_start(
  p_tenant_id UUID, p_location_id UUID, p_count_type TEXT,
  p_catalog_item_ids UUID[] DEFAULT NULL, p_item_category_id UUID DEFAULT NULL,
  p_counted_by_user_id UUID DEFAULT NULL, p_last_event_id TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_count_id UUID; v_event_id TEXT; v_count_number TEXT; v_next_seq INT;
BEGIN
    IF p_last_event_id IS NULL THEN RAISE EXCEPTION 'p_last_event_id is required'; END IF;
    v_event_id := p_last_event_id;

    IF p_count_type NOT IN ('full', 'partial', 'spot_check', 'initial') THEN
        RAISE EXCEPTION 'Invalid count_type';
    END IF;

    SELECT COALESCE(MAX(NULLIF(regexp_replace(count_number, '[^0-9]', '', 'g'), '')::INT), 0) + 1
    INTO v_next_seq FROM inventory.cycle_counts WHERE tenant_id = p_tenant_id;
    v_count_number := 'CC-' || LPAD(v_next_seq::TEXT, 4, '0');

    INSERT INTO inventory.cycle_counts (
        tenant_id, count_number, location_id, count_type, status, scheduled_for, counted_by_user_id, last_event_id
    ) VALUES (
        p_tenant_id, v_count_number, p_location_id, p_count_type, 'in_progress', CURRENT_DATE, p_counted_by_user_id, v_event_id
    ) ON CONFLICT (tenant_id, last_event_id) DO NOTHING RETURNING id INTO v_count_id;

    IF v_count_id IS NULL THEN
        SELECT id INTO v_count_id FROM inventory.cycle_counts WHERE tenant_id = p_tenant_id AND last_event_id = v_event_id;
        RETURN v_count_id;
    END IF;

    IF p_count_type IN ('full', 'initial') THEN
        INSERT INTO inventory.cycle_count_lines (
            tenant_id, cycle_count_id, location_id, catalog_item_id, qty_expected, line_number, last_event_id
        )
        SELECT sb.tenant_id, v_count_id, p_location_id, sb.catalog_item_id, sb.qty_on_hand,
               ROW_NUMBER() OVER (ORDER BY sb.catalog_item_id),
               v_event_id || '_line_' || sb.catalog_item_id::TEXT
        FROM inventory.stock_balances sb
        WHERE sb.tenant_id = p_tenant_id AND sb.location_id = p_location_id AND sb.qty_on_hand > 0
        ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
    ELSIF p_count_type = 'partial' THEN
        IF p_catalog_item_ids IS NOT NULL THEN
            INSERT INTO inventory.cycle_count_lines (
                tenant_id, cycle_count_id, location_id, catalog_item_id, qty_expected, line_number, last_event_id
            )
            SELECT sb.tenant_id, v_count_id, p_location_id, sb.catalog_item_id, sb.qty_on_hand,
                   ROW_NUMBER() OVER (ORDER BY sb.catalog_item_id),
                   v_event_id || '_line_' || sb.catalog_item_id::TEXT
            FROM inventory.stock_balances sb
            WHERE sb.tenant_id = p_tenant_id AND sb.location_id = p_location_id
              AND sb.catalog_item_id = ANY(p_catalog_item_ids)
            ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
        ELSIF p_item_category_id IS NOT NULL THEN
            INSERT INTO inventory.cycle_count_lines (
                tenant_id, cycle_count_id, location_id, catalog_item_id, qty_expected, line_number, last_event_id
            )
            SELECT sb.tenant_id, v_count_id, p_location_id, sb.catalog_item_id, sb.qty_on_hand,
                   ROW_NUMBER() OVER (ORDER BY sb.catalog_item_id),
                   v_event_id || '_line_' || sb.catalog_item_id::TEXT
            FROM inventory.stock_balances sb
            JOIN inventory.catalog_items ci ON ci.id = sb.catalog_item_id
            WHERE sb.tenant_id = p_tenant_id AND sb.location_id = p_location_id
              AND ci.item_category_id = p_item_category_id
            ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
        ELSE
            RAISE EXCEPTION 'Partial count requires catalog_item_ids or item_category_id';
        END IF;
    END IF;

    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id, p_scope => 'inventory',
        p_event_type => 'cycle_count.started', p_aggregate_type => 'cycle_count',
        p_aggregate_id => v_count_id,
        p_payload => jsonb_build_object('cycle_count_id', v_count_id, 'location_id', p_location_id, 'count_type', p_count_type)
    );
    RETURN v_count_id;
END;
$$;

-- 2. Fix older start RPC overload
CREATE OR REPLACE FUNCTION inventory.rpc_inv_cycle_count_start(
  p_tenant_id UUID, p_location_id UUID, p_count_type TEXT,
  p_catalog_item_ids UUID[] DEFAULT NULL, p_item_category_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_count_id UUID; v_event_id TEXT;
BEGIN
    v_event_id := COALESCE(p_idempotency_key, gen_random_uuid()::TEXT);

    INSERT INTO inventory.cycle_counts (
        tenant_id, location_id, count_type, status, last_event_id
    ) VALUES (
        p_tenant_id, p_location_id, p_count_type, 'open', v_event_id
    ) ON CONFLICT (tenant_id, last_event_id) DO NOTHING RETURNING id INTO v_count_id;

    IF v_count_id IS NULL THEN
        SELECT id INTO v_count_id FROM inventory.cycle_counts WHERE tenant_id = p_tenant_id AND last_event_id = v_event_id;
        RETURN v_count_id;
    END IF;

    IF p_count_type IN ('full', 'initial') THEN
        INSERT INTO inventory.cycle_count_lines (
            tenant_id, cycle_count_id, location_id, catalog_item_id, qty_expected, line_number, last_event_id
        )
        SELECT sb.tenant_id, v_count_id, p_location_id, sb.catalog_item_id, sb.qty_on_hand,
               ROW_NUMBER() OVER (ORDER BY sb.catalog_item_id),
               v_event_id || '_line_' || sb.catalog_item_id::TEXT
        FROM inventory.stock_balances sb
        WHERE sb.tenant_id = p_tenant_id AND sb.location_id = p_location_id AND sb.qty_on_hand > 0
        ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
    ELSIF p_count_type = 'partial' THEN
        IF p_catalog_item_ids IS NOT NULL THEN
            INSERT INTO inventory.cycle_count_lines (
                tenant_id, cycle_count_id, location_id, catalog_item_id, qty_expected, line_number, last_event_id
            )
            SELECT sb.tenant_id, v_count_id, p_location_id, sb.catalog_item_id, sb.qty_on_hand,
                   ROW_NUMBER() OVER (ORDER BY sb.catalog_item_id),
                   v_event_id || '_line_' || sb.catalog_item_id::TEXT
            FROM inventory.stock_balances sb
            WHERE sb.tenant_id = p_tenant_id AND sb.location_id = p_location_id
              AND sb.catalog_item_id = ANY(p_catalog_item_ids)
            ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
        ELSIF p_item_category_id IS NOT NULL THEN
            INSERT INTO inventory.cycle_count_lines (
                tenant_id, cycle_count_id, location_id, catalog_item_id, qty_expected, line_number, last_event_id
            )
            SELECT sb.tenant_id, v_count_id, p_location_id, sb.catalog_item_id, sb.qty_on_hand,
                   ROW_NUMBER() OVER (ORDER BY sb.catalog_item_id),
                   v_event_id || '_line_' || sb.catalog_item_id::TEXT
            FROM inventory.stock_balances sb
            JOIN inventory.catalog_items ci ON ci.id = sb.catalog_item_id
            WHERE sb.tenant_id = p_tenant_id AND sb.location_id = p_location_id
              AND ci.item_category_id = p_item_category_id
            ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
        ELSE
            RAISE EXCEPTION 'Partial count requires catalog_item_ids or item_category_id';
        END IF;
    END IF;

    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id, p_scope => 'inventory',
        p_event_type => 'cycle_count.started', p_aggregate_type => 'cycle_count',
        p_aggregate_id => v_count_id,
        p_payload => jsonb_build_object('count_type', p_count_type, 'location_id', p_location_id),
        p_last_event_id => v_event_id || '_evt'
    );
    RETURN v_count_id;
END;
$$;

-- 3. Fix add_line RPC (wrong column name + missing location_id/line_number)
CREATE OR REPLACE FUNCTION inventory.rpc_inv_cycle_count_add_line(
  p_cycle_count_id UUID, p_catalog_item_id UUID, p_tenant_id UUID, p_last_event_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count RECORD; v_expected NUMERIC := 0; v_line_id UUID;
  v_catalog_item RECORD; v_existing_line RECORD; v_next_line INT;
BEGIN
  SELECT * INTO v_count FROM inventory.cycle_counts WHERE id = p_cycle_count_id AND tenant_id = p_tenant_id;
  IF v_count IS NULL THEN RAISE EXCEPTION 'Cycle count not found'; END IF;
  IF v_count.status != 'in_progress' THEN RAISE EXCEPTION 'Cycle count is not in progress'; END IF;
  IF v_count.count_type != 'initial' THEN RAISE EXCEPTION 'Can only add items to initial counts'; END IF;

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
  FROM inventory.cycle_count_lines WHERE cycle_count_id = p_cycle_count_id AND tenant_id = p_tenant_id;

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
$$;

-- 4. New RPC: hydrate existing empty initial counts from stock_balances
CREATE OR REPLACE FUNCTION inventory.rpc_inv_cycle_count_hydrate_initial(
  p_cycle_count_id UUID, p_tenant_id UUID
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count RECORD; v_inserted INT := 0; v_max_line INT := 0;
BEGIN
  SELECT * INTO v_count FROM inventory.cycle_counts WHERE id = p_cycle_count_id AND tenant_id = p_tenant_id;
  IF v_count IS NULL THEN RAISE EXCEPTION 'Cycle count not found'; END IF;
  IF v_count.count_type != 'initial' THEN RETURN 0; END IF;
  IF v_count.status NOT IN ('in_progress', 'open') THEN RETURN 0; END IF;

  IF EXISTS (
    SELECT 1 FROM inventory.cycle_count_lines
    WHERE cycle_count_id = p_cycle_count_id AND tenant_id = p_tenant_id LIMIT 1
  ) THEN RETURN 0; END IF;

  SELECT COALESCE(MAX(line_number), 0) INTO v_max_line
  FROM inventory.cycle_count_lines WHERE cycle_count_id = p_cycle_count_id AND tenant_id = p_tenant_id;

  INSERT INTO inventory.cycle_count_lines (
    tenant_id, cycle_count_id, location_id, catalog_item_id, qty_expected, line_number, last_event_id
  )
  SELECT sb.tenant_id, p_cycle_count_id, v_count.location_id, sb.catalog_item_id, sb.qty_on_hand,
         v_max_line + ROW_NUMBER() OVER (ORDER BY sb.catalog_item_id),
         'hydrate_' || p_cycle_count_id || '_' || sb.catalog_item_id::TEXT
  FROM inventory.stock_balances sb
  WHERE sb.tenant_id = p_tenant_id AND sb.location_id = v_count.location_id AND sb.qty_on_hand > 0
  ON CONFLICT (tenant_id, last_event_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_cycle_count_hydrate_initial(UUID, UUID)
  IS 'Populates an empty initial count with stock_balance items. Safe to call multiple times.';

GRANT EXECUTE ON FUNCTION inventory.rpc_inv_cycle_count_hydrate_initial(UUID, UUID)
  TO authenticated, service_role;
