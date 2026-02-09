-- =====================================================================
-- Migration: Vendor Code Settings + Snapshots
-- Date: 2026-02-09
-- Description: Tenant-configurable vendor code rules, generation, and
--              snapshotting for POs/receipts and events.
-- =====================================================================

-- =====================================================================
-- 1. Tenant Settings: Vendor Code Configuration
-- =====================================================================

ALTER TABLE supply_chain.tenant_settings
  ADD COLUMN IF NOT EXISTS vendor_code_strategy TEXT NOT NULL DEFAULT 'manual'
    CHECK (vendor_code_strategy IN ('manual', 'sequential', 'hybrid', 'import')),
  ADD COLUMN IF NOT EXISTS vendor_code_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vendor_code_case TEXT NOT NULL DEFAULT 'preserve'
    CHECK (vendor_code_case IN ('upper', 'lower', 'preserve')),
  ADD COLUMN IF NOT EXISTS vendor_code_min_length INTEGER,
  ADD COLUMN IF NOT EXISTS vendor_code_max_length INTEGER,
  ADD COLUMN IF NOT EXISTS vendor_code_prefix TEXT,
  ADD COLUMN IF NOT EXISTS vendor_code_suffix TEXT,
  ADD COLUMN IF NOT EXISTS vendor_code_allowed_chars TEXT,
  ADD COLUMN IF NOT EXISTS vendor_code_regex TEXT,
  ADD COLUMN IF NOT EXISTS vendor_code_user_editable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS vendor_code_immutable_after_use BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS vendor_code_sequence_padding INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS vendor_code_next_seq INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN supply_chain.tenant_settings.vendor_code_strategy IS 'manual | sequential | hybrid | import';
COMMENT ON COLUMN supply_chain.tenant_settings.vendor_code_required IS 'If true, vendor code is required unless auto-generated.';
COMMENT ON COLUMN supply_chain.tenant_settings.vendor_code_case IS 'upper | lower | preserve';
COMMENT ON COLUMN supply_chain.tenant_settings.vendor_code_allowed_chars IS 'Character class for validation, e.g. A-Z0-9_-';
COMMENT ON COLUMN supply_chain.tenant_settings.vendor_code_regex IS 'Optional regex validation for vendor codes.';
COMMENT ON COLUMN supply_chain.tenant_settings.vendor_code_sequence_padding IS 'Left-pad length for sequential codes.';
COMMENT ON COLUMN supply_chain.tenant_settings.vendor_code_next_seq IS 'Next sequence number for sequential vendor codes.';

-- Update get_or_create_tenant_settings with new defaults
CREATE OR REPLACE FUNCTION supply_chain.get_or_create_tenant_settings(p_tenant_id UUID)
RETURNS supply_chain.tenant_settings
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_settings supply_chain.tenant_settings;
BEGIN
  SELECT * INTO v_settings
  FROM supply_chain.tenant_settings
  WHERE tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    INSERT INTO supply_chain.tenant_settings (
      tenant_id,
      po_number_format,
      po_number_prefix,
      po_number_current_seq,
      auto_approve_enabled,
      auto_approve_limit,
      vendor_code_strategy,
      vendor_code_required,
      vendor_code_case,
      vendor_code_min_length,
      vendor_code_max_length,
      vendor_code_prefix,
      vendor_code_suffix,
      vendor_code_allowed_chars,
      vendor_code_regex,
      vendor_code_user_editable,
      vendor_code_immutable_after_use,
      vendor_code_sequence_padding,
      vendor_code_next_seq
    ) VALUES (
      p_tenant_id,
      'sequential-year',
      NULL,
      0,
      false,
      NULL,
      'manual',
      false,
      'preserve',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      true,
      true,
      4,
      0
    )
    RETURNING * INTO v_settings;
  END IF;

  RETURN v_settings;
END;
$$;

-- Tenant settings RPCs (auth-aware)
CREATE OR REPLACE FUNCTION supply_chain.rpc_get_tenant_settings()
RETURNS supply_chain.tenant_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO supply_chain, public
AS $$
DECLARE
  v_tenant_id UUID;
  v_settings supply_chain.tenant_settings;
BEGIN
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required - no tenant_id in JWT';
  END IF;

  SELECT * INTO v_settings
  FROM supply_chain.tenant_settings
  WHERE tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    v_settings := supply_chain.get_or_create_tenant_settings(v_tenant_id);
  END IF;

  RETURN v_settings;
END;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_get_tenant_settings TO authenticated;

CREATE OR REPLACE FUNCTION supply_chain.rpc_update_tenant_settings(p_updates JSONB)
RETURNS supply_chain.tenant_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO supply_chain, public
AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
  v_settings supply_chain.tenant_settings;
