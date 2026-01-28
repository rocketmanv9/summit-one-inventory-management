-- =====================================================================
-- UI Query RPCs for Receiving Workflow
-- Date: 2026-01-28
-- Description: RPCs to support the receiving page frontend
-- =====================================================================

-- =====================================================================
-- RPC 1: Get Open POs for Receiving
-- Returns list of POs that can be received against
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
  -- Get tenant from JWT
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  RETURN QUERY
  SELECT 
    po.id AS po_id,
    po.po_number,
    po.vendor_id,
    v.name AS vendor_name,
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
         v.name ILIKE '%' || p_search || '%')
  GROUP BY 
    po.id, po.po_number, po.vendor_id, v.name, po.vendor_location_id,
    po.order_date, po.expected_delivery_date, po.delivery_location_id,
    dl.name, po.delivery_method, po.status, po.notes, po.created_at
  ORDER BY 
    po.expected_delivery_date ASC NULLS LAST,
    po.order_date DESC
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_get_open_pos_for_receiving IS 
  'Fetch open POs for receiving page. Returns POs in status: placed, acknowledged, partially_received, approved.
  Can filter by vendor_id and search by PO number or vendor name.';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_get_open_pos_for_receiving TO authenticated;

-- =====================================================================
-- RPC 2: Get PO Receiving Detail
-- Returns PO header + lines with remaining quantities
-- =====================================================================

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
  -- Get tenant from JWT
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Build PO header JSON
  SELECT jsonb_build_object(
    'po_id', po.id,
    'po_number', po.po_number,
    'vendor_id', po.vendor_id,
    'vendor_name', v.name,
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
  
  -- Build lines array with remaining quantities
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
  
  -- Combine header + lines
  v_result := v_result || jsonb_build_object('lines', COALESCE(v_lines, '[]'::jsonb));
  
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_get_po_receiving_detail IS 
  'Get detailed PO information for receiving, including line-by-line remaining quantities.
  Returns: { po_id, po_number, vendor_*, status, dates, locations, lines: [{...qty_ordered, qty_received, qty_remaining...}] }';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_get_po_receiving_detail TO authenticated;

-- =====================================================================
-- RPC 3: Get Receipt History for PO
-- Returns all receipts created for a specific PO
-- =====================================================================

CREATE OR REPLACE FUNCTION supply_chain.rpc_get_po_receipt_history(
  p_po_id UUID
)
RETURNS TABLE (
  receipt_id UUID,
  receipt_number TEXT,
  received_at TIMESTAMPTZ,
  received_by_user_id UUID,
  location_id UUID,
  location_name TEXT,
  status TEXT,
  total_lines INT,
  total_qty_received NUMERIC,
  packing_slip_no TEXT,
  vendor_invoice_no TEXT,
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
  -- Get tenant from JWT
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  RETURN QUERY
  SELECT 
    r.id AS receipt_id,
    r.receipt_number,
    r.received_at,
    r.received_by_user_id,
    r.location_id,
    l.name AS location_name,
    r.status,
    COUNT(rl.id)::INT AS total_lines,
    SUM(rl.qty_received)::NUMERIC AS total_qty_received,
    r.packing_slip_no,
    r.vendor_invoice_no,
    r.notes,
    r.created_at
  FROM supply_chain.receipts r
  LEFT JOIN inventory.locations l ON l.id = r.location_id
  LEFT JOIN supply_chain.receipt_lines rl ON rl.receipt_id = r.id AND rl.tenant_id = r.tenant_id
  WHERE r.po_id = p_po_id
    AND r.tenant_id = v_tenant_id
  GROUP BY 
    r.id, r.receipt_number, r.received_at, r.received_by_user_id,
    r.location_id, l.name, r.status, r.packing_slip_no, 
    r.vendor_invoice_no, r.notes, r.created_at
  ORDER BY r.received_at DESC, r.created_at DESC;
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_get_po_receipt_history IS 
  'Get all receipts for a specific PO, ordered by received_at DESC';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_get_po_receipt_history TO authenticated;

-- =====================================================================
-- RPC 4: Get Receipt Detail
-- Returns full receipt with lines
-- =====================================================================

CREATE OR REPLACE FUNCTION supply_chain.rpc_get_receipt_detail(
  p_receipt_id UUID
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
  -- Get tenant from JWT
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Build receipt header JSON
  SELECT jsonb_build_object(
    'receipt_id', r.id,
    'receipt_number', r.receipt_number,
    'po_id', r.po_id,
    'po_number', po.po_number,
    'vendor_id', r.vendor_id,
    'vendor_name', v.name,
    'location_id', r.location_id,
    'location_name', l.name,
    'received_at', r.received_at,
    'received_by_user_id', r.received_by_user_id,
    'status', r.status,
    'source_type', r.source_type,
    'packing_slip_no', r.packing_slip_no,
    'vendor_invoice_no', r.vendor_invoice_no,
    'notes', r.notes,
    'created_at', r.created_at,
    'created_by', r.created_by,
    'updated_at', r.updated_at
  )
  INTO v_result
  FROM supply_chain.receipts r
  LEFT JOIN supply_chain.purchase_orders po ON po.id = r.po_id
  LEFT JOIN supply_chain.vendors v ON v.id = r.vendor_id
  LEFT JOIN inventory.locations l ON l.id = r.location_id
  WHERE r.id = p_receipt_id
    AND r.tenant_id = v_tenant_id;
  
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Receipt % not found', p_receipt_id;
  END IF;
  
  -- Build lines array
  SELECT jsonb_agg(
    jsonb_build_object(
      'line_id', rl.id,
      'line_number', rl.line_number,
      'po_line_id', rl.po_line_id,
      'catalog_item_id', rl.catalog_item_id,
      'item_name', ci.name,
      'item_sku', ci.sku,
      'qty_received', rl.qty_received,
      'condition_status', rl.condition_status,
      'destination_location_id', rl.destination_location_id,
      'destination_location_name', dl.name,
      'unit_cost_actual', rl.unit_cost_actual,
      'uom', rl.uom,
      'notes', rl.notes,
      'created_at', rl.created_at
    )
    ORDER BY rl.line_number
  )
  INTO v_lines
  FROM supply_chain.receipt_lines rl
  LEFT JOIN inventory.catalog_items ci ON ci.id = rl.catalog_item_id
  LEFT JOIN inventory.locations dl ON dl.id = rl.destination_location_id
  WHERE rl.receipt_id = p_receipt_id
    AND rl.tenant_id = v_tenant_id;
  
  -- Combine header + lines
  v_result := v_result || jsonb_build_object('lines', COALESCE(v_lines, '[]'::jsonb));
  
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_get_receipt_detail IS 
  'Get full receipt details including all lines, vendor info, and location info';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_get_receipt_detail TO authenticated;

-- =====================================================================
-- RPC 5: Validate Receipt Before Posting
-- Pre-flight check to catch issues before posting
-- =====================================================================

CREATE OR REPLACE FUNCTION supply_chain.rpc_validate_receipt(
  p_receipt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
DECLARE
  v_tenant_id UUID;
  v_receipt supply_chain.receipts%ROWTYPE;
  v_errors TEXT[] := ARRAY[]::TEXT[];
  v_warnings TEXT[] := ARRAY[]::TEXT[];
  v_line_count INT;
  v_over_delivery_count INT;
BEGIN
  -- Get tenant from JWT
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Fetch receipt
  SELECT * INTO v_receipt
  FROM supply_chain.receipts
  WHERE id = p_receipt_id
    AND tenant_id = v_tenant_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'valid', false,
      'errors', jsonb_build_array('Receipt not found')
    );
  END IF;
  
  -- Check if already confirmed
  IF v_receipt.status = 'confirmed' THEN
    v_warnings := array_append(v_warnings, 'Receipt already confirmed');
  END IF;
  
  IF v_receipt.status = 'cancelled' THEN
    v_errors := array_append(v_errors, 'Cannot post cancelled receipt');
  END IF;
  
  -- Check if location exists
  IF NOT EXISTS (
    SELECT 1 FROM inventory.locations 
    WHERE id = v_receipt.location_id AND tenant_id = v_tenant_id
  ) THEN
    v_errors := array_append(v_errors, 'Receipt location not found in inventory');
  END IF;
  
  -- Check lines exist
  SELECT COUNT(*) INTO v_line_count
  FROM supply_chain.receipt_lines
  WHERE receipt_id = p_receipt_id AND tenant_id = v_tenant_id;
  
  IF v_line_count = 0 THEN
    v_errors := array_append(v_errors, 'Receipt has no lines');
  END IF;
  
  -- Check for catalog items that don't exist
  IF EXISTS (
    SELECT 1 
    FROM supply_chain.receipt_lines rl
    WHERE rl.receipt_id = p_receipt_id 
      AND rl.tenant_id = v_tenant_id
      AND NOT EXISTS (
        SELECT 1 FROM inventory.catalog_items ci 
        WHERE ci.id = rl.catalog_item_id AND ci.tenant_id = v_tenant_id
      )
  ) THEN
    v_errors := array_append(v_errors, 'One or more catalog items not found');
  END IF;
  
  -- Check for over-deliveries (warnings, not errors)
  IF v_receipt.po_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_over_delivery_count
    FROM supply_chain.receipt_lines rl
    JOIN supply_chain.purchase_order_lines pol ON pol.id = rl.po_line_id
    WHERE rl.receipt_id = p_receipt_id
      AND rl.tenant_id = v_tenant_id
      AND pol.allow_over_delivery = false
      AND (pol.qty_received + rl.qty_received) > pol.qty_ordered;
    
    IF v_over_delivery_count > 0 THEN
      v_warnings := array_append(v_warnings, 
        format('%s line(s) would exceed ordered quantity', v_over_delivery_count));
    END IF;
  END IF;
  
  -- Return validation result
  RETURN jsonb_build_object(
    'valid', array_length(v_errors, 1) IS NULL,
    'errors', to_jsonb(v_errors),
    'warnings', to_jsonb(v_warnings),
    'receipt_id', p_receipt_id,
    'status', v_receipt.status,
    'line_count', v_line_count
  );
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_validate_receipt IS 
  'Validates receipt before posting. Returns {valid, errors[], warnings[]}';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_validate_receipt TO authenticated;

-- =====================================================================
-- END OF QUERY RPCs
-- =====================================================================
