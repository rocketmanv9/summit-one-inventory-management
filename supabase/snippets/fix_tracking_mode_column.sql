-- Fix column name in rpc_get_po_receiving_detail: inventory_type -> tracking_mode

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
    -- Validate inputs
    IF p_tenant_id IS NULL OR p_po_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id and po_id are required';
    END IF;

    -- Build result with PO header and lines
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
        WHERE po.id = p_po_id 
          AND po.tenant_id = p_tenant_id
    ),
    po_lines AS (
        SELECT 
            pol.id AS line_id,
            pol.line_number,
            pol.catalog_item_id,
            ci.sku,
            ci.name AS item_name,
            ci.tracking_mode,  -- FIXED: was ci.inventory_type
            pol.qty_ordered,
            pol.qty_received,
            (pol.qty_ordered - COALESCE(pol.qty_received, 0)) AS qty_remaining,
            pol.unit_cost,
            pol.estimated_unit_cost,
            pol.unit_of_measure AS uom,  -- FIXED: was pol.uom
            pol.status,
            pol.notes
        FROM supply_chain.purchase_order_lines pol
        LEFT JOIN inventory.catalog_items ci ON ci.id = pol.catalog_item_id
        WHERE pol.po_id = p_po_id 
          AND pol.tenant_id = p_tenant_id
        ORDER BY pol.line_number
    )
    SELECT jsonb_build_object(
        'po', (SELECT row_to_json(po_header.*) FROM po_header),
        'lines', COALESCE((SELECT jsonb_agg(row_to_json(po_lines.*)) FROM po_lines), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION supply_chain.rpc_get_po_receiving_detail TO authenticated, service_role;
