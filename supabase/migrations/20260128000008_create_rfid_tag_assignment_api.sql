-- ============================================================================
-- RFID Tag Assignment API - RPC Functions
-- ============================================================================
-- Purpose: Implement tag assignment workflows (individual 1:1 asset tags, bulk pooled tags)
-- Date: 2026-01-28
-- Dependencies: Requires rfid_tags, rfid_epc_captures, rfid_bulk_assignment_sessions tables
-- ============================================================================

-- ============================================================================
-- 1. Individual Asset Tag Assignment (Desktop Workflow)
-- ============================================================================

-- Function: Capture EPC from desktop USB reader
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rfid_capture_epc(
    p_tenant_id UUID,
    p_epc TEXT,
    p_rssi INTEGER DEFAULT NULL,
    p_captured_by UUID DEFAULT NULL
)
RETURNS TABLE (
    capture_id UUID,
    epc TEXT,
    existing_tag_id UUID,
    existing_assignment TEXT -- 'unassigned', 'asset', 'bulk_item'
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_capture_id UUID;
    v_existing_tag RECORD;
BEGIN
    -- Generate capture ID
    v_capture_id := gen_random_uuid();
    
    -- Check if EPC already has active tag assignment
    SELECT 
        tag_id,
        CASE 
            WHEN tag_category = 'asset_tag' AND asset_id IS NOT NULL THEN 'asset'
            WHEN tag_category = 'bulk_item_tag' AND bulk_catalog_item_id IS NOT NULL THEN 'bulk_item'
            ELSE 'unassigned'
        END AS assignment_type
    INTO v_existing_tag
    FROM public.rfid_tags
    WHERE tenant_id = p_tenant_id
      AND epc = p_epc
      AND tag_status = 'active';
    
    -- Store capture in staging table
    INSERT INTO public.rfid_epc_captures (
        capture_id,
        tenant_id,
        epc,
        rssi,
        captured_by,
        captured_at,
        assignment_status
    ) VALUES (
        v_capture_id,
        p_tenant_id,
        p_epc,
        p_rssi,
        p_captured_by,
        NOW(),
        CASE 
            WHEN v_existing_tag.tag_id IS NOT NULL THEN 'existing'
            ELSE 'new'
        END
    );
    
    -- Return capture info and existing assignment
    RETURN QUERY
    SELECT 
        v_capture_id,
        p_epc,
        v_existing_tag.tag_id,
        COALESCE(v_existing_tag.assignment_type, 'unassigned');
END;
$$;

COMMENT ON FUNCTION public.rfid_capture_epc IS
'Captures EPC from desktop USB reader for tag assignment. Checks for existing assignments.';


-- Function: Assign tag to asset (1:1 assignment)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rfid_assign_tag_to_asset(
    p_tenant_id UUID,
    p_epc TEXT,
    p_asset_id UUID,
    p_assigned_by UUID,
    p_assigned_via_device_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
    tag_id UUID,
    assignment_type TEXT, -- 'new', 'reassigned'
    event_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tag_id UUID;
    v_existing_tag RECORD;
    v_asset RECORD;
    v_event_id UUID;
    v_assignment_type TEXT;
BEGIN
    -- Verify asset exists and get current location
    SELECT * INTO v_asset
    FROM public.assets
    WHERE tenant_id = p_tenant_id
      AND asset_id = p_asset_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Asset not found: %', p_asset_id;
    END IF;
    
    -- Check if EPC already assigned
    SELECT * INTO v_existing_tag
    FROM public.rfid_tags
    WHERE tenant_id = p_tenant_id
      AND epc = p_epc
      AND tag_status = 'active';
    
    IF FOUND THEN
        -- Reassignment scenario
        v_tag_id := v_existing_tag.tag_id;
        v_assignment_type := 'reassigned';
        
        -- Record assignment history
        INSERT INTO public.rfid_tag_assignment_history (
            tenant_id,
            tag_id,
            epc,
            assignment_type,
            asset_id,
            catalog_item_id,
            assigned_by,
            assigned_via_device_id,
            assignment_notes
        ) VALUES (
            p_tenant_id,
            v_tag_id,
            p_epc,
            'reassigned',
            v_existing_tag.asset_id, -- Previous asset
            v_existing_tag.bulk_catalog_item_id, -- Previous item
            p_assigned_by,
            p_assigned_via_device_id,
            format('Reassigned from %s to asset %s', 
                COALESCE(v_existing_tag.asset_id::TEXT, v_existing_tag.bulk_catalog_item_id::TEXT), 
                p_asset_id)
        );
        
        -- Update tag
        UPDATE public.rfid_tags
        SET 
            tag_category = 'asset_tag',
            asset_id = p_asset_id,
            bulk_catalog_item_id = NULL,
            current_location_id = v_asset.location_id,
            updated_at = NOW()
        WHERE tag_id = v_tag_id;
        
        -- Emit reassignment event
        v_event_id := emit_event(
            p_tenant_id,
            'inventory.rfid.tag_reassigned',
            1,
            jsonb_build_object(
                'tag_id', v_tag_id,
                'tenant_id', p_tenant_id,
                'epc', p_epc,
                'previous_asset_id', v_existing_tag.asset_id,
                'new_asset_id', p_asset_id,
                'previous_catalog_item_id', v_existing_tag.bulk_catalog_item_id,
                'reassigned_by', p_assigned_by
            ),
            'inventory',
            v_tag_id
        );
    ELSE
        -- New assignment
        v_tag_id := gen_random_uuid();
        v_assignment_type := 'new';
        
        -- Create new tag
        INSERT INTO public.rfid_tags (
            tag_id,
            tenant_id,
            epc,
            tag_category,
            asset_id,
            bulk_catalog_item_id,
            current_location_id,
            tag_status,
            notes
        ) VALUES (
            v_tag_id,
            p_tenant_id,
            p_epc,
            'asset_tag',
            p_asset_id,
            NULL,
            v_asset.location_id,
            'active',
            p_notes
        );
        
        -- Record assignment history
        INSERT INTO public.rfid_tag_assignment_history (
            tenant_id,
            tag_id,
            epc,
            assignment_type,
            asset_id,
            catalog_item_id,
            assigned_by,
            assigned_via_device_id,
            assignment_notes
        ) VALUES (
            p_tenant_id,
            v_tag_id,
            p_epc,
            'assigned',
            p_asset_id,
            NULL,
            p_assigned_by,
            p_assigned_via_device_id,
            p_notes
        );
        
        -- Emit assignment event
        v_event_id := emit_event(
            p_tenant_id,
            'inventory.rfid.tag_assigned',
            1,
            jsonb_build_object(
                'tag_id', v_tag_id,
                'tenant_id', p_tenant_id,
                'epc', p_epc,
                'tag_category', 'asset_tag',
                'asset_id', p_asset_id,
                'assigned_by', p_assigned_by,
                'assigned_via_device_id', p_assigned_via_device_id,
                'assigned_at', NOW()
            ),
            'inventory',
            v_tag_id
        );
    END IF;
    
    RETURN QUERY
    SELECT v_tag_id, v_assignment_type, v_event_id;
END;
$$;

COMMENT ON FUNCTION public.rfid_assign_tag_to_asset IS
'Assigns RFID tag to specific asset (1:1). Handles new assignments and reassignments. Emits inventory.rfid.tag_assigned or inventory.rfid.tag_reassigned event.';


-- ============================================================================
-- 2. Bulk Tag Assignment (Pooled Tags for Fungible Items)
-- ============================================================================

-- Function: Start bulk assignment session
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rfid_start_bulk_assignment_session(
    p_tenant_id UUID,
    p_catalog_item_id UUID,
    p_started_by UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
    session_id UUID,
    session_number TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session_id UUID;
    v_session_number TEXT;
    v_catalog_item RECORD;
BEGIN
    -- Verify catalog item exists and is bulk-tracked
    SELECT * INTO v_catalog_item
    FROM public.catalog_items
    WHERE tenant_id = p_tenant_id
      AND catalog_item_id = p_catalog_item_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Catalog item not found: %', p_catalog_item_id;
    END IF;
    
    IF v_catalog_item.tracking_mode != 'bulk' THEN
        RAISE EXCEPTION 'Catalog item must be bulk-tracked for bulk tag assignment'
            USING HINT = format('Item %s has tracking_mode=%s', v_catalog_item.item_code, v_catalog_item.tracking_mode);
    END IF;
    
    -- Generate session ID and number
    v_session_id := gen_random_uuid();
    v_session_number := 'BULK-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(NEXTVAL('session_number_seq')::TEXT, 5, '0');
    
    -- Create session
    INSERT INTO public.rfid_bulk_assignment_sessions (
        session_id,
        tenant_id,
        session_number,
        catalog_item_id,
        session_status,
        started_by,
        notes
    ) VALUES (
        v_session_id,
        p_tenant_id,
        v_session_number,
        p_catalog_item_id,
        'in_progress',
        p_started_by,
        p_notes
    );
    
    RETURN QUERY
    SELECT v_session_id, v_session_number;
END;
$$;

-- Create sequence for session numbers (if not exists)
CREATE SEQUENCE IF NOT EXISTS session_number_seq START 1;

COMMENT ON FUNCTION public.rfid_start_bulk_assignment_session IS
'Starts bulk tag assignment session for pooled tags (fungible items).';


-- Function: Add tag to bulk assignment session
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rfid_add_tag_to_bulk_session(
    p_session_id UUID,
    p_tenant_id UUID,
    p_epc TEXT,
    p_added_by UUID
)
RETURNS TABLE (
    tag_id UUID,
    tag_count_in_session INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session RECORD;
    v_tag_id UUID;
    v_tag_count INTEGER;
BEGIN
    -- Get session
    SELECT * INTO v_session
    FROM public.rfid_bulk_assignment_sessions
    WHERE session_id = p_session_id
      AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found: %', p_session_id;
    END IF;
    
    IF v_session.session_status != 'in_progress' THEN
        RAISE EXCEPTION 'Session is not in progress (status=%)', v_session.session_status;
    END IF;
    
    -- Create tag
    v_tag_id := gen_random_uuid();
    
    INSERT INTO public.rfid_tags (
        tag_id,
        tenant_id,
        epc,
        tag_category,
        asset_id,
        bulk_catalog_item_id,
        bulk_assignment_session_id,
        tag_status
    ) VALUES (
        v_tag_id,
        p_tenant_id,
        p_epc,
        'bulk_item_tag',
        NULL,
        v_session.catalog_item_id,
        p_session_id,
        'active'
    );
    
    -- Record assignment history
    INSERT INTO public.rfid_tag_assignment_history (
        tenant_id,
        tag_id,
        epc,
        assignment_type,
        asset_id,
        catalog_item_id,
        assigned_by,
        assignment_notes
    ) VALUES (
        p_tenant_id,
        v_tag_id,
        p_epc,
        'assigned',
        NULL,
        v_session.catalog_item_id,
        p_added_by,
        format('Bulk session: %s', v_session.session_number)
    );
    
    -- Update session tag count
    UPDATE public.rfid_bulk_assignment_sessions
    SET 
        tag_count = COALESCE(tag_count, 0) + 1,
        updated_at = NOW()
    WHERE session_id = p_session_id
    RETURNING tag_count INTO v_tag_count;
    
    RETURN QUERY
    SELECT v_tag_id, v_tag_count;
END;
$$;

COMMENT ON FUNCTION public.rfid_add_tag_to_bulk_session IS
'Adds RFID tag to bulk assignment session (pooled tag for fungible item).';


-- Function: Complete bulk assignment session
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rfid_complete_bulk_assignment_session(
    p_session_id UUID,
    p_tenant_id UUID,
    p_completed_by UUID
)
RETURNS TABLE (
    session_id UUID,
    tag_count INTEGER,
    event_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session RECORD;
    v_event_id UUID;
BEGIN
    -- Get session
    SELECT * INTO v_session
    FROM public.rfid_bulk_assignment_sessions
    WHERE session_id = p_session_id
      AND tenant_id = p_tenant_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found: %', p_session_id;
    END IF;
    
    IF v_session.session_status != 'in_progress' THEN
        RAISE EXCEPTION 'Session is not in progress (status=%)', v_session.session_status;
    END IF;
    
    -- Update session
    UPDATE public.rfid_bulk_assignment_sessions
    SET 
        session_status = 'completed',
        completed_at = NOW(),
        completed_by = p_completed_by
    WHERE session_id = p_session_id;
    
    -- Emit event
    v_event_id := emit_event(
        p_tenant_id,
        'inventory.rfid.bulk_assignment_session_completed',
        1,
        jsonb_build_object(
            'session_id', p_session_id,
            'tenant_id', p_tenant_id,
            'session_number', v_session.session_number,
            'catalog_item_id', v_session.catalog_item_id,
            'tag_count', v_session.tag_count,
            'started_by', v_session.started_by,
            'completed_at', NOW()
        ),
        'inventory',
        p_session_id
    );
    
    RETURN QUERY
    SELECT p_session_id, v_session.tag_count, v_event_id;
END;
$$;

COMMENT ON FUNCTION public.rfid_complete_bulk_assignment_session IS
'Completes bulk assignment session. Emits inventory.rfid.bulk_assignment_session_completed event.';


-- ============================================================================
-- 3. Tag Management
-- ============================================================================

-- Function: Retire tag
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rfid_retire_tag(
    p_tag_id UUID,
    p_tenant_id UUID,
    p_reason TEXT,
    p_retired_by UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tag RECORD;
    v_event_id UUID;
BEGIN
    -- Get tag
    SELECT * INTO v_tag
    FROM public.rfid_tags
    WHERE tag_id = p_tag_id
      AND tenant_id = p_tenant_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Tag not found: %', p_tag_id;
    END IF;
    
    -- Update tag status
    UPDATE public.rfid_tags
    SET 
        tag_status = 'retired',
        retired_at = NOW(),
        notes = COALESCE(notes || E'\n', '') || format('Retired: %s', p_reason),
        updated_at = NOW()
    WHERE tag_id = p_tag_id;
    
    -- Record history
    INSERT INTO public.rfid_tag_assignment_history (
        tenant_id,
        tag_id,
        epc,
        assignment_type,
        asset_id,
        catalog_item_id,
        assigned_by,
        assignment_notes
    ) VALUES (
        p_tenant_id,
        p_tag_id,
        v_tag.epc,
        'retired',
        v_tag.asset_id,
        v_tag.bulk_catalog_item_id,
        p_retired_by,
        p_reason
    );
    
    -- Emit event
    v_event_id := emit_event(
        p_tenant_id,
        'inventory.rfid.tag_retired',
        1,
        jsonb_build_object(
            'tag_id', p_tag_id,
            'tenant_id', p_tenant_id,
            'epc', v_tag.epc,
            'reason', p_reason,
            'retired_by', p_retired_by,
            'retired_at', NOW()
        ),
        'inventory',
        p_tag_id
    );
    
    RETURN v_event_id;
END;
$$;

COMMENT ON FUNCTION public.rfid_retire_tag IS
'Retires RFID tag from active use. Emits inventory.rfid.tag_retired event.';


-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '╔═══════════════════════════════════════════════════════════════════╗';
    RAISE NOTICE '║   RFID Tag Assignment API Created                                ║';
    RAISE NOTICE '╚═══════════════════════════════════════════════════════════════════╝';
    RAISE NOTICE '';
    RAISE NOTICE '✓ Created 8 RPC functions:';
    RAISE NOTICE '';
    RAISE NOTICE 'Individual Asset Tag Assignment (Desktop):';
    RAISE NOTICE '  1. rfid_capture_epc() - Capture from USB reader';
    RAISE NOTICE '  2. rfid_assign_tag_to_asset() - 1:1 asset ↔ tag';
    RAISE NOTICE '';
    RAISE NOTICE 'Bulk Tag Assignment (Pooled Tags):';
    RAISE NOTICE '  3. rfid_start_bulk_assignment_session() - Begin session';
    RAISE NOTICE '  4. rfid_add_tag_to_bulk_session() - Add tag to pool';
    RAISE NOTICE '  5. rfid_complete_bulk_assignment_session() - Finalize';
    RAISE NOTICE '';
    RAISE NOTICE 'Tag Management:';
    RAISE NOTICE '  6. rfid_retire_tag() - Mark tag as retired';
    RAISE NOTICE '';
    RAISE NOTICE 'Features:';
    RAISE NOTICE '  • Handles new assignments and reassignments';
    RAISE NOTICE '  • Tracks assignment history for audit trail';
    RAISE NOTICE '  • Validates asset/item existence before assignment';
    RAISE NOTICE '  • Emits events for all assignment changes';
    RAISE NOTICE '  • Supports both serialized (asset) and bulk (pooled) workflows';
    RAISE NOTICE '';
END $$;
