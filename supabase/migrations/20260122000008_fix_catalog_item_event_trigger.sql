-- ==========================================
-- Migration: Fix catalog item event trigger
-- Date: 2026-01-22
-- Purpose: Update emit_catalog_item_event to use unit_of_measure instead of uom
-- ==========================================

CREATE OR REPLACE FUNCTION inventory.emit_catalog_item_event()
RETURNS TRIGGER AS $$
DECLARE
    v_event_name TEXT;
    v_payload JSONB;
    v_changes JSONB;
BEGIN
    -- Determine event type
    IF TG_OP = 'INSERT' THEN
        v_event_name := 'inventory.item.created';
        v_payload := jsonb_build_object(
            'item_id', NEW.id,
            'sku', NEW.sku,
            'name', NEW.name,
            'category_id', NEW.category_id,
            'tracking_mode', NEW.tracking_mode,
            'unit_of_measure', NEW.unit_of_measure,
            'tenant_id', NEW.tenant_id,
            'created_at', NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        -- Check for deactivation
        IF OLD.active = TRUE AND NEW.active = FALSE THEN
            v_event_name := 'catalog_item.deactivated';
            v_payload := jsonb_build_object(
                'item_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'deactivated_at', NEW.updated_at
            );
        -- Check for reactivation
        ELSIF OLD.active = FALSE AND NEW.active = TRUE THEN
            v_event_name := 'catalog_item.reactivated';
            v_payload := jsonb_build_object(
                'item_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'reactivated_at', NEW.updated_at
            );
        ELSE
            -- Regular update
            v_event_name := 'catalog_item.updated';
            v_changes := jsonb_build_object();

            IF OLD.name != NEW.name THEN
                v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', OLD.name, 'new', NEW.name));
            END IF;
            IF OLD.sku != NEW.sku THEN
                v_changes := v_changes || jsonb_build_object('sku', jsonb_build_object('old', OLD.sku, 'new', NEW.sku));
            END IF;
            IF OLD.unit_of_measure IS DISTINCT FROM NEW.unit_of_measure THEN
                v_changes := v_changes || jsonb_build_object('unit_of_measure', jsonb_build_object('old', OLD.unit_of_measure, 'new', NEW.unit_of_measure));
            END IF;
            IF OLD.category_id IS DISTINCT FROM NEW.category_id THEN
                v_changes := v_changes || jsonb_build_object('category_id', jsonb_build_object('old', OLD.category_id, 'new', NEW.category_id));
            END IF;

            v_payload := jsonb_build_object(
                'item_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'changes', v_changes,
                'updated_at', NEW.updated_at
            );
        END IF;
    END IF;

    -- Emit event
    PERFORM public.emit_event(
        v_event_name,
        v_payload,
        NEW.tenant_id
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION inventory.emit_catalog_item_event() IS 
    'Emits events when catalog items are created or updated - uses unit_of_measure column';
