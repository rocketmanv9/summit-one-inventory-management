-- 20260826100000_receipt_shipment_ref
--
-- Ship-notice tracking → receiving link (sprint 2026-08-26 item 04).
--
-- Amazon cXML ship-notices land as entries in punchout_orders.metadata.shipments[]
-- (carrier + tracking number), but until now a posted receipt had no way to say
-- WHICH shipment it came from — tracking was stranded in metadata with no link to
-- the receiving path (named gap in docs/amazon-api-procurement-spike-2026-08-17.md).
--
-- Additive changes only:
--   1. supply_chain.receipts.shipment_ref — nullable text carrying the ASN
--      shipment reference (shipmentID, falling back to the tracking number) the
--      receiver attributed the receipt to. Kept separate from packing_slip_no so
--      a real vendor packing-slip number never collides with carrier tracking.
--   2. supply_chain.rpc_create_receipt_v2 gains a trailing optional
--      p_shipment_ref parameter (default NULL) that stamps the new column.
--      Body is otherwise identical to 20260612000005_fix_receipt_posting.sql.
--
-- Receiving stays a human action: nothing here posts receipts automatically.

-- ── 1. receipts.shipment_ref ────────────────────────────────────────────────

ALTER TABLE supply_chain.receipts
  ADD COLUMN IF NOT EXISTS shipment_ref text;

COMMENT ON COLUMN supply_chain.receipts.shipment_ref IS
  'Carrier shipment (ASN) this receipt was attributed to: the ship-notice shipmentID, falling back to the tracking number. NULL when the receipt was not matched to a shipment.';

-- ── 2. rpc_create_receipt_v2 + p_shipment_ref ──────────────────────────────
-- Adding a defaulted parameter changes the signature, so drop the old overload
-- first (CREATE OR REPLACE would otherwise leave two ambiguous overloads).

DROP FUNCTION IF EXISTS supply_chain.rpc_create_receipt_v2(
  text, uuid, jsonb, uuid, uuid, timestamp with time zone,
  text, text, text, text, text, boolean
);

