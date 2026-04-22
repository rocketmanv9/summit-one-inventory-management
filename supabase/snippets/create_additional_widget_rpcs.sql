-- Additional Widget RPCs

-- 7. Pending Approvals (POs needing approval)
CREATE OR REPLACE FUNCTION inventory.rpc_widget_pending_approvals(
    p_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, supply_chain, public
AS $$
DECLARE
    v_count INTEGER;
    v_approvals JSONB;
BEGIN
    SELECT 
        COUNT(*),
        jsonb_agg(
            jsonb_build_object(
                'po_number', po.po_number,
                'vendor', v.name,
                'status', po.status,
                'order_date', po.order_date,
                'total_value', (
                    SELECT SUM(pol.qty_ordered * pol.unit_cost)
                    FROM supply_chain.purchase_order_lines pol
                    WHERE pol.po_id = po.id
                ),
                'age_days', EXTRACT(DAY FROM NOW() - po.created_at)
            ) ORDER BY po.created_at ASC
        ) FILTER (WHERE po.po_number IS NOT NULL)
    INTO v_count, v_approvals
    FROM supply_chain.purchase_orders po
    LEFT JOIN supply_chain.vendors v ON po.vendor_id = v.id
    WHERE po.tenant_id = p_tenant_id
      AND po.status IN ('draft', 'pending');

    RETURN jsonb_build_object(
        'count', COALESCE(v_count, 0),
        'approvals', COALESCE(v_approvals, '[]'::jsonb)
    );
END;
$$;

-- 8. Overdue Reservations
CREATE OR REPLACE FUNCTION inventory.rpc_widget_overdue_reservations(
    p_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, supply_chain, public
AS $$
DECLARE
    v_count INTEGER;
    v_overdue JSONB;
BEGIN
    SELECT 
        COUNT(*),
        jsonb_agg(
            jsonb_build_object(
                'item_name', ci.name,
                'qty', r.qty,
                'location', l.name,
                'needed_by', r.needed_by,
                'status', r.status,
                'days_overdue', EXTRACT(DAY FROM NOW() - r.needed_by),
                'reservation_type', r.reservation_type
            ) ORDER BY r.needed_by ASC
        ) FILTER (WHERE ci.name IS NOT NULL)
    INTO v_count, v_overdue
    FROM inventory.reservations r
    JOIN inventory.catalog_items ci ON r.catalog_item_id = ci.id
    LEFT JOIN inventory.locations l ON r.location_id = l.id
    WHERE r.tenant_id = p_tenant_id
      AND r.status = 'active'
      AND r.needed_by < NOW();

    RETURN jsonb_build_object(
        'count', COALESCE(v_count, 0),
        'overdue', COALESCE(v_overdue, '[]'::jsonb)
    );
END;
$$;

-- 9. Top Received Items (since we don't have consumption events yet)
CREATE OR REPLACE FUNCTION inventory.rpc_widget_top_received_items(
    p_tenant_id UUID,
    p_days INTEGER DEFAULT 30,
    p_limit INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, supply_chain, public
AS $$
DECLARE
    v_items JSONB;
BEGIN
    WITH top_items AS (
        SELECT 
            ci.name,
            ci.sku,
            SUM(rl.qty_received) as total_qty,
            COUNT(DISTINCT rl.receipt_id) as receipt_count,
            SUM(rl.qty_received * COALESCE(rl.unit_cost_actual, 0)) as total_value
        FROM supply_chain.receipt_lines rl
        JOIN inventory.catalog_items ci ON rl.catalog_item_id = ci.id
        JOIN supply_chain.receipts r ON rl.receipt_id = r.id
        WHERE rl.tenant_id = p_tenant_id
          AND r.status = 'confirmed'
          AND r.created_at >= NOW() - (p_days || ' days')::INTERVAL
        GROUP BY ci.id, ci.name, ci.sku
        ORDER BY SUM(rl.qty_received) DESC
        LIMIT p_limit
    )
    SELECT 
        jsonb_agg(
            jsonb_build_object(
                'item_name', name,
                'sku', sku,
                'total_qty', total_qty,
                'receipt_count', receipt_count,
                'total_value', total_value
            ) ORDER BY total_qty DESC
        )
    INTO v_items
    FROM top_items;

    RETURN jsonb_build_object(
        'items', COALESCE(v_items, '[]'::jsonb)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION inventory.rpc_widget_pending_approvals TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION inventory.rpc_widget_overdue_reservations TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION inventory.rpc_widget_top_received_items TO authenticated, service_role;
