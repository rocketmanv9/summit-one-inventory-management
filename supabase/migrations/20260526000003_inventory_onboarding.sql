-- Inventory onboarding: mobile session tables + submit RPC
-- Allows admin users to onboard initial stock at a location via mobile QR code.

-- ── Table: mobile_onboarding_sessions ──
-- Stores session tokens for mobile onboarding (mirrors mobile_count_sessions pattern)

CREATE TABLE inventory.mobile_onboarding_sessions (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  token               TEXT NOT NULL UNIQUE,
  location_id         UUID NOT NULL REFERENCES inventory.locations(id),
  created_by_user_id  UUID NOT NULL,
  status              TEXT NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress', 'submitted', 'cancelled')),
  ttl_minutes         INTEGER NOT NULL DEFAULT 240,
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  last_event_id       TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE inventory.mobile_onboarding_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON inventory.mobile_onboarding_sessions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_tenant_access"
  ON inventory.mobile_onboarding_sessions
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  )
  WITH CHECK (
    tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  );

CREATE INDEX idx_mobile_onboarding_sessions_tenant_id
  ON inventory.mobile_onboarding_sessions (tenant_id);

CREATE INDEX idx_mobile_onboarding_sessions_location_id
  ON inventory.mobile_onboarding_sessions (location_id);

CREATE INDEX idx_mobile_onboarding_sessions_active
  ON inventory.mobile_onboarding_sessions (expires_at)
  WHERE revoked_at IS NULL AND status = 'in_progress';


-- ── Table: mobile_onboarding_lines ──
-- Scratchpad for items being set during the onboarding session

CREATE TABLE inventory.mobile_onboarding_lines (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id               UUID NOT NULL,
  onboarding_session_id   UUID NOT NULL REFERENCES inventory.mobile_onboarding_sessions(id) ON DELETE CASCADE,
  catalog_item_id         UUID NOT NULL REFERENCES inventory.catalog_items(id),
  target_qty              NUMERIC NOT NULL DEFAULT 0,
  existing_qty            NUMERIC NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (onboarding_session_id, catalog_item_id)
);

ALTER TABLE inventory.mobile_onboarding_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON inventory.mobile_onboarding_lines
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_tenant_access"
  ON inventory.mobile_onboarding_lines
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  )
  WITH CHECK (
    tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  );

CREATE INDEX idx_mobile_onboarding_lines_tenant_id
  ON inventory.mobile_onboarding_lines (tenant_id);

CREATE INDEX idx_mobile_onboarding_lines_session_id
  ON inventory.mobile_onboarding_lines (onboarding_session_id);


-- ── RPC: rpc_submit_onboarding ──
-- Atomically converts onboarding lines to stock movements and marks session submitted.

CREATE OR REPLACE FUNCTION inventory.rpc_submit_onboarding(
  p_session_id UUID,
  p_tenant_id  UUID,
  p_user_id    UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_session       RECORD;
  v_line          RECORD;
  v_location_id   UUID;
  v_current_qty   NUMERIC;
  v_delta         NUMERIC;
  v_correlation   UUID := gen_random_uuid();
  v_count         INT := 0;
BEGIN
  -- Lock and validate session
  SELECT * INTO v_session
    FROM inventory.mobile_onboarding_sessions
   WHERE id = p_session_id
     AND tenant_id = p_tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Onboarding session not found';
  END IF;

  IF v_session.status = 'submitted' THEN
    -- Idempotent: already submitted
    RETURN jsonb_build_object('already_submitted', true, 'session_id', p_session_id);
  END IF;

  IF v_session.status = 'cancelled' THEN
    RAISE EXCEPTION 'Onboarding session has been cancelled';
  END IF;

  v_location_id := v_session.location_id;

  -- Process each onboarding line
  FOR v_line IN
    SELECT ol.catalog_item_id, ol.target_qty
      FROM inventory.mobile_onboarding_lines ol
     WHERE ol.onboarding_session_id = p_session_id
       AND ol.tenant_id = p_tenant_id
  LOOP
    -- Read live stock balance (not snapshot)
    SELECT COALESCE(sb.qty_on_hand, 0) INTO v_current_qty
      FROM inventory.stock_balances sb
     WHERE sb.catalog_item_id = v_line.catalog_item_id
       AND sb.location_id = v_location_id
       AND sb.tenant_id = p_tenant_id;

    IF NOT FOUND THEN
      v_current_qty := 0;
    END IF;

    v_delta := v_line.target_qty - v_current_qty;

    -- Skip if no change needed
    IF v_delta = 0 THEN
      CONTINUE;
    END IF;

    -- Use the existing idempotent insert_stock_movement function
    PERFORM inventory.insert_stock_movement(
      p_tenant_id        := p_tenant_id,
      p_catalog_item_id  := v_line.catalog_item_id,
      p_location_id      := v_location_id,
      p_quantity_delta    := v_delta,
      p_movement_type    := 'adjusted',
      p_source_ref_type  := 'onboarding',
      p_source_ref_id    := p_session_id,
      p_unit_cost        := NULL,
      p_reason           := 'inventory_onboarding',
      p_notes            := 'Inventory onboarding session',
      p_correlation_id   := v_correlation,
      p_occurred_at      := now(),
      p_created_by_user_id := p_user_id,
      p_last_event_id    := 'onboard-' || p_session_id || '-' || v_line.catalog_item_id
    );

    v_count := v_count + 1;
  END LOOP;

  -- Mark session submitted
  UPDATE inventory.mobile_onboarding_sessions
     SET status = 'submitted',
         updated_at = now()
   WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'movements_created', v_count,
    'correlation_id', v_correlation
  );
END;
$$;

COMMENT ON FUNCTION inventory.rpc_submit_onboarding(UUID, UUID, UUID)
  IS 'Atomically converts onboarding lines to stock movements. Idempotent via insert_stock_movement dedup.';