BEGIN
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  v_user_id := (auth.jwt() ->> 'user_id')::UUID;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required - no tenant_id in JWT';
  END IF;

  SELECT * INTO v_settings
  FROM supply_chain.tenant_settings
  WHERE tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    v_settings := supply_chain.get_or_create_tenant_settings(v_tenant_id);
  END IF;

  UPDATE supply_chain.tenant_settings
  SET
    po_number_format = COALESCE(p_updates->>'po_number_format', po_number_format),
    po_number_prefix = COALESCE(p_updates->>'po_number_prefix', po_number_prefix),
    auto_approve_enabled = COALESCE((p_updates->>'auto_approve_enabled')::BOOLEAN, auto_approve_enabled),
    auto_approve_limit = COALESCE((p_updates->>'auto_approve_limit')::NUMERIC, auto_approve_limit),
    cycle_count_number_format = COALESCE(p_updates->>'cycle_count_number_format', cycle_count_number_format),
    cycle_count_number_prefix = COALESCE(p_updates->>'cycle_count_number_prefix', cycle_count_number_prefix),
    vendor_auto_approve_limits = COALESCE((p_updates->'vendor_auto_approve_limits')::JSONB, vendor_auto_approve_limits),
    vendor_code_strategy = COALESCE(p_updates->>'vendor_code_strategy', vendor_code_strategy),
    vendor_code_required = COALESCE((p_updates->>'vendor_code_required')::BOOLEAN, vendor_code_required),
    vendor_code_case = COALESCE(p_updates->>'vendor_code_case', vendor_code_case),
    vendor_code_min_length = COALESCE((p_updates->>'vendor_code_min_length')::INTEGER, vendor_code_min_length),
    vendor_code_max_length = COALESCE((p_updates->>'vendor_code_max_length')::INTEGER, vendor_code_max_length),
    vendor_code_prefix = COALESCE(p_updates->>'vendor_code_prefix', vendor_code_prefix),
    vendor_code_suffix = COALESCE(p_updates->>'vendor_code_suffix', vendor_code_suffix),
    vendor_code_allowed_chars = COALESCE(p_updates->>'vendor_code_allowed_chars', vendor_code_allowed_chars),
    vendor_code_regex = COALESCE(p_updates->>'vendor_code_regex', vendor_code_regex),
    vendor_code_user_editable = COALESCE((p_updates->>'vendor_code_user_editable')::BOOLEAN, vendor_code_user_editable),
    vendor_code_immutable_after_use = COALESCE((p_updates->>'vendor_code_immutable_after_use')::BOOLEAN, vendor_code_immutable_after_use),
    vendor_code_sequence_padding = COALESCE((p_updates->>'vendor_code_sequence_padding')::INTEGER, vendor_code_sequence_padding),
    updated_at = NOW(),
    updated_by = v_user_id
  WHERE tenant_id = v_tenant_id
  RETURNING * INTO v_settings;

  RETURN v_settings;
END;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_update_tenant_settings TO authenticated;

-- =====================================================================
-- 2. Vendor Code Generation + Validation
-- =====================================================================

CREATE OR REPLACE FUNCTION supply_chain.generate_vendor_code(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO supply_chain, public
AS $$
DECLARE
  v_settings supply_chain.tenant_settings;
  v_seq INTEGER;
  v_code TEXT;
  v_padding INTEGER;
BEGIN
  SELECT * INTO v_settings
  FROM supply_chain.tenant_settings
  WHERE tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_settings := supply_chain.get_or_create_tenant_settings(p_tenant_id);
  END IF;

  v_padding := GREATEST(1, COALESCE(v_settings.vendor_code_sequence_padding, 4));

  LOOP
    v_seq := COALESCE(v_settings.vendor_code_next_seq, 0) + 1;
    v_code := LPAD(v_seq::TEXT, v_padding, '0');

    IF v_settings.vendor_code_prefix IS NOT NULL THEN
      v_code := v_settings.vendor_code_prefix || v_code;
    END IF;

    IF v_settings.vendor_code_suffix IS NOT NULL THEN
      v_code := v_code || v_settings.vendor_code_suffix;
    END IF;

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM supply_chain.vendors
      WHERE tenant_id = p_tenant_id AND code = v_code
    );

    v_settings.vendor_code_next_seq := v_seq;
  END LOOP;

  UPDATE supply_chain.tenant_settings
  SET vendor_code_next_seq = v_seq,
      updated_at = NOW()
  WHERE tenant_id = p_tenant_id;

  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION supply_chain.enforce_vendor_code_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO supply_chain, public
