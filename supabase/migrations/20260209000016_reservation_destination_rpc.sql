-- Add destination_location_id support to reservation RPCs
CREATE OR REPLACE FUNCTION inventory.rpc_inv_reserve_fungible(
    p_tenant_id UUID,
    p_catalog_item_id UUID,
    p_location_id UUID,
    p_qty NUMERIC,
    p_allocation_type TEXT DEFAULT NULL,
    p_job_ref JSONB DEFAULT NULL,
    p_external_order_ref TEXT DEFAULT NULL,
    p_needed_by DATE DEFAULT NULL,
    p_expiration_date DATE DEFAULT NULL,
    p_reserved_from TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_reserved_until TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_destination_location_id UUID DEFAULT NULL,
    p_last_event_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_reservation_id UUID;
    v_event_id TEXT;
    v_validation RECORD;
BEGIN
    -- Validate inputs
    IF p_tenant_id IS NULL OR p_catalog_item_id IS NULL OR p_location_id IS NULL OR p_qty IS NULL THEN
        RAISE EXCEPTION 'tenant_id, catalog_item_id, location_id, and qty are required'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'qty must be greater than 0'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Require event ID for strict idempotency
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_event_id := p_last_event_id;

    -- Validate availability
    SELECT * INTO v_validation
    FROM inventory.validate_fungible_reservation_availability(
        p_tenant_id,
        p_catalog_item_id,
        p_location_id,
        p_qty
    );

    IF NOT v_validation.is_available THEN
        RAISE EXCEPTION '%', v_validation.message
        USING ERRCODE = 'check_violation',
              HINT = 'Check stock levels or receive more inventory';
    END IF;

    -- Create reservation (idempotent on last_event_id)
    INSERT INTO inventory.reservations (
        tenant_id,
        catalog_item_id,
        location_id,
        destination_location_id,
        qty,
        asset_id,
        reservation_type,
        status,
        allocation_type,
        job_ref,
        external_order_ref,
        needed_by,
        expiration_date,
        reserved_from,
        reserved_until,
        notes,
        last_event_id
    ) VALUES (
        p_tenant_id,
        p_catalog_item_id,
        p_location_id,
        p_destination_location_id,
        p_qty,
        NULL,
        'fungible',
        'active',
        p_allocation_type,
        p_job_ref,
        p_external_order_ref,
        p_needed_by,
        p_expiration_date,
        p_reserved_from,
        p_reserved_until,
        p_notes,
        v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_reservation_id;

    -- If no ID returned, reservation already exists (idempotent)
    IF v_reservation_id IS NULL THEN
        SELECT id INTO v_reservation_id
        FROM inventory.reservations
        WHERE tenant_id = p_tenant_id
          AND last_event_id = v_event_id;

        RETURN v_reservation_id;
    END IF;

    -- Update stock_balances.qty_reserved
    INSERT INTO inventory.stock_balances (
        tenant_id,
        catalog_item_id,
        location_id,
        qty_on_hand,
        qty_reserved
    ) VALUES (
        p_tenant_id,
        p_catalog_item_id,
        p_location_id,
        0,
        p_qty
    )
    ON CONFLICT (tenant_id, catalog_item_id, location_id)
    DO UPDATE SET
        qty_reserved = inventory.stock_balances.qty_reserved + EXCLUDED.qty_reserved,
        updated_at = NOW();

    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'reservation.created.fungible',
        p_aggregate_type => 'reservation',
        p_aggregate_id => v_reservation_id,
        p_payload => jsonb_build_object(
            'reservation_id', v_reservation_id,
            'reservation_type', 'fungible',
            'catalog_item_id', p_catalog_item_id,
            'location_id', p_location_id,
            'destination_location_id', p_destination_location_id,
            'qty', p_qty,
            'allocation_type', p_allocation_type,
            'external_order_ref', p_external_order_ref,
            'reserved_from', p_reserved_from,
            'reserved_until', p_reserved_until
        )
    );

    RETURN v_reservation_id;
END;
$$;

CREATE OR REPLACE FUNCTION inventory.rpc_inv_reserve_asset(
    p_tenant_id UUID,
    p_asset_id UUID,
    p_allocation_type TEXT DEFAULT NULL,
    p_job_ref JSONB DEFAULT NULL,
    p_external_order_ref TEXT DEFAULT NULL,
    p_needed_by DATE DEFAULT NULL,
    p_expiration_date DATE DEFAULT NULL,
    p_reserved_from TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_reserved_until TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_destination_location_id UUID DEFAULT NULL,
    p_last_event_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_reservation_id UUID;
    v_event_id TEXT;
    v_validation RECORD;
    v_asset RECORD;
BEGIN
    -- Validate inputs
    IF p_tenant_id IS NULL OR p_asset_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id and asset_id are required'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Require event ID for strict idempotency
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_event_id := p_last_event_id;

    -- Get asset details
    SELECT 
        a.id,
        a.catalog_item_id,
        a.location_id,
        a.asset_tag
    INTO v_asset
    FROM inventory.assets a
    WHERE a.id = p_asset_id
      AND a.tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Asset not found or access denied'
        USING ERRCODE = 'no_data_found';
    END IF;

    -- Validate availability
    SELECT * INTO v_validation
    FROM inventory.validate_asset_reservation_availability(
        p_tenant_id,
        p_asset_id,
        p_reserved_from,
        p_reserved_until
    );

    IF NOT v_validation.is_available THEN
        RAISE EXCEPTION '%', v_validation.message
        USING ERRCODE = 'check_violation',
              HINT = 'Choose a different asset or time window';
    END IF;

    -- Create reservation (idempotent on last_event_id)
    INSERT INTO inventory.reservations (
        tenant_id,
        catalog_item_id,
        location_id,
        destination_location_id,
        qty,
        asset_id,
        reservation_type,
        status,
        allocation_type,
        job_ref,
        external_order_ref,
        needed_by,
        expiration_date,
        reserved_from,
        reserved_until,
        notes,
        last_event_id
    ) VALUES (
        p_tenant_id,
        v_asset.catalog_item_id,
        v_asset.location_id,
        p_destination_location_id,
        1,
        p_asset_id,
        'serialized',
        'active',
        p_allocation_type,
        p_job_ref,
        p_external_order_ref,
        p_needed_by,
        p_expiration_date,
        p_reserved_from,
        p_reserved_until,
        p_notes,
        v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_reservation_id;

    -- If no ID returned, reservation already exists (idempotent)
    IF v_reservation_id IS NULL THEN
        SELECT id INTO v_reservation_id
        FROM inventory.reservations
        WHERE tenant_id = p_tenant_id
          AND last_event_id = v_event_id;

        RETURN v_reservation_id;
    END IF;

    -- Update asset status to 'assigned' (optional, based on business rules)
    UPDATE inventory.assets
    SET 
        status = 'assigned',
        updated_at = NOW()
    WHERE id = p_asset_id
      AND tenant_id = p_tenant_id;

    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'reservation.created.serialized',
        p_aggregate_type => 'reservation',
        p_aggregate_id => v_reservation_id,
        p_payload => jsonb_build_object(
            'reservation_id', v_reservation_id,
            'reservation_type', 'serialized',
            'asset_id', p_asset_id,
            'asset_tag', v_asset.asset_tag,
            'catalog_item_id', v_asset.catalog_item_id,
            'location_id', v_asset.location_id,
            'destination_location_id', p_destination_location_id,
            'allocation_type', p_allocation_type,
            'external_order_ref', p_external_order_ref,
            'reserved_from', p_reserved_from,
            'reserved_until', p_reserved_until
        )
    );

    RETURN v_reservation_id;
END;
$$;
