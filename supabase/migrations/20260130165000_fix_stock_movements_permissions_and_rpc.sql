-- =====================================================================
-- Fix stock_movements permissions and RPC parameters
-- Date: 2026-01-30
-- Description: 
--   1. Grant SELECT on stock_movements to authenticated role
--   2. Fix rpc_get_open_pos_for_receiving to accept p_tenant_id (unused but for API compatibility)
-- =====================================================================

-- =====================================================================
-- 1. Grant SELECT permission on stock_movements table
-- =====================================================================
GRANT SELECT ON inventory.stock_movements TO authenticated;

-- =====================================================================
-- 2. Fix rpc_get_open_pos_for_receiving to accept p_tenant_id parameter
-- This parameter is not used (tenant comes from JWT) but API expects it
-- =====================================================================
DROP FUNCTION IF EXISTS supply_chain.rpc_get_open_pos_for_receiving(
  p_vendor_id UUID,
  p_search TEXT,
  p_limit INT
);

CREATE OR REPLACE FUNCTION supply_chain.rpc_get_open_pos_for_receiving(
  p_tenant_id UUID DEFAULT NULL,
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
  -- Get tenant from JWT (p_tenant_id parameter is ignored)
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
  Can filter by vendor_id and search by PO number or vendor name.
  p_tenant_id parameter is accepted for API compatibility but unused (tenant from JWT).';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_get_open_pos_for_receiving TO authenticated;
