CREATE OR REPLACE FUNCTION supply_chain.rpc_get_recent_receipts(
    p_tenant_id UUID,
    p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
    receipt_id UUID,
    receipt_number TEXT,
    po_id UUID,
    po_number TEXT,
    vendor_name TEXT,
    location_name TEXT,
    status TEXT,
    total_qty NUMERIC,
    confirmed_at TIMESTAMPTZ,
    confirmed_by_name TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id as receipt_id,
        r.receipt_number,
        r.po_id,
        po.po_number,
        v.name as vendor_name,
        l.name as location_name,
        r.status,
        COALESCE(SUM(rl.qty_received), 0) as total_qty,
        r.updated_at as confirmed_at,
        r.updated_by::text as confirmed_by_name
    FROM supply_chain.receipts r
    JOIN supply_chain.purchase_orders po ON r.po_id = po.id
    LEFT JOIN supply_chain.vendors v ON po.vendor_id = v.id
    LEFT JOIN inventory.locations l ON r.location_id = l.id
    LEFT JOIN supply_chain.receipt_lines rl ON rl.receipt_id = r.id
    WHERE r.tenant_id = p_tenant_id
      AND r.status = 'confirmed'
      AND r.updated_at >= NOW() - (p_days || ' days')::INTERVAL
    GROUP BY r.id, r.receipt_number, r.po_id, po.po_number, v.name, l.name, r.status, r.updated_at, r.updated_by
    ORDER BY r.updated_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_get_recent_receipts TO authenticated, service_role;