AS $$
DECLARE
  v_settings supply_chain.tenant_settings;
  v_code TEXT;
  v_has_usage BOOLEAN;
BEGIN
  SELECT * INTO v_settings
  FROM supply_chain.tenant_settings
  WHERE tenant_id = NEW.tenant_id;

  IF NOT FOUND THEN
    v_settings := supply_chain.get_or_create_tenant_settings(NEW.tenant_id);
  END IF;

  v_code := NULLIF(BTRIM(NEW.code), '');

  -- Auto-generate if configured and code not provided
  IF v_code IS NULL THEN
    IF v_settings.vendor_code_strategy IN ('sequential', 'hybrid') THEN
      v_code := supply_chain.generate_vendor_code(NEW.tenant_id);
    ELSIF v_settings.vendor_code_required THEN
      RAISE EXCEPTION 'Vendor code is required by tenant settings';
    ELSE
      NEW.code := NULL;
      RETURN NEW;
    END IF;
  END IF;

  -- Normalize case
  IF v_settings.vendor_code_case = 'upper' THEN
    v_code := UPPER(v_code);
  ELSIF v_settings.vendor_code_case = 'lower' THEN
    v_code := LOWER(v_code);
  END IF;

  -- Validate length
  IF v_settings.vendor_code_min_length IS NOT NULL AND LENGTH(v_code) < v_settings.vendor_code_min_length THEN
    RAISE EXCEPTION 'Vendor code must be at least % characters', v_settings.vendor_code_min_length;
  END IF;
  IF v_settings.vendor_code_max_length IS NOT NULL AND LENGTH(v_code) > v_settings.vendor_code_max_length THEN
    RAISE EXCEPTION 'Vendor code must be at most % characters', v_settings.vendor_code_max_length;
  END IF;

  -- Validate prefix/suffix
  IF v_settings.vendor_code_prefix IS NOT NULL AND v_settings.vendor_code_prefix <> '' THEN
    IF v_code NOT LIKE v_settings.vendor_code_prefix || '%' THEN
      RAISE EXCEPTION 'Vendor code must start with %', v_settings.vendor_code_prefix;
    END IF;
  END IF;

  IF v_settings.vendor_code_suffix IS NOT NULL AND v_settings.vendor_code_suffix <> '' THEN
    IF v_code NOT LIKE '%' || v_settings.vendor_code_suffix THEN
      RAISE EXCEPTION 'Vendor code must end with %', v_settings.vendor_code_suffix;
    END IF;
  END IF;

  -- Validate allowed chars
  IF v_settings.vendor_code_allowed_chars IS NOT NULL AND v_settings.vendor_code_allowed_chars <> '' THEN
    IF v_code !~ ('^[' || v_settings.vendor_code_allowed_chars || ']+$') THEN
      RAISE EXCEPTION 'Vendor code contains invalid characters';
    END IF;
  END IF;

  -- Validate regex
  IF v_settings.vendor_code_regex IS NOT NULL AND v_settings.vendor_code_regex <> '' THEN
    IF v_code !~ v_settings.vendor_code_regex THEN
      RAISE EXCEPTION 'Vendor code does not match required format';
    END IF;
  END IF;

  -- Prevent unauthorized edits
  IF TG_OP = 'UPDATE' AND NEW.code IS DISTINCT FROM OLD.code THEN
    IF v_settings.vendor_code_user_editable IS FALSE THEN
      RAISE EXCEPTION 'Vendor code editing is disabled by tenant settings';
    END IF;

    IF v_settings.vendor_code_immutable_after_use THEN
      SELECT EXISTS (
        SELECT 1 FROM supply_chain.purchase_orders po WHERE po.vendor_id = NEW.id
      ) OR EXISTS (
        SELECT 1 FROM supply_chain.receipts r WHERE r.vendor_id = NEW.id
      ) INTO v_has_usage;

      IF v_has_usage THEN
        RAISE EXCEPTION 'Vendor code cannot be changed after purchase activity exists';
      END IF;
    END IF;
  END IF;

  NEW.code := v_code;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_vendor_code_rules ON supply_chain.vendors;
CREATE TRIGGER enforce_vendor_code_rules
  BEFORE INSERT OR UPDATE ON supply_chain.vendors
  FOR EACH ROW
  EXECUTE FUNCTION supply_chain.enforce_vendor_code_rules();

-- =====================================================================
-- 3. Vendor Snapshots on POs + Receipts
-- =====================================================================

ALTER TABLE supply_chain.purchase_orders
  ADD COLUMN IF NOT EXISTS vendor_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS vendor_code_snapshot TEXT;

