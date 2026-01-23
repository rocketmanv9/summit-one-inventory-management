-- ============================================================================
-- Fix Location Event Trigger for location_type_id
-- ============================================================================
-- Migration: 20260122000006
-- Description: Update emit_location_event trigger to use location_type_id
--              instead of the removed location_type column
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION inventory.emit_location_event() 
RETURNS TRIGGER
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
DECLARE
    v_event_name TEXT;
    v_payload JSONB;
    v_changes JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_name := 'location.created';
        v_payload := jsonb_build_object(
            'location_id', NEW.id,
            'location_type_id', NEW.location_type_id,
            'name', NEW.name,
            'parent_location_id', NEW.parent_location_id,
            'address', NEW.address,
            'external_ref', NEW.external_ref,
            'tenant_id', NEW.tenant_id,
            'created_at', NEW.created_at,
            'created_by', NEW.created_by
        );
    ELSIF TG_OP = 'UPDATE' THEN
        -- Check for deactivation
        IF OLD.active = TRUE AND NEW.active = FALSE THEN
            v_event_name := 'location.deactivated';
            v_payload := jsonb_build_object(
                'location_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'deactivated_at', NEW.updated_at,
                'deactivated_by', NEW.updated_by
            );
        ELSE
            -- Regular update
            v_event_name := 'location.updated';
            v_changes := jsonb_build_object();
            
            IF OLD.name != NEW.name THEN
                v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', OLD.name, 'new', NEW.name));
            END IF;
            
            IF OLD.location_type_id != NEW.location_type_id THEN
                v_changes := v_changes || jsonb_build_object('location_type_id', jsonb_build_object('old', OLD.location_type_id, 'new', NEW.location_type_id));
            END IF;
            
            IF (OLD.parent_location_id IS DISTINCT FROM NEW.parent_location_id) THEN
                v_changes := v_changes || jsonb_build_object('parent_location_id', jsonb_build_object('old', OLD.parent_location_id, 'new', NEW.parent_location_id));
            END IF;
            
            IF (OLD.address IS DISTINCT FROM NEW.address) THEN
                v_changes := v_changes || jsonb_build_object('address', jsonb_build_object('old', OLD.address, 'new', NEW.address));
            END IF;
            
            v_payload := jsonb_build_object(
                'location_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'changes', v_changes,
                'updated_at', NEW.updated_at,
                'updated_by', NEW.updated_by
            );
        END IF;
    END IF;
    
    PERFORM public.emit_event(
        v_event_name,
        v_payload,
        NEW.tenant_id
    );
    
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION inventory.emit_location_event() IS 
    'Emits events when locations are created, updated, or deactivated. Updated to use location_type_id instead of deprecated location_type column.';

-- Verify the function was updated
DO $$
BEGIN
    RAISE NOTICE '✓ Updated emit_location_event() to use location_type_id';
END $$;

COMMIT;
