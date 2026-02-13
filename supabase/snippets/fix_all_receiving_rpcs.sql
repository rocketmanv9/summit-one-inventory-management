-- =====================================================================
-- Fix All Receiving RPCs to Use Explicit Tenant/User Parameters
-- Instead of auth.jwt() which fails with service role
-- Date: 2026-01-28
-- =====================================================================

-- 1. rpc_create_receipt_draft - New simple RPC for creating draft receipts
-- =====================================================================
CREATE OR REPLACE FUNCTION supply_chain.rpc_create_receipt_draft(
  p_tenant_id UUID,
  p_user_id UUID,
  p_po_id UUID,
  p_location_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
DECLARE
  v_receipt_id UUID;
  v_receipt_number TEXT;
  v_vendor_id UUID;
  v_delivery_location_id UUID;
  v_event_id TEXT;
BEGIN
  -- Validate inputs
  IF p_tenant_id IS NULL OR p_user_id IS NULL OR p_po_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id, user_id, and po_id are required';
  END IF;
  
  -- Get PO details
  SELECT po.vendor_id, po.delivery_location_id
  INTO v_vendor_id, v_delivery_location_id
  FROM supply_chain.purchase_orders po
  WHERE po.id = p_po_id AND po.tenant_id = p_tenant_id;
  
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  
  -- Check for existing draft receipt for this PO
  SELECT id, receipt_number INTO v_receipt_id, v_receipt_number
  FROM supply_chain.receipts
  WHERE tenant_id = p_tenant_id 
    AND po_id = p_po_id 
    AND status = 'draft'
  LIMIT 1;
  
  -- If draft exists, return it (idempotent)
  IF v_receipt_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'receipt_id', v_receipt_id,
      'receipt_number', v_receipt_number,
      'is_new', false,
      'message', 'Using existing draft receipt'
    );
  END IF;
  
  -- Generate receipt number
  v_receipt_number := 'RCP-' || upper(substring(md5(random()::text) from 1 for 10));
  v_event_id := 'receipt-draft-' || p_po_id::TEXT || '-' || extract(epoch from now())::TEXT;
  
  -- Create new draft receipt
  INSERT INTO supply_chain.receipts (
    tenant_id,
    po_id,
    vendor_id,
    receipt_number,
    location_id,
    status,
    received_by_user_id,
    created_by,
    last_event_id,
    source_type
  ) VALUES (
    p_tenant_id,
    p_po_id,
    v_vendor_id,
    v_receipt_number,
    COALESCE(p_location_id, v_delivery_location_id),
    'draft',
    p_user_id,
    p_user_id,
    v_event_id,
    'delivery'
  )
  ON CONFLICT (tenant_id, last_event_id) DO NOTHING
  RETURNING id, receipt_number INTO v_receipt_id, v_receipt_number;
  
  -- Handle idempotent duplicate
  IF v_receipt_id IS NULL THEN
    SELECT id, receipt_number INTO v_receipt_id, v_receipt_number
    FROM supply_chain.receipts
    WHERE tenant_id = p_tenant_id AND last_event_id = v_event_id;
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'is_new', true,
    'vendor_id', v_vendor_id
  );
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_create_receipt_draft IS 
'Create or retrieve existing draft receipt for a PO. Idempotent.';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_create_receipt_draft TO authenticated, service_role;

-- 2. Fix rpc_get_po_receiving_detail
-- =====================================================================
DROP FUNCTION IF EXISTS supply_chain.rpc_get_po_receiving_detail CASCADE;