ALTER TABLE supply_chain.receipts
  ADD COLUMN IF NOT EXISTS vendor_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS vendor_code_snapshot TEXT;

CREATE OR REPLACE FUNCTION supply_chain.set_purchase_order_vendor_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO supply_chain, public
AS $$
DECLARE
  v_name TEXT;
  v_code TEXT;
BEGIN
  IF NEW.vendor_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT name, code INTO v_name, v_code
  FROM supply_chain.vendors
  WHERE id = NEW.vendor_id AND tenant_id = NEW.tenant_id;

  NEW.vendor_name_snapshot := COALESCE(NEW.vendor_name_snapshot, v_name);
  NEW.vendor_code_snapshot := COALESCE(NEW.vendor_code_snapshot, v_code);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_purchase_order_vendor_snapshot ON supply_chain.purchase_orders;
CREATE TRIGGER set_purchase_order_vendor_snapshot
  BEFORE INSERT OR UPDATE OF vendor_id ON supply_chain.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION supply_chain.set_purchase_order_vendor_snapshot();

CREATE OR REPLACE FUNCTION supply_chain.set_receipt_vendor_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO supply_chain, public
AS $$
DECLARE
  v_vendor_id UUID;
  v_name TEXT;
  v_code TEXT;
BEGIN
  IF NEW.vendor_id IS NOT NULL THEN
    v_vendor_id := NEW.vendor_id;
  ELSIF NEW.po_id IS NOT NULL THEN
    SELECT vendor_id, vendor_name_snapshot, vendor_code_snapshot
    INTO v_vendor_id, v_name, v_code
    FROM supply_chain.purchase_orders
    WHERE id = NEW.po_id AND tenant_id = NEW.tenant_id;

    NEW.vendor_name_snapshot := COALESCE(NEW.vendor_name_snapshot, v_name);
    NEW.vendor_code_snapshot := COALESCE(NEW.vendor_code_snapshot, v_code);
  END IF;

  IF v_vendor_id IS NOT NULL THEN
    SELECT name, code INTO v_name, v_code
    FROM supply_chain.vendors
    WHERE id = v_vendor_id AND tenant_id = NEW.tenant_id;

    NEW.vendor_name_snapshot := COALESCE(NEW.vendor_name_snapshot, v_name);
    NEW.vendor_code_snapshot := COALESCE(NEW.vendor_code_snapshot, v_code);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_receipt_vendor_snapshot ON supply_chain.receipts;
CREATE TRIGGER set_receipt_vendor_snapshot
  BEFORE INSERT OR UPDATE OF vendor_id, po_id ON supply_chain.receipts
  FOR EACH ROW
  EXECUTE FUNCTION supply_chain.set_receipt_vendor_snapshot();

-- Backfill snapshots
UPDATE supply_chain.purchase_orders po
SET vendor_name_snapshot = v.name,
    vendor_code_snapshot = v.code
FROM supply_chain.vendors v
WHERE po.vendor_id = v.id
  AND po.tenant_id = v.tenant_id
  AND (po.vendor_name_snapshot IS NULL OR po.vendor_code_snapshot IS NULL);

UPDATE supply_chain.receipts r
SET vendor_name_snapshot = COALESCE(
      r.vendor_name_snapshot,
      v.name,
      (
        SELECT po.vendor_name_snapshot
        FROM supply_chain.purchase_orders po
        WHERE po.id = r.po_id AND po.tenant_id = r.tenant_id
        LIMIT 1
      )
    ),
    vendor_code_snapshot = COALESCE(
      r.vendor_code_snapshot,
      v.code,
      (
        SELECT po.vendor_code_snapshot
        FROM supply_chain.purchase_orders po
        WHERE po.id = r.po_id AND po.tenant_id = r.tenant_id
        LIMIT 1
      )
    )
FROM supply_chain.vendors v
WHERE r.vendor_id = v.id
  AND r.tenant_id = v.tenant_id
  AND (r.vendor_name_snapshot IS NULL OR r.vendor_code_snapshot IS NULL);

-- Update compatibility views
DROP VIEW IF EXISTS inventory.purchase_orders;
CREATE VIEW inventory.purchase_orders AS
 SELECT id,
   tenant_id,
   po_number,
   vendor_location_id,
   status,
   order_date,
   expected_delivery_date,
   delivery_location_id,
   notes,
   created_by_user_id,
   approved_by_user_id,
   approved_at,
   created_at,
   updated_at,
   updated_by,
   last_event_id,
   vendor_id,
   vendor_name_snapshot,
   vendor_code_snapshot
  FROM supply_chain.purchase_orders;

