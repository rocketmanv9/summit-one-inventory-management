-- Add transfer_assets to link specific assets to transfer lines

CREATE TABLE IF NOT EXISTS inventory.transfer_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  transfer_id uuid NOT NULL REFERENCES inventory.transfers(id) ON DELETE CASCADE,
  transfer_line_id uuid NOT NULL REFERENCES inventory.transfer_lines(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES inventory.assets(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transfer_line_id, asset_id)
);

CREATE INDEX IF NOT EXISTS transfer_assets_transfer_id_idx
  ON inventory.transfer_assets (transfer_id);

CREATE INDEX IF NOT EXISTS transfer_assets_asset_id_idx
  ON inventory.transfer_assets (asset_id);

ALTER TABLE inventory.transfer_assets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'transfer_assets'
      AND policyname = 'transfer_assets_tenant_isolation'
  ) THEN
    CREATE POLICY transfer_assets_tenant_isolation
      ON inventory.transfer_assets
      FOR ALL
      USING (tenant_id = public.current_tenant_id())
      WITH CHECK (tenant_id = public.current_tenant_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'auto_inject_tenant_transfer_assets'
  ) THEN
    CREATE TRIGGER auto_inject_tenant_transfer_assets
      BEFORE INSERT ON inventory.transfer_assets
      FOR EACH ROW
      EXECUTE FUNCTION inventory.auto_inject_tenant_id();
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.transfer_assets TO authenticated;

