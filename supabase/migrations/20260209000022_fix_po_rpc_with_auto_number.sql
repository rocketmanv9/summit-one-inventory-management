/**
 * Fix: Update rpc_create_purchase_order to support both JWT tenant_id paths
 * 
 * The function was only checking auth.jwt() ->> 'tenant_id'
 * but should also check auth.jwt() -> 'app_metadata' ->> 'tenant_id'
 */

CREATE OR REPLACE FUNCTION supply_chain.rpc_create_purchase_order(
    p_vendor_id UUID,
    p_po_number TEXT,
    p_delivery_method TEXT DEFAULT 'ship',
    p_needed_by_date DATE DEFAULT NULL,
    p_cost_context TEXT DEFAULT 'yard',
    p_job_id UUID DEFAULT NULL,
    p_delivery_location_id UUID DEFAULT NULL,
    p_pickup_location_id UUID DEFAULT NULL,
    p_max_authorized_spend NUMERIC DEFAULT NULL,
    p_vendor_quote_ref TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_attachments JSONB DEFAULT '[]'::jsonb,
    p_lines JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO supply_chain, inventory, public
AS $$
DECLARE
    v_tenant_id UUID;
    v_user_id UUID;
    v_po_id UUID;
    v_line JSONB;
    v_line_number INT := 0;
    v_total_estimated_cost NUMERIC := 0;
    v_has_unknown_pricing BOOLEAN := false;
    v_event_id UUID;
    v_vendor_name TEXT;
    v_vendor_code TEXT;
    v_result JSONB;
    v_generated_po_number TEXT;
BEGIN
    -- Support both JWT tenant_id paths (app_metadata or root)
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

    IF p_delivery_method = 'ship' AND p_delivery_location_id IS NULL THEN
        RAISE EXCEPTION 'delivery_location_id required when delivery_method = ship';
    END IF;

    IF p_delivery_method = 'pickup' AND p_pickup_location_id IS NULL THEN
        RAISE EXCEPTION 'pickup_location_id required when delivery_method = pickup';
    END IF;

    IF p_cost_context = 'job' AND p_job_id IS NULL THEN
        RAISE EXCEPTION 'job_id required when cost_context = job';
    END IF;

    -- Auto-generate PO number if not provided
    IF p_po_number IS NULL OR p_po_number = '' THEN
        v_generated_po_number := supply_chain.generate_po_number(v_tenant_id);
    ELSE
        v_generated_po_number := p_po_number;
    END IF;

    SELECT name, code INTO v_vendor_name, v_vendor_code
    FROM supply_chain.vendors
    WHERE id = p_vendor_id AND tenant_id = v_tenant_id;

    v_event_id := gen_random_uuid();

    INSERT INTO supply_chain.purchase_orders (
        tenant_id,
        po_number,
        vendor_id,
        vendor_name_snapshot,
        vendor_code_snapshot,
        delivery_method,
        needed_by_date,
        cost_context,
        job_id,
        delivery_location_id,
        pickup_location_id,
        max_authorized_spend,
        vendor_quote_ref,
        notes,
        attachments,
        status,
        order_date,
        last_event_id
    ) VALUES (
        v_tenant_id,
        v_generated_po_number,
        p_vendor_id,
        v_vendor_name,
        v_vendor_code,
        p_delivery_method,
        p_needed_by_date,
        p_cost_context,
        p_job_id,
        p_delivery_location_id,
        p_pickup_location_id,
        p_max_authorized_spend,
        p_vendor_quote_ref,
        p_notes,
        p_attachments,
        'draft',
        CURRENT_DATE,
        v_event_id
    )
    RETURNING id INTO v_po_id;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_line_number := v_line_number + 1;

        INSERT INTO supply_chain.purchase_order_lines (
            tenant_id,
            po_id,
            line_number,
            catalog_item_id,
            item_description,
            unit_of_measure,
            qty_ordered,
            unit_cost,
            estimated_unit_cost,
            price_basis,
            is_approximate_qty,
            line_notes,
            status,
            last_event_id
        ) VALUES (
            v_tenant_id,
            v_po_id,
            v_line_number,
            (v_line->>'catalog_item_id')::UUID,
            v_line->>'item_description',
            v_line->>'unit_of_measure',
            (v_line->>'qty_ordered')::NUMERIC,
            (v_line->>'unit_cost')::NUMERIC,
            (v_line->>'estimated_unit_cost')::NUMERIC,
            COALESCE(v_line->>'price_basis', 'fixed'),
            COALESCE((v_line->>'is_approximate_qty')::BOOLEAN, false),
            v_line->>'line_notes',
            'pending',
            v_event_id
        );

        IF (v_line->>'unit_cost') IS NOT NULL THEN
            v_total_estimated_cost := v_total_estimated_cost + 
                ((v_line->>'qty_ordered')::NUMERIC * (v_line->>'unit_cost')::NUMERIC);
        ELSIF (v_line->>'estimated_unit_cost') IS NOT NULL THEN
            v_total_estimated_cost := v_total_estimated_cost + 
                ((v_line->>'qty_ordered')::NUMERIC * (v_line->>'estimated_unit_cost')::NUMERIC);
        ELSE
            v_has_unknown_pricing := true;
        END IF;
    END LOOP;

    -- Event will be created by triggers, not manually here

    v_result := jsonb_build_object(
        'success', true,
        'po_id', v_po_id,
        'po_number', v_generated_po_number,
        'line_count', v_line_number,
        'status', 'draft'
    );

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_create_purchase_order IS 
'Create a purchase order with construction-friendly flexible line items. Supports both JWT tenant_id paths.';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_create_purchase_order(UUID, TEXT, TEXT, DATE, TEXT, UUID, UUID, UUID, NUMERIC, TEXT, TEXT, JSONB, JSONB) TO authenticated;