CREATE OR REPLACE FUNCTION supply_chain.rpc_create_receipt_v2(
  p_receipt_number text DEFAULT NULL::text,
  p_location_id uuid DEFAULT NULL::uuid,
  p_lines jsonb DEFAULT NULL::jsonb,
  p_po_id uuid DEFAULT NULL::uuid,
  p_vendor_id uuid DEFAULT NULL::uuid,
  p_received_at timestamp with time zone DEFAULT now(),
  p_notes text DEFAULT NULL::text,
  p_packing_slip_no text DEFAULT NULL::text,
  p_vendor_invoice_no text DEFAULT NULL::text,
  p_source_type text DEFAULT 'delivery'::text,
  p_status text DEFAULT 'confirmed'::text,
  p_auto_post boolean DEFAULT true,
  p_shipment_ref text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'supply_chain', 'inventory', 'public'
AS $function$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
  v_receipt_id UUID;
  v_receipt_number TEXT;
  v_line JSONB;
  v_line_number INT := 0;
  v_post_result JSONB;
  v_event_id TEXT;
  v_next_seq INT;
BEGIN
  v_tenant_id := COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID,
    (auth.jwt() ->> 'tenant_id')::UUID
  );

  v_user_id := COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'user_id')::UUID,
    (auth.jwt() ->> 'user_id')::UUID,
    (auth.jwt() ->> 'sub')::UUID
  );

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required - no tenant_id in JWT';
  END IF;

  IF p_location_id IS NULL THEN
    RAISE EXCEPTION 'location_id is required';
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required';
  END IF;

  IF p_receipt_number IS NULL OR p_receipt_number = '' THEN
    SELECT COALESCE(MAX(CAST(SUBSTRING(receipt_number FROM '[0-9]+$') AS INTEGER)), 0) + 1
    INTO v_next_seq
    FROM supply_chain.receipts
    WHERE tenant_id = v_tenant_id
      AND receipt_number ~ '^RCV-[0-9]+$';

    v_receipt_number := 'RCV-' || LPAD(v_next_seq::TEXT, 6, '0');
  ELSE
    v_receipt_number := p_receipt_number;
  END IF;

  IF p_status NOT IN ('draft', 'confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid status: %. Must be draft, confirmed, or cancelled.', p_status;
  END IF;

  IF p_source_type NOT IN ('delivery', 'pickup', 'transfer', 'return') THEN
    RAISE EXCEPTION 'Invalid source_type: %. Must be delivery, pickup, transfer, or return.', p_source_type;
  END IF;

  v_event_id := 'receipt-create-' || v_receipt_number || '-' || extract(epoch from now())::TEXT;

  INSERT INTO supply_chain.receipts (
    tenant_id, receipt_number, location_id, po_id, vendor_id, received_at,
    notes, packing_slip_no, vendor_invoice_no, source_type, status,
    received_by_user_id, last_event_id, shipment_ref
  ) VALUES (
    v_tenant_id, v_receipt_number, p_location_id, p_po_id, p_vendor_id,
    COALESCE(p_received_at, now()), p_notes, p_packing_slip_no,
    p_vendor_invoice_no, p_source_type, p_status, v_user_id, v_event_id,
    NULLIF(p_shipment_ref, '')
  )
  ON CONFLICT (tenant_id, last_event_id) DO NOTHING
  RETURNING id INTO v_receipt_id;

  IF v_receipt_id IS NULL THEN
    SELECT id INTO v_receipt_id
    FROM supply_chain.receipts
    WHERE tenant_id = v_tenant_id AND last_event_id = v_event_id;

    RETURN jsonb_build_object(
      'success', true,
      'receipt_id', v_receipt_id,
      'receipt_number', v_receipt_number,
      'message', 'Receipt already exists (idempotent)',
      'posted_to_inventory', false
    );
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_number := v_line_number + 1;
    v_event_id := 'receipt-' || v_receipt_id::TEXT || '-line-' || v_line_number::TEXT || '-' || extract(epoch from now())::TEXT;

    INSERT INTO supply_chain.receipt_lines (
      tenant_id, receipt_id, line_number, catalog_item_id, qty_received,
      po_line_id, condition_status, destination_location_id,
      unit_cost_actual, uom, notes, last_event_id
    ) VALUES (
      v_tenant_id, v_receipt_id, v_line_number,
      (v_line->>'catalog_item_id')::UUID,
      (v_line->>'qty_received')::NUMERIC,
      (v_line->>'po_line_id')::UUID,
      COALESCE(v_line->>'condition_status', 'accepted'),
      (v_line->>'destination_location_id')::UUID,
      (v_line->>'unit_cost_actual')::NUMERIC,
      v_line->>'uom',
      v_line->>'notes',
      v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
  END LOOP;

  -- Auto-post through the guardrailed v2 poster. A failure here must fail the
  -- whole call (rolling back the receipt) — a confirmed receipt that silently
  -- never hit inventory is exactly the bug this migration removes.
  IF p_auto_post AND p_status = 'confirmed' THEN
    v_post_result := supply_chain.rpc_post_receipt_to_inventory_v2(v_receipt_id, v_user_id);
    IF COALESCE((v_post_result->>'success')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION '%', COALESCE(
        v_post_result -> 'error' ->> 'message',
        'Failed to post receipt to inventory'
      )
      USING DETAIL = COALESCE(v_post_result -> 'error' ->> 'code', 'POST_FAILED');
    END IF;
  ELSE
    v_post_result := jsonb_build_object('success', false, 'message', 'Auto-post not requested or status is not confirmed');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'lines_created', v_line_number,
    'auto_post_result', v_post_result
  );
END;
$function$;

ALTER FUNCTION supply_chain.rpc_create_receipt_v2(
  text, uuid, jsonb, uuid, uuid, timestamp with time zone,
  text, text, text, text, text, boolean, text
) OWNER TO postgres;

COMMENT ON FUNCTION supply_chain.rpc_create_receipt_v2(
  text, uuid, jsonb, uuid, uuid, timestamp with time zone,
  text, text, text, text, text, boolean, text
) IS 'Enhanced receipt creation with support for status, vendor_id, condition tracking, and shipment (ASN) attribution via p_shipment_ref.';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_create_receipt_v2(
  text, uuid, jsonb, uuid, uuid, timestamp with time zone,
  text, text, text, text, text, boolean, text
) TO authenticated, service_role, authenticator;