-- Update transfer create to support serialized asset selection
CREATE OR REPLACE FUNCTION inventory.rpc_inv_transfer_create(
    p_tenant_id uuid,
    p_from_location_id uuid,
    p_to_location_id uuid,
    p_lines jsonb,
    p_initiated_by_user_id uuid,
    p_notes text DEFAULT NULL,
    p_last_event_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_transfer_id uuid;
    v_transfer_number text;
    v_line jsonb;
    v_line_number integer := 1;
    v_event_id text;
    v_stock_balance record;
    v_item_name text;
    v_location_name text;
    v_tracking_mode text;
    v_available_assets integer;
    v_asset_ids jsonb;
    v_requested_qty integer;
    v_line_id uuid;
BEGIN
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id is required';
    END IF;

    IF p_from_location_id = p_to_location_id THEN
        RAISE EXCEPTION 'from_location_id and to_location_id must be different';
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        SELECT tracking_mode, name INTO v_tracking_mode, v_item_name
        FROM inventory.catalog_items
        WHERE id = (v_line->>'catalog_item_id')::uuid
          AND tenant_id = p_tenant_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Catalog item not found';
        END IF;

        SELECT name INTO v_location_name
        FROM inventory.locations
        WHERE id = p_from_location_id
          AND tenant_id = p_tenant_id;

        v_asset_ids := v_line->'asset_ids';

        IF v_tracking_mode = 'serialized' THEN
            IF v_asset_ids IS NULL OR jsonb_typeof(v_asset_ids) <> 'array' OR jsonb_array_length(v_asset_ids) = 0 THEN
                RAISE EXCEPTION 'Select assets for serialized item "%" at location "%"', v_item_name, v_location_name;
            END IF;

            v_requested_qty := COALESCE(NULLIF(v_line->>'qty', '')::integer, jsonb_array_length(v_asset_ids));

            IF v_requested_qty != jsonb_array_length(v_asset_ids) THEN
                RAISE EXCEPTION 'Qty must match selected assets for "%". Selected: %, Qty: %',
                    v_item_name,
                    jsonb_array_length(v_asset_ids),
                    v_requested_qty;
            END IF;

            SELECT COUNT(*) INTO v_available_assets
            FROM inventory.assets
            WHERE tenant_id = p_tenant_id
              AND id IN (SELECT (jsonb_array_elements_text(v_asset_ids))::uuid)
              AND catalog_item_id = (v_line->>'catalog_item_id')::uuid
              AND location_id = p_from_location_id
              AND status IN ('available', 'assigned');

            IF v_available_assets < jsonb_array_length(v_asset_ids) THEN
                RAISE EXCEPTION 'Some selected assets are not available for "%" at "%"', v_item_name, v_location_name;
            END IF;
        ELSE
            SELECT sb.qty_on_hand, sb.qty_reserved, ci.name
            INTO v_stock_balance
            FROM inventory.stock_balances sb
            JOIN inventory.catalog_items ci ON sb.catalog_item_id = ci.id
            WHERE sb.tenant_id = p_tenant_id
              AND sb.catalog_item_id = (v_line->>'catalog_item_id')::uuid
              AND sb.location_id = p_from_location_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Item "%" has no inventory at location "%". Cannot create transfer.',
                    v_item_name, v_location_name;
            END IF;

            IF v_stock_balance.qty_on_hand < (v_line->>'qty')::numeric THEN
                RAISE EXCEPTION 'Insufficient stock for item "%" at location "%". Available: %, Requested: %',
                    v_stock_balance.name,
                    v_location_name,
                    v_stock_balance.qty_on_hand,
                    (v_line->>'qty')::numeric;
            END IF;
        END IF;
    END LOOP;

    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required';
    END IF;
    v_event_id := p_last_event_id;

    v_transfer_number := 'TRF-' || to_char(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0') || SUBSTRING(gen_random_uuid()::TEXT, 1, 4);

    LOOP
        BEGIN
            INSERT INTO inventory.transfers (
                tenant_id,
                transfer_number,
                from_location_id,
                to_location_id,
                status,
                initiated_by_user_id,
                notes,
                last_event_id
            ) VALUES (
                p_tenant_id,
                v_transfer_number,
                p_from_location_id,
                p_to_location_id,
                'draft',
                p_initiated_by_user_id,
                p_notes,
                v_event_id
            )
            ON CONFLICT (tenant_id, last_event_id) DO NOTHING
            RETURNING id INTO v_transfer_id;

            IF v_transfer_id IS NOT NULL THEN
                EXIT;
            END IF;

            SELECT id INTO v_transfer_id
            FROM inventory.transfers
            WHERE tenant_id = p_tenant_id
              AND last_event_id = v_event_id;

            IF v_transfer_id IS NOT NULL THEN
                RETURN v_transfer_id;
            END IF;

        EXCEPTION
            WHEN unique_violation THEN
                IF SQLERRM LIKE '%transfers_tenant_transfer_number_unique%' THEN
                    v_transfer_number := 'TRF-' || to_char(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0') || SUBSTRING(gen_random_uuid()::TEXT, 1, 4);
                    CONTINUE;
                ELSE
                    RAISE;
                END IF;
        END;
    END LOOP;

    v_line_number := 1;
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        SELECT tracking_mode INTO v_tracking_mode
        FROM inventory.catalog_items
        WHERE id = (v_line->>'catalog_item_id')::uuid
          AND tenant_id = p_tenant_id;

        v_asset_ids := v_line->'asset_ids';

        IF v_tracking_mode = 'serialized' THEN
            v_requested_qty := jsonb_array_length(v_asset_ids);
        ELSE
            v_requested_qty := (v_line->>'qty')::integer;
        END IF;

        INSERT INTO inventory.transfer_lines (
            tenant_id,
            transfer_id,
            line_number,
            catalog_item_id,
            qty,
            last_event_id
        ) VALUES (
            p_tenant_id,
            v_transfer_id,
            v_line_number,
            (v_line->>'catalog_item_id')::uuid,
            v_requested_qty,
            v_event_id || '_line_' || v_line_number
        )
        RETURNING id INTO v_line_id;

        IF v_tracking_mode = 'serialized' THEN
            INSERT INTO inventory.transfer_assets (
                tenant_id,
                transfer_id,
                transfer_line_id,
                asset_id
            )
            SELECT
                p_tenant_id,
                v_transfer_id,
                v_line_id,
                (jsonb_array_elements_text(v_asset_ids))::uuid;
        END IF;

        v_line_number := v_line_number + 1;
    END LOOP;

    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'transfer.created',
        p_aggregate_type => 'transfer',
        p_aggregate_id => v_transfer_id,
        p_payload => jsonb_build_object(
            'transfer_id', v_transfer_id,
            'from_location_id', p_from_location_id,
            'to_location_id', p_to_location_id,
            'line_count', jsonb_array_length(p_lines)
        )
    );

    RETURN v_transfer_id;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_transfer_create IS 'Creates transfer in draft status with validation for both fungible (stock) and serialized (assets) items';

-- Update transfer execute to move serialized assets on receipt
CREATE OR REPLACE FUNCTION inventory.rpc_inv_transfer_execute(
    p_tenant_id uuid,
    p_transfer_id uuid,
    p_received_by_user_id uuid,
    p_last_event_id text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_transfer record;
    v_line record;
    v_correlation_id uuid;
    v_event_id text;
    v_now timestamptz := now();
BEGIN
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required';
    END IF;
    v_event_id := p_last_event_id;

    SELECT * INTO v_transfer
    FROM inventory.transfers
    WHERE id = p_transfer_id
      AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer not found';
    END IF;

    IF v_transfer.status NOT IN ('draft', 'in_transit') THEN
        RAISE EXCEPTION 'Transfer cannot be executed in status: %', v_transfer.status;
    END IF;

    v_correlation_id := gen_random_uuid();

    FOR v_line IN
        SELECT * FROM inventory.transfer_lines
        WHERE transfer_id = p_transfer_id
        ORDER BY line_number
    LOOP
        PERFORM 1;
        IF EXISTS (
            SELECT 1
            FROM inventory.catalog_items ci
            WHERE ci.id = v_line.catalog_item_id
              AND ci.tracking_mode IN ('serialized', 'both', 'hybrid')
        ) THEN
            -- Serialized assets: skip stock balances, location is updated below
            CONTINUE;
        END IF;

        PERFORM inventory.insert_stock_movement(
            p_tenant_id => p_tenant_id,
            p_catalog_item_id => v_line.catalog_item_id,
            p_location_id => v_transfer.from_location_id,
            p_quantity_delta => -v_line.qty,
            p_movement_type => 'transferred_out',
            p_source_ref_type => 'transfer',
            p_source_ref_id => p_transfer_id,
            p_unit_cost => NULL,
            p_reason => 'Transfer to ' || (SELECT name FROM inventory.locations WHERE id = v_transfer.to_location_id),
            p_notes => 'Transfer #' || v_transfer.transfer_number,
            p_correlation_id => v_correlation_id,
            p_occurred_at => v_now,
            p_created_by_user_id => p_received_by_user_id,
            p_last_event_id => v_event_id || '_out_' || v_line.line_number
        );

        PERFORM inventory.insert_stock_movement(
            p_tenant_id => p_tenant_id,
            p_catalog_item_id => v_line.catalog_item_id,
            p_location_id => v_transfer.to_location_id,
            p_quantity_delta => v_line.qty,
            p_movement_type => 'transferred_in',
            p_source_ref_type => 'transfer',
            p_source_ref_id => p_transfer_id,
            p_unit_cost => NULL,
            p_reason => 'Transfer from ' || (SELECT name FROM inventory.locations WHERE id = v_transfer.from_location_id),
            p_notes => 'Transfer #' || v_transfer.transfer_number,
            p_correlation_id => v_correlation_id,
            p_occurred_at => v_now,
            p_created_by_user_id => p_received_by_user_id,
            p_last_event_id => v_event_id || '_in_' || v_line.line_number
        );
    END LOOP;

    UPDATE inventory.assets a
    SET
        location_id = v_transfer.to_location_id,
        updated_at = v_now
    FROM inventory.transfer_assets ta
    WHERE ta.transfer_id = p_transfer_id
      AND ta.tenant_id = p_tenant_id
      AND a.id = ta.asset_id
      AND a.tenant_id = p_tenant_id;

    UPDATE inventory.transfers
    SET
        status = 'completed',
        received_by_user_id = p_received_by_user_id,
        completed_at = v_now,
        updated_at = v_now
    WHERE id = p_transfer_id;

    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'transfer.completed',
        p_aggregate_type => 'transfer',
        p_aggregate_id => p_transfer_id,
        p_payload => jsonb_build_object(
            'transfer_id', p_transfer_id,
            'transfer_number', v_transfer.transfer_number,
            'from_location_id', v_transfer.from_location_id,
            'to_location_id', v_transfer.to_location_id,
            'correlation_id', v_correlation_id
        )
    );

    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_transfer_execute IS 'Executes transfer by writing paired ledger entries (idempotent) and updates serialized asset locations on receipt';
