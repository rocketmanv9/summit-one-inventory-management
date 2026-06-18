-- Asset <-> Fleet bidirectional sync: inventory INBOUND apply.
--
-- Called by the /api/webhooks/fleet-events consumer when Fleet emits
-- fleet_asset.onboarded / .updated / .retired. Upserts inventory.assets to
-- mirror the fleet vehicle/equipment, correlating by fleet_asset_id first, then
-- by serial/vin (to adopt a pre-existing inventory asset), else creating one.
--
-- Sets app.sync_in_progress so emit_asset_event does NOT re-emit asset.* back to
-- Fleet (echo guard). Idempotent: the caller passes the event id as last_event_id.

CREATE OR REPLACE FUNCTION inventory.rpc_apply_fleet_asset_sync(
    p_tenant_id uuid,
    p_fleet_asset_id uuid,
    p_op text,                       -- 'upsert' | 'retire'
    p_asset_type text DEFAULT NULL,  -- fleet asset_type: 'vehicle' | 'equipment'
    p_name text DEFAULT NULL,
    p_serial text DEFAULT NULL,
    p_vin text DEFAULT NULL,
    p_unit_number text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_event_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'public'
AS $function$
DECLARE
    v_id uuid;
    v_tag text;
    v_base_tag text;
    v_status text;
    v_kind text;
    v_suffix int := 0;
BEGIN
    IF p_tenant_id IS NULL OR p_fleet_asset_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id and fleet_asset_id are required';
    END IF;

    -- Suppress the outbound asset.* emission for this sync-originated write.
    PERFORM set_config('app.sync_in_progress', '1', true);

    -- Map fleet status -> inventory status.
    v_status := CASE lower(COALESCE(p_status, ''))
        WHEN 'active' THEN 'available'
        WHEN 'pending' THEN 'available'
        WHEN 'out_of_service' THEN 'out_of_service'
        WHEN 'retired' THEN 'retired'
        WHEN 'sold' THEN 'retired'
        ELSE NULL
    END;

    -- Only vehicle/equipment are in scope today; anything else maps to 'equipment'
    -- defensively but the consumer should already filter.
    v_kind := CASE lower(COALESCE(p_asset_type, ''))
        WHEN 'vehicle' THEN 'vehicle'
        WHEN 'equipment' THEN 'equipment'
        WHEN 'tool' THEN 'tool'
        ELSE 'equipment'
    END;

    -- Correlate: linked id, then serial, then vin.
    SELECT id INTO v_id FROM inventory.assets
    WHERE tenant_id = p_tenant_id AND fleet_asset_id = p_fleet_asset_id
    LIMIT 1;

    IF v_id IS NULL AND NULLIF(p_serial, '') IS NOT NULL THEN
        SELECT id INTO v_id FROM inventory.assets
        WHERE tenant_id = p_tenant_id AND serial_number = p_serial AND (fleet_asset_id IS NULL OR fleet_asset_id = p_fleet_asset_id)
        ORDER BY (fleet_asset_id = p_fleet_asset_id) DESC NULLS LAST
        LIMIT 1;
    END IF;

    IF v_id IS NULL AND NULLIF(p_vin, '') IS NOT NULL THEN
        SELECT id INTO v_id FROM inventory.assets
        WHERE tenant_id = p_tenant_id AND vin = p_vin AND (fleet_asset_id IS NULL OR fleet_asset_id = p_fleet_asset_id)
        ORDER BY (fleet_asset_id = p_fleet_asset_id) DESC NULLS LAST
        LIMIT 1;
    END IF;

    IF p_op = 'retire' THEN
        IF v_id IS NOT NULL THEN
            UPDATE inventory.assets
            SET status = 'retired',
                fleet_asset_id = p_fleet_asset_id,
                last_event_id = COALESCE(p_event_id, last_event_id),
                updated_at = NOW()
            WHERE id = v_id;
        END IF;
        RETURN v_id;
    END IF;

    IF v_id IS NOT NULL THEN
        UPDATE inventory.assets
        SET serial_number = COALESCE(NULLIF(p_serial, ''), serial_number),
            vin = COALESCE(NULLIF(p_vin, ''), vin),
            status = COALESCE(v_status, status),
            asset_kind = COALESCE(asset_kind, v_kind),
            fleet_asset_id = p_fleet_asset_id,
            last_event_id = COALESCE(p_event_id, last_event_id),
            updated_at = NOW()
        WHERE id = v_id;
        RETURN v_id;
    END IF;

    -- Duplicate fleet data can repeat a serial/vin; inventory enforces both
    -- unique, so drop a colliding serial/vin on create. The fleet_asset_id link
    -- still uniquely identifies the asset.
    IF NULLIF(p_serial, '') IS NOT NULL AND EXISTS (SELECT 1 FROM inventory.assets WHERE tenant_id = p_tenant_id AND serial_number = p_serial) THEN
        p_serial := NULL;
    END IF;
    IF NULLIF(p_vin, '') IS NOT NULL AND EXISTS (SELECT 1 FROM inventory.assets WHERE tenant_id = p_tenant_id AND vin = p_vin) THEN
        p_vin := NULL;
    END IF;

    -- Create. asset_tag is NOT NULL and tenant-unique in practice; derive a tag
    -- and de-collide with a numeric suffix.
    v_base_tag := COALESCE(NULLIF(p_unit_number, ''), NULLIF(p_name, ''), 'FLEET-' || left(p_fleet_asset_id::text, 8));
    v_tag := v_base_tag;
    WHILE EXISTS (SELECT 1 FROM inventory.assets WHERE tenant_id = p_tenant_id AND asset_tag = v_tag) LOOP
        v_suffix := v_suffix + 1;
        v_tag := v_base_tag || '-' || v_suffix;
    END LOOP;

    INSERT INTO inventory.assets (
        tenant_id, asset_tag, serial_number, vin, status,
        asset_kind, fleet_asset_id, source_system, last_event_id
    ) VALUES (
        p_tenant_id, v_tag, NULLIF(p_serial, ''), NULLIF(p_vin, ''), COALESCE(v_status, 'available'),
        v_kind, p_fleet_asset_id, 'fleet', COALESCE(p_event_id, 'fleet-sync-' || p_fleet_asset_id::text)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION inventory.rpc_apply_fleet_asset_sync(uuid, uuid, text, text, text, text, text, text, text, text)
    TO authenticated, service_role;