CREATE OR REPLACE FUNCTION supply_chain.rpc_get_po_receiving_detail(
  p_tenant_id UUID,
  p_po_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_tenant_id IS NULL OR p_po_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id and po_id are required';
  END IF;
  
  WITH po_header AS (
    SELECT
      po.id,
      po.po_number,
      po.vendor_id,
      v.name AS vendor_name,
      po.status,
      po.order_date,
      po.expected_delivery_date,
      po.delivery_location_id,
      loc.name AS delivery_location_name,
      po.notes
    FROM supply_chain.purchase_orders po
    LEFT JOIN supply_chain.vendors v ON v.id = po.vendor_id
    LEFT JOIN inventory.locations loc ON loc.id = po.delivery_location_id
    WHERE po.id = p_po_id AND po.tenant_id = p_tenant_id
  ),
  po_lines AS (
    SELECT
      pol.id AS line_id,
      pol.line_number,
      pol.catalog_item_id,
      ci.sku,
      ci.name AS item_name,
      ci.inventory_type,
      pol.qty_ordered,
      pol.qty_received,
      pol.qty_invoiced,
      (pol.qty_ordered - COALESCE(pol.qty_received, 0)) AS qty_remaining,
      pol.unit_cost,
      pol.estimated_unit_cost,
      pol.uom,
      pol.status,
      pol.notes
    FROM supply_chain.purchase_order_lines pol
    LEFT JOIN inventory.catalog_items ci ON ci.id = pol.catalog_item_id
    WHERE pol.po_id = p_po_id AND pol.tenant_id = p_tenant_id
    ORDER BY pol.line_number
  )
  SELECT jsonb_build_object(
    'po', (SELECT row_to_json(po_header.*) FROM po_header),
    'lines', COALESCE((SELECT jsonb_agg(row_to_json(po_lines.*)) FROM po_lines), '[]'::jsonb)
  ) INTO v_result;
  
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_get_po_receiving_detail IS 
'Get detailed PO information for receiving workflow';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_get_po_receiving_detail TO authenticated, service_role;

-- 3. Fix rpc_get_po_receipt_history
-- =====================================================================
DROP FUNCTION IF EXISTS supply_chain.rpc_get_po_receipt_history CASCADE;

CREATE OR REPLACE FUNCTION supply_chain.rpc_get_po_receipt_history(
  p_tenant_id UUID,
  p_po_id UUID
)
RETURNS TABLE (
  receipt_id UUID,
  receipt_number TEXT,
  status TEXT,
  received_at TIMESTAMPTZ,
  received_by_user_id UUID,
  location_id UUID,
  location_name TEXT,
  total_lines INT,
  total_qty_received NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
BEGIN
  IF p_tenant_id IS NULL OR p_po_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id and po_id are required';
  END IF;
  
  RETURN QUERY
  SELECT
    r.id AS receipt_id,
    r.receipt_number,
    r.status,
    r.received_at,
    r.received_by_user_id,
    r.location_id,
    loc.name AS location_name,
    COUNT(rl.id)::INT AS total_lines,
    SUM(rl.qty_received)::NUMERIC AS total_qty_received,
    r.notes,
    r.created_at
  FROM supply_chain.receipts r
  LEFT JOIN inventory.locations loc ON loc.id = r.location_id
  LEFT JOIN supply_chain.receipt_lines rl ON rl.receipt_id = r.id AND rl.tenant_id = r.tenant_id
  WHERE r.tenant_id = p_tenant_id
    AND r.po_id = p_po_id
    AND r.status IN ('confirmed', 'draft')
  GROUP BY r.id, r.receipt_number, r.status, r.received_at, r.received_by_user_id, r.location_id, loc.name, r.notes, r.created_at
  ORDER BY r.received_at DESC;
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_get_po_receipt_history IS 
'Get receipt history for a purchase order';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_get_po_receipt_history TO authenticated, service_role;

-- 4. Fix rpc_get_receipt_detail
-- =====================================================================
DROP FUNCTION IF EXISTS supply_chain.rpc_get_receipt_detail CASCADE;

CREATE OR REPLACE FUNCTION supply_chain.rpc_get_receipt_detail(
  p_tenant_id UUID,
  p_receipt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_tenant_id IS NULL OR p_receipt_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id and receipt_id are required';
  END IF;
  
  WITH receipt_header AS (
    SELECT
      r.id,
      r.receipt_number,
      r.status,
      r.po_id,
      po.po_number,
      r.vendor_id,
      v.name AS vendor_name,
      r.received_at,
      r.received_by_user_id,
      r.location_id,
      loc.name AS location_name,
      r.packing_slip_no,
      r.vendor_invoice_no,
      r.source_type,
      r.notes,
      r.created_at
    FROM supply_chain.receipts r
    LEFT JOIN supply_chain.purchase_orders po ON po.id = r.po_id
    LEFT JOIN supply_chain.vendors v ON v.id = r.vendor_id
    LEFT JOIN inventory.locations loc ON loc.id = r.location_id
    WHERE r.id = p_receipt_id AND r.tenant_id = p_tenant_id
  ),
  receipt_lines AS (
    SELECT
      rl.id AS line_id,
      rl.line_number,
      rl.catalog_item_id,
      ci.sku,
      ci.name AS item_name,
      rl.qty_received,
      rl.condition_status,
      rl.destination_location_id,
      dloc.name AS destination_location_name,
      rl.unit_cost_actual,
      rl.uom,
      rl.notes,
      rl.po_line_id
    FROM supply_chain.receipt_lines rl
    LEFT JOIN inventory.catalog_items ci ON ci.id = rl.catalog_item_id
    LEFT JOIN inventory.locations dloc ON dloc.id = rl.destination_location_id
    WHERE rl.receipt_id = p_receipt_id AND rl.tenant_id = p_tenant_id
    ORDER BY rl.line_number
  )
  SELECT jsonb_build_object(
    'receipt', (SELECT row_to_json(receipt_header.*) FROM receipt_header),
    'lines', COALESCE((SELECT jsonb_agg(row_to_json(receipt_lines.*)) FROM receipt_lines), '[]'::jsonb)
  ) INTO v_result;
  
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_get_receipt_detail IS 
'Get detailed receipt information including all lines';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_get_receipt_detail TO authenticated, service_role;

-- 5. Fix rpc_validate_receipt
-- =====================================================================
DROP FUNCTION IF EXISTS supply_chain.rpc_validate_receipt CASCADE;

CREATE OR REPLACE FUNCTION supply_chain.rpc_validate_receipt(
  p_tenant_id UUID,
  p_receipt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
DECLARE
  v_errors JSONB := '[]'::jsonb;
  v_warnings JSONB := '[]'::jsonb;
  v_receipt RECORD;
  v_line RECORD;
  v_po_line RECORD;
  v_over_receipt_count INT := 0;
BEGIN
  IF p_tenant_id IS NULL OR p_receipt_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id and receipt_id are required';
  END IF;
  
  -- Get receipt header
  SELECT * INTO v_receipt
  FROM supply_chain.receipts
  WHERE id = p_receipt_id AND tenant_id = p_tenant_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'valid', false,
      'errors', jsonb_build_array('Receipt not found')
    );
  END IF;
  
  -- Check if receipt already confirmed
  IF v_receipt.status = 'confirmed' THEN
    v_errors := v_errors || jsonb_build_array('Receipt already confirmed');
  END IF;
  
  -- Check if receipt has lines
  IF NOT EXISTS (
    SELECT 1 FROM supply_chain.receipt_lines
    WHERE receipt_id = p_receipt_id AND tenant_id = p_tenant_id
  ) THEN
    v_errors := v_errors || jsonb_build_array('Receipt has no lines');
  END IF;
  
  -- Validate each line
  FOR v_line IN 
    SELECT * FROM supply_chain.receipt_lines
    WHERE receipt_id = p_receipt_id AND tenant_id = p_tenant_id
  LOOP
    -- If linked to PO line, check for over-receipt
    IF v_line.po_line_id IS NOT NULL THEN
      SELECT pol.*, (pol.qty_ordered - COALESCE(pol.qty_received, 0)) AS qty_remaining
      INTO v_po_line
      FROM supply_chain.purchase_order_lines pol
      WHERE pol.id = v_line.po_line_id AND pol.tenant_id = p_tenant_id;
      
      IF FOUND AND v_line.qty_received > v_po_line.qty_remaining THEN
        v_over_receipt_count := v_over_receipt_count + 1;
        v_warnings := v_warnings || jsonb_build_array(
          'Line ' || v_line.line_number || ': Receiving ' || v_line.qty_received || 
          ' but only ' || v_po_line.qty_remaining || ' remaining on PO'
        );
      END IF;
    END IF;
  END LOOP;
  
  RETURN jsonb_build_object(
    'valid', jsonb_array_length(v_errors) = 0,
    'errors', v_errors,
    'warnings', v_warnings,
    'over_receipt_count', v_over_receipt_count
  );
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_validate_receipt IS 
'Validate a receipt before confirmation';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_validate_receipt TO authenticated, service_role;
