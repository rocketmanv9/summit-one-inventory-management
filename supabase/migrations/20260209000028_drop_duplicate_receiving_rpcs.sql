-- Drop all duplicate/overloaded versions of receiving RPCs to fix "Could not choose the best candidate function" errors
-- Keep only the versions with JWT extraction (no p_tenant_id parameter)

-- =====================================================================
-- 1. Drop all versions of rpc_get_open_pos_for_receiving
-- =====================================================================

DROP FUNCTION IF EXISTS supply_chain.rpc_get_open_pos_for_receiving(UUID, UUID, TEXT, INT);
DROP FUNCTION IF EXISTS supply_chain.rpc_get_open_pos_for_receiving(UUID, TEXT, INT);

-- Recreate the correct version (with JWT extraction, no p_tenant_id)
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
  -- Support both JWT tenant_id paths (app_metadata or root)
  v_tenant_id := COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID,
    (auth.jwt() ->> 'tenant_id')::UUID
  );

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

GRANT EXECUTE ON FUNCTION supply_chain.rpc_get_open_pos_for_receiving TO authenticated;

-- =====================================================================
-- 2. Drop all versions of rpc_get_po_receiving_detail
-- =====================================================================

DROP FUNCTION IF EXISTS supply_chain.rpc_get_po_receiving_detail(UUID, UUID);
DROP FUNCTION IF EXISTS supply_chain.rpc_get_po_receiving_detail(UUID);

-- Recreate the correct version (with JWT extraction, no p_tenant_id)
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
  -- Support both JWT tenant_id paths (app_metadata or root)
  v_tenant_id := COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID,
    (auth.jwt() ->> 'tenant_id')::UUID
  );

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
    'delivery_location_id', po.delivery_location_id,
    'delivery_method', po.delivery_method,
    'notes', po.notes
  ) INTO v_result
  FROM supply_chain.purchase_orders po
  LEFT JOIN supply_chain.vendors v ON v.id = po.vendor_id AND v.tenant_id = po.tenant_id
  WHERE po.id = p_po_id
    AND po.tenant_id = v_tenant_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'PO not found or access denied';
  END IF;

  -- Get lines with receiving details
  SELECT jsonb_agg(
    jsonb_build_object(
      'line_id', pol.id,
      'catalog_item_id', pol.catalog_item_id,
      'item_name', COALESCE(ci.name, pol.item_description),
      'item_description', pol.item_description,
      'unit_of_measure', pol.unit_of_measure,
      'qty_ordered', pol.qty_ordered,
      'qty_received', COALESCE(
        (
          SELECT SUM(rl.qty_received)
          FROM supply_chain.receipt_lines rl
          JOIN supply_chain.receipts r ON r.id = rl.receipt_id
          WHERE rl.po_line_id = pol.id
            AND r.status = 'confirmed'
            AND rl.tenant_id = v_tenant_id
        ),
        0
      ),
      'qty_remaining', pol.qty_ordered - COALESCE(
        (
          SELECT SUM(rl.qty_received)
          FROM supply_chain.receipt_lines rl
          JOIN supply_chain.receipts r ON r.id = rl.receipt_id
          WHERE rl.po_line_id = pol.id
            AND r.status = 'confirmed'
            AND rl.tenant_id = v_tenant_id
        ),
        0
      ),
      'unit_cost', pol.unit_cost,
      'estimated_unit_cost', pol.estimated_unit_cost,
      'line_notes', pol.line_notes
    )
    ORDER BY pol.created_at
  ) INTO v_lines
  FROM supply_chain.purchase_order_lines pol
  LEFT JOIN inventory.catalog_items ci ON ci.id = pol.catalog_item_id AND ci.tenant_id = pol.tenant_id
  WHERE pol.po_id = p_po_id
    AND pol.tenant_id = v_tenant_id;

  v_result := v_result || jsonb_build_object('lines', COALESCE(v_lines, '[]'::jsonb));

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_get_po_receiving_detail TO authenticated;
