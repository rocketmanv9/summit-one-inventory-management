-- Add 'initial' count type for first-time inventory counts
-- Initial counts start with zero lines; items are added one-by-one via
-- rpc_inv_cycle_count_add_line (barcode scan or manual search).

-- 1. Widen the count_type CHECK constraint to include 'initial'
ALTER TABLE inventory.cycle_counts
  DROP CONSTRAINT IF EXISTS cycle_counts_count_type_check;

ALTER TABLE inventory.cycle_counts
  ADD CONSTRAINT cycle_counts_count_type_check
  CHECK (count_type = ANY (ARRAY['full','partial','spot_check','initial']));

-- 2. Update rpc_inv_cycle_count_start to handle 'initial' type
--    Initial counts create a header row but skip line generation.
CREATE OR REPLACE FUNCTION inventory.rpc_inv_cycle_count_start(
  p_tenant_id       UUID,
  p_location_id     UUID,
  p_count_type      TEXT,
  p_catalog_item_ids UUID[]  DEFAULT NULL,
  p_item_category_id UUID   DEFAULT NULL,
  p_counted_by_user_id UUID DEFAULT NULL,
  p_last_event_id   TEXT    DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_count_id UUID;
    v_event_id TEXT;
BEGIN
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required';
    END IF;
    v_event_id := p_last_event_id;

    -- Validate count_type (now includes 'initial')
    IF p_count_type NOT IN ('full', 'partial', 'spot_check', 'initial') THEN
        RAISE EXCEPTION 'Invalid count_type. Must be: full, partial, spot_check, initial';
    END IF;

    -- Create count header
    INSERT INTO inventory.cycle_counts (
        tenant_id,
        location_id,
        count_type,
        status,
        counted_by_user_id,
        last_event_id
    ) VALUES (
        p_tenant_id,
        p_location_id,
        p_count_type,
        'in_progress',
        p_counted_by_user_id,
        v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_count_id;

    -- Idempotent replay: return existing count id
    IF v_count_id IS NULL THEN
        SELECT id INTO v_count_id
        FROM inventory.cycle_counts
        WHERE tenant_id = p_tenant_id AND last_event_id = v_event_id;
        RETURN v_count_id;
    END IF;

    -- Create count lines based on type
    -- 'initial' counts start empty — lines are added via rpc_inv_cycle_count_add_line
    IF p_count_type = 'full' THEN
        INSERT INTO inventory.cycle_count_lines (
            tenant_id,
            cycle_count_id,
            catalog_item_id,
            expected_qty,
            last_event_id
        )
        SELECT
            sb.tenant_id,
            v_count_id,
            sb.catalog_item_id,
            sb.qty_on_hand,
            v_event_id || '_line_' || sb.catalog_item_id::TEXT
        FROM inventory.stock_balances sb
        WHERE sb.tenant_id = p_tenant_id
          AND sb.location_id = p_location_id
          AND sb.qty_on_hand > 0
        ON CONFLICT (tenant_id, last_event_id) DO NOTHING;

    ELSIF p_count_type = 'partial' THEN
        IF p_catalog_item_ids IS NOT NULL THEN
            INSERT INTO inventory.cycle_count_lines (
                tenant_id,
                cycle_count_id,
                catalog_item_id,
                expected_qty,
                last_event_id
            )
            SELECT
                sb.tenant_id,
                v_count_id,
                sb.catalog_item_id,
                sb.qty_on_hand,
                v_event_id || '_line_' || sb.catalog_item_id::TEXT
            FROM inventory.stock_balances sb
            WHERE sb.tenant_id = p_tenant_id
              AND sb.location_id = p_location_id
              AND sb.catalog_item_id = ANY(p_catalog_item_ids)
            ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
        ELSIF p_item_category_id IS NOT NULL THEN
            INSERT INTO inventory.cycle_count_lines (
                tenant_id,
                cycle_count_id,
                catalog_item_id,
                expected_qty,
                last_event_id
            )
            SELECT
                sb.tenant_id,
                v_count_id,
                sb.catalog_item_id,
                sb.qty_on_hand,
                v_event_id || '_line_' || sb.catalog_item_id::TEXT
            FROM inventory.stock_balances sb
            JOIN inventory.catalog_items ci ON ci.id = sb.catalog_item_id
            WHERE sb.tenant_id = p_tenant_id
              AND sb.location_id = p_location_id
              AND ci.item_category_id = p_item_category_id
            ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
        ELSE
            RAISE EXCEPTION 'Partial count requires catalog_item_ids or item_category_id';
        END IF;
    END IF;
    -- p_count_type = 'initial' or 'spot_check': no lines created here

    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id    => p_tenant_id,
        p_scope        => 'inventory',
        p_event_type   => 'cycle_count.started',
        p_aggregate_type => 'cycle_count',
        p_aggregate_id => v_count_id,
        p_payload      => jsonb_build_object(
            'cycle_count_id', v_count_id,
            'location_id', p_location_id,
            'count_type', p_count_type
        )
    );

    RETURN v_count_id;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_cycle_count_start(UUID, UUID, TEXT, UUID[], UUID, UUID, TEXT)
  IS 'Starts new cycle count and creates lines based on count type. Initial counts start empty.';

-- 3. New RPC: add a single line to an initial count (barcode scan / manual pick)
--    Idempotent via (tenant_id, last_event_id) unique constraint on cycle_count_lines.
CREATE OR REPLACE FUNCTION inventory.rpc_inv_cycle_count_add_line(
  p_cycle_count_id  UUID,
  p_catalog_item_id UUID,
  p_tenant_id       UUID,
  p_last_event_id   UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count         RECORD;
  v_expected      NUMERIC := 0;
  v_line_id       UUID;
  v_catalog_item  RECORD;
  v_existing_line RECORD;
BEGIN
  -- Validate the cycle count exists and belongs to this tenant
  SELECT * INTO v_count
  FROM inventory.cycle_counts
  WHERE id = p_cycle_count_id AND tenant_id = p_tenant_id;

  IF v_count IS NULL THEN
    RAISE EXCEPTION 'Cycle count not found';
  END IF;

  IF v_count.status != 'in_progress' THEN
    RAISE EXCEPTION 'Cycle count is not in progress';
  END IF;

  IF v_count.count_type != 'initial' THEN
    RAISE EXCEPTION 'Can only add items to initial counts';
  END IF;

  -- Look up catalog item details
  SELECT id, name, sku, barcode, tracking_mode, uom_term_id
  INTO v_catalog_item
  FROM inventory.catalog_items
  WHERE id = p_catalog_item_id AND tenant_id = p_tenant_id;

  IF v_catalog_item IS NULL THEN
    RAISE EXCEPTION 'Catalog item not found';
  END IF;

  -- Check if this item is already on this count (idempotent - return existing)
  SELECT id INTO v_existing_line
  FROM inventory.cycle_count_lines
  WHERE cycle_count_id = p_cycle_count_id
    AND catalog_item_id = p_catalog_item_id
    AND tenant_id = p_tenant_id;

  IF v_existing_line IS NOT NULL THEN
    -- Already exists — return existing line info
    RETURN jsonb_build_object(
      'id', v_existing_line.id,
      'catalog_item_id', p_catalog_item_id,
      'qty_expected', (
        SELECT expected_qty FROM inventory.cycle_count_lines WHERE id = v_existing_line.id
      ),
      'catalog_item', jsonb_build_object(
        'name', v_catalog_item.name,
        'sku', v_catalog_item.sku,
        'barcode', v_catalog_item.barcode,
        'tracking_mode', v_catalog_item.tracking_mode,
        'uom_term_id', v_catalog_item.uom_term_id
      )
    );
  END IF;

  -- Look up current stock balance (if any) to set expected_qty
  SELECT COALESCE(sb.qty_on_hand, 0) INTO v_expected
  FROM inventory.stock_balances sb
  WHERE sb.catalog_item_id = p_catalog_item_id
    AND sb.location_id = v_count.location_id
    AND sb.tenant_id = p_tenant_id;

  IF v_expected IS NULL THEN
    v_expected := 0;
  END IF;

  -- Insert new line (use last_event_id for idempotency via unique constraint)
  INSERT INTO inventory.cycle_count_lines (
    tenant_id,
    cycle_count_id,
    catalog_item_id,
    expected_qty,
    last_event_id
  ) VALUES (
    p_tenant_id,
    p_cycle_count_id,
    p_catalog_item_id,
    v_expected,
    p_last_event_id::TEXT
  )
  ON CONFLICT (tenant_id, last_event_id) DO NOTHING
  RETURNING id INTO v_line_id;

  -- If conflict on last_event_id (idempotent replay), fetch existing
  IF v_line_id IS NULL THEN
    SELECT id INTO v_line_id
    FROM inventory.cycle_count_lines
    WHERE tenant_id = p_tenant_id AND last_event_id = p_last_event_id::TEXT;
  END IF;

  RETURN jsonb_build_object(
    'id', v_line_id,
    'catalog_item_id', p_catalog_item_id,
    'qty_expected', v_expected,
    'catalog_item', jsonb_build_object(
      'name', v_catalog_item.name,
      'sku', v_catalog_item.sku,
      'barcode', v_catalog_item.barcode,
      'tracking_mode', v_catalog_item.tracking_mode,
      'uom_term_id', v_catalog_item.uom_term_id
    )
  );
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_cycle_count_add_line(UUID, UUID, UUID, UUID)
  IS 'Add a single catalog item line to an in-progress initial count. Idempotent.';

-- Grants
GRANT EXECUTE ON FUNCTION inventory.rpc_inv_cycle_count_add_line(UUID, UUID, UUID, UUID)
  TO authenticated, service_role;
