-- Asset <-> Fleet bidirectional sync: inventory OUTBOUND side.
--
-- Adds the cross-service link/identity columns on inventory.assets and rewrites
-- the asset event trigger to (a) carry enough payload for Fleet to upsert, and
-- (b) NOT re-emit when the write itself came from an inbound fleet sync (echo
-- guard via the app.sync_in_progress GUC that rpc_apply_fleet_asset_sync sets).
--
-- Identity model: each side stores the other's id.
--   inventory.assets.fleet_asset_id  -> fleet_assets.id
--   fleet_assets.inventory_asset_id  -> inventory.assets.id
-- source_system marks where a row originated ('inventory' | 'fleet').
-- asset_kind classifies the asset so only vehicles/equipment (and later tools)
-- sync to Fleet; NULL/'other' assets are inventory-only and never sync out.

ALTER TABLE inventory.assets
  ADD COLUMN IF NOT EXISTS source_system text NOT NULL DEFAULT 'inventory',
  ADD COLUMN IF NOT EXISTS fleet_asset_id uuid,
  ADD COLUMN IF NOT EXISTS asset_kind text;

ALTER TABLE inventory.assets DROP CONSTRAINT IF EXISTS assets_asset_kind_check;
ALTER TABLE inventory.assets
  ADD CONSTRAINT assets_asset_kind_check
  CHECK (asset_kind IS NULL OR asset_kind IN ('vehicle', 'equipment', 'tool', 'other'));

-- One inventory asset per linked fleet asset, per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_assets_fleet_asset_id
  ON inventory.assets (tenant_id, fleet_asset_id)
  WHERE fleet_asset_id IS NOT NULL;

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

            v_payload := jsonb_build_object(
                'asset_id', NEW.id,
                'asset_tag', NEW.asset_tag,
                'serial_number', NEW.serial_number,
                'vin', NEW.vin,
                'status', NEW.status,
                'asset_kind', NEW.asset_kind,
                'fleet_asset_id', NEW.fleet_asset_id,
                'source_system', NEW.source_system,
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