DROP VIEW IF EXISTS inventory.receipts;
CREATE VIEW inventory.receipts AS
 SELECT id,
   tenant_id,
   po_id,
   receipt_number,
   received_at,
   received_by_user_id,
   location_id,
   last_event_id,
   notes,
   created_at,
   updated_at,
   created_by,
   updated_by,
   vendor_id,
   vendor_name_snapshot,
   vendor_code_snapshot
  FROM supply_chain.receipts;

-- =====================================================================
-- 4. Event Payload Updates
-- =====================================================================

CREATE OR REPLACE FUNCTION supply_chain.emit_po_status_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_event_name TEXT;
  v_payload JSONB;
  v_line_count INTEGER;
  v_total_value NUMERIC;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(qty_ordered * COALESCE(unit_cost, 0)), 0)
  INTO v_line_count, v_total_value
  FROM supply_chain.purchase_order_lines
  WHERE po_id = NEW.id;

  IF TG_OP = 'INSERT' THEN
    v_event_name := 'supply_chain.purchase_order.created';
    v_payload := jsonb_build_object(
      'po_id', NEW.id,
      'po_number', NEW.po_number,
      'vendor_id', NEW.vendor_id,
      'vendor_name', NEW.vendor_name_snapshot,
      'vendor_code', NEW.vendor_code_snapshot,
      'order_date', NEW.order_date,
      'expected_delivery_date', NEW.expected_delivery_date,
      'line_items_count', v_line_count,
      'total_value', v_total_value,
      'tenant_id', NEW.tenant_id,
      'created_at', NEW.created_at
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status != NEW.status THEN
      CASE NEW.status
        WHEN 'submitted' THEN
          v_event_name := 'supply_chain.purchase_order.submitted';
          v_payload := jsonb_build_object(
            'po_id', NEW.id,
            'po_number', NEW.po_number,
            'vendor_id', NEW.vendor_id,
            'vendor_name', NEW.vendor_name_snapshot,
            'vendor_code', NEW.vendor_code_snapshot,
            'tenant_id', NEW.tenant_id,
            'submitted_at', NEW.updated_at
          );
        WHEN 'approved' THEN
          v_event_name := 'supply_chain.purchase_order.approved';
          v_payload := jsonb_build_object(
            'po_id', NEW.id,
            'po_number', NEW.po_number,
            'vendor_id', NEW.vendor_id,
            'vendor_name', NEW.vendor_name_snapshot,
            'vendor_code', NEW.vendor_code_snapshot,
            'approved_by_user_id', NEW.approved_by_user_id,
            'tenant_id', NEW.tenant_id,
            'approved_at', NEW.approved_at
          );
        WHEN 'cancelled' THEN
          v_event_name := 'supply_chain.purchase_order.cancelled';
          v_payload := jsonb_build_object(
            'po_id', NEW.id,
            'po_number', NEW.po_number,
            'vendor_id', NEW.vendor_id,
            'vendor_name', NEW.vendor_name_snapshot,
            'vendor_code', NEW.vendor_code_snapshot,
            'tenant_id', NEW.tenant_id,
            'cancelled_at', NEW.updated_at
          );
        WHEN 'closed' THEN
          v_event_name := 'supply_chain.purchase_order.closed';
          v_payload := jsonb_build_object(
            'po_id', NEW.id,
            'po_number', NEW.po_number,
            'vendor_id', NEW.vendor_id,
            'vendor_name', NEW.vendor_name_snapshot,
            'vendor_code', NEW.vendor_code_snapshot,
            'total_lines', v_line_count,
            'tenant_id', NEW.tenant_id,
            'closed_at', NEW.updated_at
          );
        WHEN 'in_transit' THEN
          v_event_name := 'supply_chain.purchase_order.in_transit';
          v_payload := jsonb_build_object(
            'po_id', NEW.id,
            'po_number', NEW.po_number,
            'vendor_id', NEW.vendor_id,
            'vendor_name', NEW.vendor_name_snapshot,
            'vendor_code', NEW.vendor_code_snapshot,
            'tenant_id', NEW.tenant_id,
            'shipped_at', NEW.updated_at
          );
        WHEN 'received' THEN
          v_event_name := 'supply_chain.purchase_order.received';
          v_payload := jsonb_build_object(
            'po_id', NEW.id,
            'po_number', NEW.po_number,
            'vendor_id', NEW.vendor_id,
            'vendor_name', NEW.vendor_name_snapshot,
            'vendor_code', NEW.vendor_code_snapshot,
            'total_lines', v_line_count,
            'tenant_id', NEW.tenant_id,
            'received_at', NEW.updated_at
          );
        ELSE
          RETURN NEW;
      END CASE;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  PERFORM public.emit_event(
    v_event_name,
    v_payload,
    NEW.tenant_id
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION supply_chain.emit_receipt_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_payload JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_payload := jsonb_build_object(
      'receipt_id', NEW.id,
      'receipt_number', NEW.receipt_number,
      'location_id', NEW.location_id,
      'po_id', NEW.po_id,
      'vendor_id', NEW.vendor_id,
      'vendor_name', NEW.vendor_name_snapshot,
      'vendor_code', NEW.vendor_code_snapshot,
      'received_by_user_id', NEW.received_by_user_id,
      'tenant_id', NEW.tenant_id,
      'received_at', NEW.received_at
    );

    PERFORM public.emit_event(
      'supply_chain.receipt.created',
      v_payload,
      NEW.tenant_id
    );
  END IF;

  RETURN NEW;
END;
$$;

-- =====================================================================
-- 5. Receiving RPCs: Include Vendor Code + Search
-- =====================================================================

CREATE OR REPLACE FUNCTION supply_chain.rpc_get_open_pos_for_receiving(
  p_vendor_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  po_id UUID,
  po_number TEXT,
  vendor_id UUID,
  vendor_name TEXT,
  vendor_code TEXT,
  vendor_location_id UUID,
  order_date DATE,
  expected_delivery_date DATE,
  delivery_location_id UUID,
  delivery_location_name TEXT,
  delivery_method TEXT,
  status TEXT,
  total_lines INT,
  open_lines INT,
  partially_received_lines INT,
  fully_received_lines INT,
  total_ordered_value NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT
    po.id AS po_id,
    po.po_number,
    po.vendor_id,
    COALESCE(po.vendor_name_snapshot, v.name) AS vendor_name,
    COALESCE(po.vendor_code_snapshot, v.code) AS vendor_code,
    po.vendor_location_id,
    po.order_date,
    po.expected_delivery_date,
    po.delivery_location_id,
    dl.name AS delivery_location_name,
    po.delivery_method,
    po.status,
    COUNT(pol.id)::INT AS total_lines,
    COUNT(pol.id) FILTER (WHERE pol.status = 'open')::INT AS open_lines,
    COUNT(pol.id) FILTER (WHERE pol.status = 'partially_received')::INT AS partially_received_lines,
    COUNT(pol.id) FILTER (WHERE pol.status = 'fully_received')::INT AS fully_received_lines,
    SUM(pol.qty_ordered * COALESCE(pol.unit_cost, pol.estimated_unit_cost, 0))::NUMERIC AS total_ordered_value,
    po.notes,
    po.created_at
  FROM supply_chain.purchase_orders po
  LEFT JOIN supply_chain.vendors v ON v.id = po.vendor_id
  LEFT JOIN inventory.locations dl ON dl.id = po.delivery_location_id
  LEFT JOIN supply_chain.purchase_order_lines pol ON pol.po_id = po.id AND pol.tenant_id = po.tenant_id
  WHERE po.tenant_id = v_tenant_id
    AND po.status IN ('placed', 'acknowledged', 'partially_received', 'approved')
    AND (p_vendor_id IS NULL OR po.vendor_id = p_vendor_id)
    AND (p_search IS NULL OR
         po.po_number ILIKE '%' || p_search || '%' OR
         COALESCE(po.vendor_name_snapshot, v.name) ILIKE '%' || p_search || '%' OR
         COALESCE(po.vendor_code_snapshot, v.code) ILIKE '%' || p_search || '%')
  GROUP BY
    po.id, po.po_number, po.vendor_id, po.vendor_location_id,
    po.order_date, po.expected_delivery_date, po.delivery_location_id,
    dl.name, po.delivery_method, po.status, po.notes, po.created_at,
    po.vendor_name_snapshot, po.vendor_code_snapshot, v.name, v.code
  ORDER BY
    po.expected_delivery_date ASC NULLS LAST,
    po.order_date DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION supply_chain.rpc_get_po_receiving_detail(
  p_po_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
DECLARE
  v_tenant_id UUID;
  v_result JSONB;
  v_lines JSONB;
BEGIN
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT jsonb_build_object(
    'po_id', po.id,
    'po_number', po.po_number,
    'vendor_id', po.vendor_id,
    'vendor_name', COALESCE(po.vendor_name_snapshot, v.name),
    'vendor_code', COALESCE(po.vendor_code_snapshot, v.code),
    'vendor_location_id', po.vendor_location_id,
    'status', po.status,
    'order_date', po.order_date,
    'expected_delivery_date', po.expected_delivery_date,
    'needed_by_date', po.needed_by_date,
    'delivery_location_id', po.delivery_location_id,
    'delivery_location_name', dl.name,
    'pickup_location_id', po.pickup_location_id,
    'pickup_location_name', pl.name,
    'delivery_method', po.delivery_method,
    'cost_context', po.cost_context,
    'job_id', po.job_id,
    'notes', po.notes,
    'created_at', po.created_at,
    'approved_at', po.approved_at,
    'ordered_at', po.ordered_at,
    'sent_at', po.sent_at
  )
  INTO v_result
  FROM supply_chain.purchase_orders po
  LEFT JOIN supply_chain.vendors v ON v.id = po.vendor_id
  LEFT JOIN inventory.locations dl ON dl.id = po.delivery_location_id
  LEFT JOIN inventory.locations pl ON pl.id = po.pickup_location_id
  WHERE po.id = p_po_id
    AND po.tenant_id = v_tenant_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'PO % not found', p_po_id;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'line_id', pol.id,
      'line_number', pol.line_number,
      'catalog_item_id', pol.catalog_item_id,
      'item_name', ci.name,
      'item_sku', ci.sku,
      'item_description', COALESCE(pol.item_description, ci.description),
      'item_vendor_sku', pol.item_vendor_sku,
      'qty_ordered', pol.qty_ordered,
      'qty_received', pol.qty_received,
      'qty_remaining', (pol.qty_ordered - pol.qty_received),
      'unit_of_measure', COALESCE(pol.unit_of_measure, ci.unit_of_measure),
      'unit_cost', pol.unit_cost,
      'estimated_unit_cost', pol.estimated_unit_cost,
      'price_basis', pol.price_basis,
      'is_approximate_qty', pol.is_approximate_qty,
      'allow_over_delivery', pol.allow_over_delivery,
      'status', pol.status,
      'notes', pol.notes,
      'line_notes', pol.line_notes
    )
    ORDER BY pol.line_number
  )
  INTO v_lines
  FROM supply_chain.purchase_order_lines pol
  LEFT JOIN inventory.catalog_items ci ON ci.id = pol.catalog_item_id
  WHERE pol.po_id = p_po_id
    AND pol.tenant_id = v_tenant_id;

  v_result := v_result || jsonb_build_object('lines', COALESCE(v_lines, '[]'::jsonb));

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_get_open_pos_for_receiving(UUID, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION supply_chain.rpc_get_po_receiving_detail(UUID) TO authenticated;

-- =====================================================================
-- 6. Purchase Order Creation Event Payload (Vendor Code)
-- =====================================================================

CREATE OR REPLACE FUNCTION supply_chain.rpc_create_purchase_order(
    p_vendor_id UUID,
    p_po_number TEXT,
    p_delivery_method TEXT DEFAULT 'ship',
    p_needed_by_date DATE DEFAULT NULL,
    p_cost_context TEXT DEFAULT 'yard',
    p_job_id UUID DEFAULT NULL,
    p_delivery_location_id UUID DEFAULT NULL,
    p_pickup_location_id UUID DEFAULT NULL,
    p_max_authorized_spend NUMERIC DEFAULT NULL,
    p_vendor_quote_ref TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_attachments JSONB DEFAULT '[]'::jsonb,
    p_lines JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO supply_chain, inventory, public
AS $$
DECLARE
    v_tenant_id UUID;
    v_user_id UUID;
    v_po_id UUID;
    v_line JSONB;
    v_line_number INT := 0;
    v_total_estimated_cost NUMERIC := 0;
    v_has_unknown_pricing BOOLEAN := false;
    v_event_id UUID;
    v_vendor_name TEXT;
    v_vendor_code TEXT;
    v_result JSONB;
BEGIN
    v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
    v_user_id := (auth.jwt() ->> 'user_id')::UUID;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required - no tenant_id in JWT';
    END IF;

    IF p_delivery_method = 'ship' AND p_delivery_location_id IS NULL THEN
        RAISE EXCEPTION 'delivery_location_id required when delivery_method = ship';
    END IF;

    IF p_delivery_method = 'pickup' AND p_pickup_location_id IS NULL THEN
        RAISE EXCEPTION 'pickup_location_id required when delivery_method = pickup';
    END IF;

    IF p_cost_context = 'job' AND p_job_id IS NULL THEN
        RAISE EXCEPTION 'job_id required when cost_context = job';
    END IF;

    SELECT name, code INTO v_vendor_name, v_vendor_code
    FROM supply_chain.vendors
    WHERE id = p_vendor_id AND tenant_id = v_tenant_id;

    v_event_id := gen_random_uuid();

    INSERT INTO supply_chain.purchase_orders (
        tenant_id,
        po_number,
        vendor_id,
        vendor_name_snapshot,
        vendor_code_snapshot,
        delivery_method,
        needed_by_date,
        cost_context,
        job_id,
        delivery_location_id,
        pickup_location_id,
        max_authorized_spend,
        vendor_quote_ref,
        notes,
        attachments,
        order_date,
        status,
        created_by_user_id,
        last_event_id
    ) VALUES (
        v_tenant_id,
        p_po_number,
        p_vendor_id,
        v_vendor_name,
        v_vendor_code,
        p_delivery_method,
        p_needed_by_date,
        p_cost_context,
        p_job_id,
        p_delivery_location_id,
        p_pickup_location_id,
        p_max_authorized_spend,
        p_vendor_quote_ref,
        p_notes,
        p_attachments,
        CURRENT_DATE,
        'draft',
        v_user_id,
        v_event_id::text
    )
    RETURNING id INTO v_po_id;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_line_number := v_line_number + 1;

        IF (v_line->>'unit_cost') IS NULL AND (v_line->>'estimated_unit_cost') IS NULL THEN
            v_has_unknown_pricing := true;
        END IF;

        IF (v_line->>'unit_cost') IS NOT NULL THEN
            v_total_estimated_cost := v_total_estimated_cost +
                ((v_line->>'qty_ordered')::NUMERIC * (v_line->>'unit_cost')::NUMERIC);
        ELSIF (v_line->>'estimated_unit_cost') IS NOT NULL THEN
            v_total_estimated_cost := v_total_estimated_cost +
                ((v_line->>'qty_ordered')::NUMERIC * (v_line->>'estimated_unit_cost')::NUMERIC);
        END IF;

        INSERT INTO supply_chain.purchase_order_lines (
            tenant_id,
            po_id,
            line_number,
            catalog_item_id,
            item_description,
            item_vendor_sku,
            unit_of_measure,
            qty_ordered,
            is_approximate_qty,
            unit_cost,
            estimated_unit_cost,
            price_basis,
            line_notes,
            status,
            created_by,
            last_event_id
        ) VALUES (
            v_tenant_id,
            v_po_id,
            v_line_number,
            (v_line->>'catalog_item_id')::UUID,
            v_line->>'item_description',
            v_line->>'item_vendor_sku',
            v_line->>'unit_of_measure',
            (v_line->>'qty_ordered')::NUMERIC,
            COALESCE((v_line->>'is_approximate_qty')::BOOLEAN, false),
            (v_line->>'unit_cost')::NUMERIC,
            (v_line->>'estimated_unit_cost')::NUMERIC,
            COALESCE(v_line->>'price_basis', 'fixed'),
            v_line->>'line_notes',
            'open',
            v_user_id,
            v_event_id::text
        );
    END LOOP;

    IF v_has_unknown_pricing AND p_max_authorized_spend IS NULL THEN
        RAISE EXCEPTION 'max_authorized_spend required when line items have unknown pricing';
    END IF;

    PERFORM inventory.publish_event(
        p_tenant_id := v_tenant_id,
        p_scope := 'supply_chain',
        p_event_name := 'purchase_order.created',
        p_aggregate_type := 'purchase_order',
        p_aggregate_id := v_po_id,
        p_payload := jsonb_build_object(
            'po_id', v_po_id,
            'po_number', p_po_number,
            'vendor_id', p_vendor_id,
            'vendor_name', v_vendor_name,
            'vendor_code', v_vendor_code,
            'delivery_method', p_delivery_method,
            'cost_context', p_cost_context,
            'line_count', v_line_number,
            'estimated_total_cost', v_total_estimated_cost,
            'has_unknown_pricing', v_has_unknown_pricing
        ),
        p_event_version := 1,
        p_metadata := jsonb_build_object(
            'created_by', v_user_id,
            'source', 'rpc_create_purchase_order'
        )
    );

    v_result := jsonb_build_object(
        'success', true,
        'po_id', v_po_id,
        'po_number', p_po_number,
        'line_count', v_line_number,
        'status', 'draft',
        'estimated_total_cost', v_total_estimated_cost,
        'has_unknown_pricing', v_has_unknown_pricing,
        'event_id', v_event_id
    );

    RETURN v_result;
END;
$$;

  GRANT EXECUTE ON FUNCTION supply_chain.rpc_create_purchase_order(UUID, TEXT, TEXT, DATE, TEXT, UUID, UUID, UUID, NUMERIC, TEXT, TEXT, JSONB, JSONB) TO authenticated;
