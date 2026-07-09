-- Carry make/model/year and the GV classification ids (asset type term,
-- equipment class / model / variant) through the fleet <-> inventory asset
-- sync. Companion to 20260624000001/2 and 20260709000001, which added the
-- columns but left the sync plumbing (emit trigger + inbound RPC) unaware of
-- them.
--
-- Semantics: incoming NULL means "not provided" and keeps the existing value
-- (matches the serial/vin convention). Clearing a classification requires a
-- direct write, not the sync.

-- 1. Inbound: fleet -> inventory apply RPC learns the new fields. ------------
-- New parameters change the signature, so drop the old overload first
-- (otherwise PostgREST sees two candidates and errors).

DROP FUNCTION IF EXISTS inventory.rpc_apply_fleet_asset_sync(
  uuid, uuid, text, text, text, text, text, text, text, text);

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
    p_equipment_variant_id uuid DEFAULT NULL
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
            make = COALESCE(NULLIF(p_make, ''), make),
            model = COALESCE(NULLIF(p_model, ''), model),
            model_year = COALESCE(p_model_year, model_year),
            asset_type_term_id = COALESCE(p_asset_type_term_id, asset_type_term_id),
            equipment_class_id = COALESCE(p_equipment_class_id, equipment_class_id),
            equipment_model_id = COALESCE(p_equipment_model_id, equipment_model_id),
            equipment_variant_id = COALESCE(p_equipment_variant_id, equipment_variant_id),
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
        asset_type_term_id, equipment_class_id, equipment_model_id, equipment_variant_id
    ) VALUES (
        p_tenant_id, v_tag, NULLIF(p_serial, ''), NULLIF(p_vin, ''), COALESCE(v_status, 'available'),
        v_kind, p_fleet_asset_id, 'fleet', COALESCE(p_event_id, 'fleet-sync-' || p_fleet_asset_id::text),
        NULLIF(p_make, ''), NULLIF(p_model, ''), p_model_year,
        p_asset_type_term_id, p_equipment_class_id, p_equipment_model_id, p_equipment_variant_id
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION inventory.rpc_apply_fleet_asset_sync(
  uuid, uuid, text, text, text, text, text, text, text, text,
  text, text, integer, uuid, uuid, uuid, uuid)
    TO authenticated, service_role;

-- 2. Outbound: asset.* event payloads carry the new fields. -------------------

CREATE OR REPLACE FUNCTION inventory.emit_asset_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_event_name TEXT;
    v_payload JSONB;
    v_changes JSONB;
BEGIN
    -- Echo guard: an inbound fleet->inventory sync sets this GUC for its write.
    -- We must not emit asset.* back out, or it would ping-pong with Fleet.
    IF current_setting('app.sync_in_progress', true) = '1' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_event_name := 'asset.created';
        v_payload := jsonb_build_object(
            'asset_id', NEW.id,
            'asset_tag', NEW.asset_tag,
            'catalog_item_id', NEW.catalog_item_id,
            'serial_number', NEW.serial_number,
            'vin', NEW.vin,
            'status', NEW.status,
            'asset_kind', NEW.asset_kind,
            'fleet_asset_id', NEW.fleet_asset_id,
            'source_system', NEW.source_system,
            'home_location_id', NEW.home_location_id,
            'make', NEW.make,
            'model', NEW.model,
            'model_year', NEW.model_year,
            'asset_type_term_id', NEW.asset_type_term_id,
            'equipment_class_id', NEW.equipment_class_id,
            'equipment_model_id', NEW.equipment_model_id,
            'equipment_variant_id', NEW.equipment_variant_id,
            'tenant_id', NEW.tenant_id,
            'created_at', NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.status = 'retired' AND OLD.status != 'retired' THEN
            v_event_name := 'asset.retired';
            v_payload := jsonb_build_object(
                'asset_id', NEW.id,
                'asset_tag', NEW.asset_tag,
                'serial_number', NEW.serial_number,
                'vin', NEW.vin,
                'asset_kind', NEW.asset_kind,
                'fleet_asset_id', NEW.fleet_asset_id,
                'source_system', NEW.source_system,
                'tenant_id', NEW.tenant_id,
                'retired_at', NEW.updated_at
            );
        ELSE
            v_event_name := 'asset.updated';
            v_changes := jsonb_build_object();

            IF OLD.status != NEW.status THEN
                v_changes := v_changes || jsonb_build_object('status', jsonb_build_object('old', OLD.status, 'new', NEW.status));
            END IF;
            IF OLD.asset_tag IS DISTINCT FROM NEW.asset_tag THEN
                v_changes := v_changes || jsonb_build_object('asset_tag', jsonb_build_object('old', OLD.asset_tag, 'new', NEW.asset_tag));
            END IF;
            IF OLD.serial_number IS DISTINCT FROM NEW.serial_number THEN
                v_changes := v_changes || jsonb_build_object('serial_number', jsonb_build_object('old', OLD.serial_number, 'new', NEW.serial_number));
            END IF;
            IF OLD.vin IS DISTINCT FROM NEW.vin THEN
                v_changes := v_changes || jsonb_build_object('vin', jsonb_build_object('old', OLD.vin, 'new', NEW.vin));
            END IF;
            IF OLD.home_location_id IS DISTINCT FROM NEW.home_location_id THEN
                v_changes := v_changes || jsonb_build_object('home_location_id', jsonb_build_object('old', OLD.home_location_id, 'new', NEW.home_location_id));
            END IF;
            IF OLD.make IS DISTINCT FROM NEW.make THEN
                v_changes := v_changes || jsonb_build_object('make', jsonb_build_object('old', OLD.make, 'new', NEW.make));
            END IF;
            IF OLD.model IS DISTINCT FROM NEW.model THEN
                v_changes := v_changes || jsonb_build_object('model', jsonb_build_object('old', OLD.model, 'new', NEW.model));
            END IF;
            IF OLD.model_year IS DISTINCT FROM NEW.model_year THEN
                v_changes := v_changes || jsonb_build_object('model_year', jsonb_build_object('old', OLD.model_year, 'new', NEW.model_year));
            END IF;
            IF OLD.asset_type_term_id IS DISTINCT FROM NEW.asset_type_term_id THEN
                v_changes := v_changes || jsonb_build_object('asset_type_term_id', jsonb_build_object('old', OLD.asset_type_term_id, 'new', NEW.asset_type_term_id));
            END IF;
            IF OLD.equipment_class_id IS DISTINCT FROM NEW.equipment_class_id THEN
                v_changes := v_changes || jsonb_build_object('equipment_class_id', jsonb_build_object('old', OLD.equipment_class_id, 'new', NEW.equipment_class_id));
            END IF;
            IF OLD.equipment_model_id IS DISTINCT FROM NEW.equipment_model_id THEN
                v_changes := v_changes || jsonb_build_object('equipment_model_id', jsonb_build_object('old', OLD.equipment_model_id, 'new', NEW.equipment_model_id));
            END IF;
            IF OLD.equipment_variant_id IS DISTINCT FROM NEW.equipment_variant_id THEN
                v_changes := v_changes || jsonb_build_object('equipment_variant_id', jsonb_build_object('old', OLD.equipment_variant_id, 'new', NEW.equipment_variant_id));
            END IF;

            v_payload := jsonb_build_object(
                'asset_id', NEW.id,
                'asset_tag', NEW.asset_tag,
                'serial_number', NEW.serial_number,
                'vin', NEW.vin,
                'status', NEW.status,
                'asset_kind', NEW.asset_kind,
                'fleet_asset_id', NEW.fleet_asset_id,
                'source_system', NEW.source_system,
                'make', NEW.make,
                'model', NEW.model,
                'model_year', NEW.model_year,
                'asset_type_term_id', NEW.asset_type_term_id,
                'equipment_class_id', NEW.equipment_class_id,
                'equipment_model_id', NEW.equipment_model_id,
                'equipment_variant_id', NEW.equipment_variant_id,
                'tenant_id', NEW.tenant_id,
                'changes', v_changes,
                'updated_at', NEW.updated_at
            );
        END IF;
    END IF;

    PERFORM public.emit_event(
        p_type := v_event_name,
        p_payload := v_payload,
        p_tenant_id := NEW.tenant_id
    );

    RETURN NEW;
END;
$function$;
