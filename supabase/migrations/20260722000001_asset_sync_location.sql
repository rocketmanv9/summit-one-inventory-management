-- Carry the fleet asset's location (yard) through the fleet -> inventory sync.
--
-- fleet_assets.location holds the yard NAME ("Portland", "Auburn", ...) and
-- inventory.locations has matching rows, but rpc_apply_fleet_asset_sync never
-- mapped it — every fleet-synced asset landed with location_id NULL, so
-- location-scoped queries ("assets in the Portland yard") returned nothing.
--
-- Adds p_location (name, case-insensitive match against inventory.locations
-- within the tenant). A resolved location OVERWRITES location_id — fleet is
-- the source of truth for where fleet-synced assets live. NULL / unresolvable
-- keeps the existing value (same convention as serial/vin).
--
-- The one-time backfill of pre-existing assets is a data operation run
-- separately (cross-project: fleet ids fetched from the fleet DB).

-- New parameter changes the signature, so drop the old overload first
-- (otherwise PostgREST sees two candidates and errors).
DROP FUNCTION IF EXISTS inventory.rpc_apply_fleet_asset_sync(
  uuid, uuid, text, text, text, text, text, text, text, text,
  text, text, integer, uuid, uuid, uuid, uuid);

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
    p_event_id text DEFAULT NULL,
    p_make text DEFAULT NULL,
    p_model text DEFAULT NULL,
    p_model_year integer DEFAULT NULL,
    p_asset_type_term_id uuid DEFAULT NULL,   -- fleet: asset_class_term_id
    p_equipment_class_id uuid DEFAULT NULL,
    p_equipment_model_id uuid DEFAULT NULL,
    p_equipment_variant_id uuid DEFAULT NULL,
    p_location text DEFAULT NULL              -- fleet location/yard NAME
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
    v_location_id uuid;
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

    -- Resolve the fleet location NAME to an inventory location (active rows
    -- preferred; exact case-insensitive name match). Unresolvable -> NULL,
    -- which keeps the asset's existing location.
    IF NULLIF(btrim(COALESCE(p_location, '')), '') IS NOT NULL THEN
        SELECT id INTO v_location_id
        FROM inventory.locations
        WHERE tenant_id = p_tenant_id
          AND lower(name) = lower(btrim(p_location))
        ORDER BY active DESC NULLS LAST, created_at ASC
        LIMIT 1;
    END IF;

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
            make = COALESCE(NULLIF(p_make, ''), make),
            model = COALESCE(NULLIF(p_model, ''), model),
            model_year = COALESCE(p_model_year, model_year),
            asset_type_term_id = COALESCE(p_asset_type_term_id, asset_type_term_id),
            equipment_class_id = COALESCE(p_equipment_class_id, equipment_class_id),
            equipment_model_id = COALESCE(p_equipment_model_id, equipment_model_id),
            equipment_variant_id = COALESCE(p_equipment_variant_id, equipment_variant_id),
            location_id = COALESCE(v_location_id, location_id),
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
        asset_kind, fleet_asset_id, source_system, last_event_id,
        make, model, model_year,
        asset_type_term_id, equipment_class_id, equipment_model_id, equipment_variant_id,
        location_id
    ) VALUES (
        p_tenant_id, v_tag, NULLIF(p_serial, ''), NULLIF(p_vin, ''), COALESCE(v_status, 'available'),
        v_kind, p_fleet_asset_id, 'fleet', COALESCE(p_event_id, 'fleet-sync-' || p_fleet_asset_id::text),
        NULLIF(p_make, ''), NULLIF(p_model, ''), p_model_year,
        p_asset_type_term_id, p_equipment_class_id, p_equipment_model_id, p_equipment_variant_id,
        v_location_id
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION inventory.rpc_apply_fleet_asset_sync(
  uuid, uuid, text, text, text, text, text, text, text, text,
  text, text, integer, uuid, uuid, uuid, uuid, text)
    TO authenticated, service_role;
