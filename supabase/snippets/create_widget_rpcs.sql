-- Widget RPCs for Dashboard

-- 1. Total Inventory Value
CREATE OR REPLACE FUNCTION inventory.rpc_widget_total_inventory_value(
    p_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, supply_chain, public
AS $$
DECLARE
    v_total_value NUMERIC;
    v_item_count INTEGER;
    v_total_qty NUMERIC;
BEGIN
    SELECT 
        COALESCE(SUM(sb.qty_on_hand * COALESCE(pol.unit_cost, 0)), 0),
        COUNT(DISTINCT sb.catalog_item_id),
        COALESCE(SUM(sb.qty_on_hand), 0)
    INTO v_total_value, v_item_count, v_total_qty
    FROM inventory.stock_balances sb
    LEFT JOIN LATERAL (
        SELECT DISTINCT ON (pol.catalog_item_id) pol.unit_cost
        FROM supply_chain.purchase_order_lines pol
        WHERE pol.catalog_item_id = sb.catalog_item_id
          AND pol.tenant_id = p_tenant_id
        ORDER BY pol.catalog_item_id, pol.created_at DESC
    ) pol ON true
    WHERE sb.tenant_id = p_tenant_id
      AND sb.qty_on_hand > 0;

    RETURN jsonb_build_object(
        'value', v_total_value,
        'item_count', v_item_count,
        'total_qty', v_total_qty
    );
END;
$$;

-- 2. Items Below Reorder Point
CREATE OR REPLACE FUNCTION inventory.rpc_widget_items_below_reorder(
    p_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, supply_chain, public
AS $$
DECLARE
    v_count INTEGER;
    v_items JSONB;
BEGIN
    SELECT 
        COUNT(*),
        jsonb_agg(
            jsonb_build_object(
                'sku', ci.sku,
                'name', ci.name,
                'qty_available', sb.qty_available,
                'reorder_point', ci.reorder_point,
                'location', l.name
            ) ORDER BY (ci.reorder_point - sb.qty_available) DESC
        ) FILTER (WHERE ci.sku IS NOT NULL)
    INTO v_count, v_items
    FROM inventory.stock_balances sb
    JOIN inventory.catalog_items ci ON sb.catalog_item_id = ci.id
    JOIN inventory.locations l ON sb.location_id = l.id
    WHERE sb.tenant_id = p_tenant_id
      AND ci.reorder_point IS NOT NULL
      AND sb.qty_available <= ci.reorder_point
      AND ci.active = true
      AND ci.deleted_at IS NULL;

    RETURN jsonb_build_object(
        'count', COALESCE(v_count, 0),
        'items', COALESCE(v_items, '[]'::jsonb)
    );
END;
$$;

-- 3. Open Purchase Orders
CREATE OR REPLACE FUNCTION inventory.rpc_widget_open_purchase_orders(
    p_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, supply_chain, public
AS $$
DECLARE
    v_count INTEGER;
    v_orders JSONB;
BEGIN
    SELECT 
        COUNT(*),
        jsonb_agg(
            jsonb_build_object(
                'po_number', po.po_number,
                'vendor', v.name,
                'status', po.status,
                'order_date', po.order_date,
                'line_count', (
                    SELECT COUNT(*) 
                    FROM supply_chain.purchase_order_lines pol 
                    WHERE pol.po_id = po.id
                )
            ) ORDER BY po.order_date DESC
        ) FILTER (WHERE po.po_number IS NOT NULL)
    INTO v_count, v_orders
    FROM supply_chain.purchase_orders po
    LEFT JOIN supply_chain.vendors v ON po.vendor_id = v.id
    WHERE po.tenant_id = p_tenant_id
      AND po.status IN ('draft', 'pending', 'approved', 'placed', 'partially_received');

    RETURN jsonb_build_object(
        'count', COALESCE(v_count, 0),
        'orders', COALESCE(v_orders, '[]'::jsonb)
    );
END;
$$;

-- 4. Recent Receipts
CREATE OR REPLACE FUNCTION inventory.rpc_widget_recent_receipts(
    p_tenant_id UUID,
    p_limit INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, supply_chain, public
AS $$
DECLARE
    v_receipts JSONB;
BEGIN
    SELECT 
        jsonb_agg(
            jsonb_build_object(
                'receipt_number', r.receipt_number,
                'po_number', po.po_number,
                'status', r.status,
                'created_at', r.created_at,
                'location', l.name,
                'line_count', (
                    SELECT COUNT(*) 
                    FROM supply_chain.receipt_lines rl 
                    WHERE rl.receipt_id = r.id
                )
            ) ORDER BY r.created_at DESC
        )
    INTO v_receipts
    FROM supply_chain.receipts r
    JOIN supply_chain.purchase_orders po ON r.po_id = po.id
    LEFT JOIN inventory.locations l ON r.location_id = l.id
    WHERE r.tenant_id = p_tenant_id
    ORDER BY r.created_at DESC
    LIMIT p_limit;

    RETURN jsonb_build_object(
        'receipts', COALESCE(v_receipts, '[]'::jsonb)
    );
END;
$$;

-- 5. Transfers Pending
CREATE OR REPLACE FUNCTION inventory.rpc_widget_transfers_pending(
    p_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, supply_chain, public
AS $$
DECLARE
    v_count INTEGER;
    v_transfers JSONB;
BEGIN
    SELECT 
        COUNT(*),
        jsonb_agg(
            jsonb_build_object(
                'transfer_number', t.transfer_number,
                'from_location', l_from.name,
                'to_location', l_to.name,
                'status', t.status,
                'created_at', t.created_at,
                'line_count', (
                    SELECT COUNT(*) 
                    FROM inventory.transfer_lines tl 
                    WHERE tl.transfer_id = t.id
                )
            ) ORDER BY t.created_at DESC
        ) FILTER (WHERE t.transfer_number IS NOT NULL)
    INTO v_count, v_transfers
    FROM inventory.transfers t
    LEFT JOIN inventory.locations l_from ON t.from_location_id = l_from.id
    LEFT JOIN inventory.locations l_to ON t.to_location_id = l_to.id
    WHERE t.tenant_id = p_tenant_id
      AND t.status IN ('pending', 'in_transit', 'draft');

    RETURN jsonb_build_object(
        'count', COALESCE(v_count, 0),
        'transfers', COALESCE(v_transfers, '[]'::jsonb)
    );
END;
$$;

-- 6. Reservations Upcoming
CREATE OR REPLACE FUNCTION inventory.rpc_widget_reservations_upcoming(
    p_tenant_id UUID,
    p_days INTEGER DEFAULT 7
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, supply_chain, public
AS $$
DECLARE
    v_count INTEGER;
    v_reservations JSONB;
BEGIN
    SELECT 
        COUNT(*),
        jsonb_agg(
            jsonb_build_object(
                'item_name', ci.name,
                'qty', r.qty,
                'location', l.name,
                'needed_at', r.needed_at,
                'status', r.status,
                'reservation_type', r.reservation_type
            ) ORDER BY r.needed_at ASC
        ) FILTER (WHERE ci.name IS NOT NULL)
    INTO v_count, v_reservations
    FROM inventory.reservations r
    JOIN inventory.catalog_items ci ON r.catalog_item_id = ci.id
    LEFT JOIN inventory.locations l ON r.location_id = l.id
    WHERE r.tenant_id = p_tenant_id
      AND r.status = 'active'
      AND r.needed_at >= NOW()
      AND r.needed_at <= NOW() + (p_days || ' days')::INTERVAL;

    RETURN jsonb_build_object(
        'count', COALESCE(v_count, 0),
        'reservations', COALESCE(v_reservations, '[]'::jsonb)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION inventory.rpc_widget_total_inventory_value TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION inventory.rpc_widget_items_below_reorder TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION inventory.rpc_widget_open_purchase_orders TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION inventory.rpc_widget_recent_receipts TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION inventory.rpc_widget_transfers_pending TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION inventory.rpc_widget_reservations_upcoming TO authenticated, service_role;
