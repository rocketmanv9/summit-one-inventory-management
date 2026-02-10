-- Fix receipts and receipt_lines RLS policies to support both JWT paths + service role bypass
-- Also fix rpc_get_recent_receipts to extract tenant_id from JWT

-- =====================================================================
-- 1. Fix RLS policies on receipts table
-- =====================================================================

DROP POLICY IF EXISTS "tenant_isolation" ON supply_chain.receipts;

CREATE POLICY "receipts_tenant_rls" ON supply_chain.receipts
  FOR ALL
  USING (
    -- Allow service_role to bypass RLS
    current_role = 'service_role'::text
    OR
    -- Support multiple tenant_id sources in order of precedence
    tenant_id = COALESCE(
      -- Runtime settings (for triggers and functions)
      NULLIF(current_setting('app.current_tenant_id', true), '')::uuid,
      NULLIF(current_setting('app.tenant_id', true), '')::uuid,
      -- JWT claims (both paths)
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    current_role = 'service_role'::text
    OR
    tenant_id = COALESCE(
      NULLIF(current_setting('app.current_tenant_id', true), '')::uuid,
      NULLIF(current_setting('app.tenant_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

-- =====================================================================
-- 2. Fix RLS policies on receipt_lines table
-- =====================================================================

DROP POLICY IF EXISTS "tenant_isolation" ON supply_chain.receipt_lines;

CREATE POLICY "receipt_lines_tenant_rls" ON supply_chain.receipt_lines
  FOR ALL
  USING (
    current_role = 'service_role'::text
    OR
    tenant_id = COALESCE(
      NULLIF(current_setting('app.current_tenant_id', true), '')::uuid,
      NULLIF(current_setting('app.tenant_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    current_role = 'service_role'::text
    OR
    tenant_id = COALESCE(
      NULLIF(current_setting('app.current_tenant_id', true), '')::uuid,
      NULLIF(current_setting('app.tenant_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

-- =====================================================================
-- 3. Fix rpc_get_recent_receipts to extract tenant_id from JWT
-- =====================================================================

-- Drop the old version that requires p_tenant_id parameter
DROP FUNCTION IF EXISTS supply_chain.rpc_get_recent_receipts(UUID, INTEGER);
DROP FUNCTION IF EXISTS supply_chain.rpc_get_recent_receipts(INTEGER);

CREATE OR REPLACE FUNCTION supply_chain.rpc_get_recent_receipts(
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  receipt_id UUID,
  receipt_number TEXT,
  po_id UUID,
  po_number TEXT,
  vendor_id UUID,
  vendor_name TEXT,
  vendor_code TEXT,
  location_id UUID,
  location_name TEXT,
  status TEXT,
  total_qty NUMERIC,
  received_at TIMESTAMPTZ,
  received_by_user_id UUID,
  packing_slip_no TEXT,
  notes TEXT
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
    r.id as receipt_id,
    r.receipt_number,
    r.po_id,
    po.po_number,
    r.vendor_id,
    COALESCE(r.vendor_name_snapshot, v.name) as vendor_name,
    COALESCE(r.vendor_code_snapshot, v.code) as vendor_code,
    r.location_id,
    l.name as location_name,
    r.status,
    COALESCE(SUM(rl.qty_received), 0) as total_qty,
    r.received_at,
    r.received_by_user_id,
    r.packing_slip_no,
    r.notes
  FROM supply_chain.receipts r
  LEFT JOIN supply_chain.purchase_orders po ON r.po_id = po.id AND po.tenant_id = v_tenant_id
  LEFT JOIN supply_chain.vendors v ON r.vendor_id = v.id AND v.tenant_id = v_tenant_id
  LEFT JOIN inventory.locations l ON r.location_id = l.id AND l.tenant_id = v_tenant_id
  LEFT JOIN supply_chain.receipt_lines rl ON rl.receipt_id = r.id AND rl.tenant_id = v_tenant_id
  WHERE r.tenant_id = v_tenant_id
    AND r.status = 'confirmed'
    AND r.received_at >= NOW() - (p_days || ' days')::INTERVAL
  GROUP BY 
    r.id, r.receipt_number, r.po_id, po.po_number, r.vendor_id,
    r.vendor_name_snapshot, r.vendor_code_snapshot, v.name, v.code,
    r.location_id, l.name, r.status, r.received_at, r.received_by_user_id,
    r.packing_slip_no, r.notes
  ORDER BY r.received_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_get_recent_receipts TO authenticated;

