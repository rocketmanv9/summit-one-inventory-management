-- ============================================================================
-- RFID Device API - RPC Functions
-- ============================================================================
-- Purpose: Implement API endpoints for RFID devices (authentication, sync, submit)
-- Date: 2026-01-28
-- Dependencies: Requires rfid_devices, rfid_cycle_count_submissions, cycle_counts tables
-- ============================================================================

-- ============================================================================
-- 1. Device Authentication & Registration
-- ============================================================================

-- Function: Register new RFID device
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rfid_register_device(
    p_tenant_id UUID,
    p_device_code TEXT,
    p_device_type TEXT, -- 'handheld_cycle_count', 'handheld_assignment', 'portal_reader'
    p_scopes TEXT[], -- e.g., ['cycle_count:sync', 'cycle_count:submit', 'device:heartbeat']
    p_notes TEXT DEFAULT NULL,
    p_registered_by UUID DEFAULT NULL
)
RETURNS TABLE (
    device_id UUID,
    api_key TEXT -- Only returned once during registration
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_device_id UUID;
    v_api_key TEXT;
    v_api_key_hash TEXT;
    v_event_id UUID;
BEGIN
    -- Generate UUID for device
    v_device_id := gen_random_uuid();
    
    -- Generate secure API key (256-bit = 32 bytes = 64 hex chars)
    v_api_key := encode(gen_random_bytes(32), 'hex');
    
    -- Hash the API key for storage (using bcrypt via pgcrypto extension)
    v_api_key_hash := crypt(v_api_key, gen_salt('bf', 10));
    
    -- Insert device record
    INSERT INTO public.rfid_devices (
        device_id,
        tenant_id,
        device_code,
        device_type,
        api_key_hash,
        scopes,
        is_active,
        notes,
        last_heartbeat_at,
        created_by,
        updated_by
    ) VALUES (
        v_device_id,
        p_tenant_id,
        p_device_code,
        p_device_type,
        v_api_key_hash,
        p_scopes,
        TRUE,
        p_notes,
        NULL,
        p_registered_by,
        p_registered_by
    );
    
    -- Emit event
    v_event_id := emit_event(
        p_tenant_id,
        'inventory.rfid.device_registered',
        1,
        jsonb_build_object(
            'device_id', v_device_id,
            'tenant_id', p_tenant_id,
            'device_code', p_device_code,
            'device_type', p_device_type,
            'scopes', p_scopes,
            'registered_by', p_registered_by
        ),
        'inventory',
        v_device_id
    );
    
    -- Return device_id and plain-text API key (only time it's visible!)
    RETURN QUERY SELECT v_device_id, v_api_key;
END;
$$;

COMMENT ON FUNCTION public.rfid_register_device IS
'Registers new RFID device and returns API key (only shown once). Emits inventory.rfid.device_registered event.';


-- Function: Authenticate device using API key
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rfid_authenticate_device(
    p_tenant_id UUID,
    p_device_code TEXT,
    p_api_key TEXT,
    p_required_scope TEXT DEFAULT NULL -- Optional: check if device has specific scope
)
RETURNS TABLE (
    device_id UUID,
    device_type TEXT,
    scopes TEXT[],
    is_active BOOLEAN,
    has_required_scope BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_device_record RECORD;
    v_has_scope BOOLEAN;
BEGIN
    -- Find device and verify API key using bcrypt
    SELECT 
        d.device_id,
        d.device_type,
        d.scopes,
        d.is_active
    INTO v_device_record
    FROM public.rfid_devices d
    WHERE d.tenant_id = p_tenant_id
      AND d.device_code = p_device_code
      AND d.api_key_hash = crypt(p_api_key, d.api_key_hash); -- bcrypt verification
    
    -- If no device found or API key invalid
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid device credentials'
            USING HINT = 'Device not found or API key incorrect';
    END IF;
    
    -- Check if device is active
    IF NOT v_device_record.is_active THEN
        RAISE EXCEPTION 'Device is deactivated'
            USING HINT = 'Contact administrator to reactivate device';
    END IF;
    
    -- Check for required scope (if provided)
    v_has_scope := TRUE;
    IF p_required_scope IS NOT NULL THEN
        v_has_scope := p_required_scope = ANY(v_device_record.scopes);
        IF NOT v_has_scope THEN
            RAISE EXCEPTION 'Insufficient permissions'
                USING HINT = format('Device lacks required scope: %s', p_required_scope);
        END IF;
    END IF;
    
    -- Return device info
    RETURN QUERY
    SELECT 
        v_device_record.device_id,
        v_device_record.device_type,
        v_device_record.scopes,
        v_device_record.is_active,
        v_has_scope;
END;
$$;

COMMENT ON FUNCTION public.rfid_authenticate_device IS
'Authenticates RFID device using API key (bcrypt verification). Optionally checks for required scope.';


-- Function: Device heartbeat (telemetry update)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rfid_device_heartbeat(
    p_device_id UUID,
    p_tenant_id UUID,
    p_firmware_version TEXT DEFAULT NULL,
    p_app_version TEXT DEFAULT NULL,
    p_battery_level NUMERIC DEFAULT NULL,
    p_ip_address TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event_id UUID;
    v_heartbeat_at TIMESTAMPTZ;
BEGIN
    v_heartbeat_at := NOW();
    
    -- Update device telemetry
    UPDATE public.rfid_devices
    SET 
        last_heartbeat_at = v_heartbeat_at,
        firmware_version = COALESCE(p_firmware_version, firmware_version),
        app_version = COALESCE(p_app_version, app_version),
        battery_level = COALESCE(p_battery_level, battery_level),
        ip_address = COALESCE(p_ip_address, ip_address),
        updated_at = v_heartbeat_at
    WHERE device_id = p_device_id
      AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Device not found: %', p_device_id;
    END IF;
    
    -- Emit heartbeat event
    v_event_id := emit_event(
        p_tenant_id,
        'inventory.rfid.device_heartbeat',
        1,
        jsonb_build_object(
            'device_id', p_device_id,
            'tenant_id', p_tenant_id,
            'heartbeat_at', v_heartbeat_at,
            'firmware_version', p_firmware_version,
            'app_version', p_app_version,
            'battery_level', p_battery_level,
            'ip_address', p_ip_address
        ),
        'inventory',
        p_device_id
    );
    
    RETURN jsonb_build_object(
        'success', TRUE,
        'heartbeat_at', v_heartbeat_at,
        'event_id', v_event_id
    );
END;
$$;

COMMENT ON FUNCTION public.rfid_device_heartbeat IS
'Updates device telemetry (battery, versions, IP). Emits inventory.rfid.device_heartbeat event.';


-- ============================================================================
-- 2. Cycle Count Workflow - Device API
-- ============================================================================

-- Function: Sync cycle count requests (for handheld devices)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rfid_device_sync_cycle_counts(
    p_device_id UUID,
    p_tenant_id UUID
)
RETURNS TABLE (
    cycle_count_id UUID,
    cycle_count_number TEXT,
    location_id UUID,
    location_code TEXT,
    location_name TEXT,
    count_type TEXT,
    is_blind BOOLEAN,
    requested_by_name TEXT,
    snapshot_captured_at TIMESTAMPTZ,
    status TEXT,
    expected_sku_count INTEGER,
    expected_asset_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Return all cycle counts in 'started' status for the device's tenant
    -- These are counts that have been initiated and are ready for RFID scanning
    RETURN QUERY
    SELECT 
        cc.cycle_count_id,
        cc.cycle_count_number,
        cc.location_id,
        l.location_code,
        l.location_name,
        cc.count_type,
        cc.is_blind,
        u.full_name AS requested_by_name,
        cc.snapshot_captured_at,
        cc.status,
        (SELECT COUNT(*) FROM public.cycle_count_snapshot_skus WHERE cycle_count_id = cc.cycle_count_id) AS expected_sku_count,
        (SELECT COUNT(*) FROM public.cycle_count_snapshot_assets WHERE cycle_count_id = cc.cycle_count_id) AS expected_asset_count
    FROM public.cycle_counts cc
    LEFT JOIN public.locations l ON cc.location_id = l.location_id
    LEFT JOIN public.users u ON cc.requested_by = u.user_id
    WHERE cc.tenant_id = p_tenant_id
      AND cc.status = 'started' -- Only send counts ready for RFID scanning
    ORDER BY cc.created_at ASC;
END;
$$;

COMMENT ON FUNCTION public.rfid_device_sync_cycle_counts IS
'Returns all active cycle count requests for handheld device to process (status=started).';


-- Function: Submit RFID cycle count results (from handheld)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rfid_submit_cycle_count_results(
    p_device_id UUID,
    p_tenant_id UUID,
    p_cycle_count_id UUID,
    p_client_submission_id UUID, -- For idempotency
    p_epc_list JSONB, -- Array of {"epc": "...", "rssi": -45, "count": 3, "first_seen": "...", "last_seen": "..."}
    p_scan_metadata JSONB DEFAULT NULL -- {"duration_seconds": 320, "power_mode": "MED", "started_at": "...", "ended_at": "..."}
)
RETURNS TABLE (
    submission_id UUID,
    status TEXT,
    unique_epcs_count INTEGER,
    total_reads INTEGER,
    event_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_submission_id UUID;
    v_event_id UUID;
    v_unique_epcs INTEGER;
    v_total_reads INTEGER;
    v_duration INTEGER;
    v_power_mode TEXT;
BEGIN
    -- Extract metadata
    v_duration := (p_scan_metadata->>'duration_seconds')::INTEGER;
    v_power_mode := p_scan_metadata->>'power_mode';
    
    -- Count unique EPCs and total reads
    SELECT 
        COUNT(*),
        SUM((item->>'count')::INTEGER)
    INTO v_unique_epcs, v_total_reads
    FROM jsonb_array_elements(p_epc_list) AS item;
    
    -- Insert submission (idempotent via unique constraint on client_submission_id)
    INSERT INTO public.rfid_cycle_count_submissions (
        tenant_id,
        device_id,
        cycle_count_id,
        client_submission_id,
        epc_list,
        scan_metadata,
        submission_status,
        uploaded_at
    ) VALUES (
        p_tenant_id,
        p_device_id,
        p_cycle_count_id,
        p_client_submission_id,
        p_epc_list,
        p_scan_metadata,
        'uploaded',
        NOW()
    )
    ON CONFLICT (tenant_id, client_submission_id) DO NOTHING
    RETURNING submission_id INTO v_submission_id;
    
    -- If submission_id is NULL, it means conflict (duplicate client_submission_id)
    IF v_submission_id IS NULL THEN
        -- Return existing submission
        SELECT sub.submission_id INTO v_submission_id
        FROM public.rfid_cycle_count_submissions sub
        WHERE sub.tenant_id = p_tenant_id
          AND sub.client_submission_id = p_client_submission_id;
        
        RETURN QUERY
        SELECT 
            v_submission_id,
            'duplicate'::TEXT AS status,
            v_unique_epcs,
            v_total_reads,
            NULL::UUID AS event_id;
        RETURN;
    END IF;
    
    -- Emit event for new submission
    v_event_id := emit_event(
        p_tenant_id,
        'inventory.rfid.cycle_count_submission_uploaded',
        1,
        jsonb_build_object(
            'submission_id', v_submission_id,
            'tenant_id', p_tenant_id,
            'device_id', p_device_id,
            'cycle_count_id', p_cycle_count_id,
            'client_submission_id', p_client_submission_id,
            'unique_epcs_count', v_unique_epcs,
            'total_reads', v_total_reads,
            'duration_seconds', v_duration,
            'power_mode_used', v_power_mode
        ),
        'inventory',
        v_submission_id
    );
    
    RETURN QUERY
    SELECT 
        v_submission_id,
        'uploaded'::TEXT AS status,
        v_unique_epcs,
        v_total_reads,
        v_event_id;
END;
$$;

COMMENT ON FUNCTION public.rfid_submit_cycle_count_results IS
'Uploads RFID cycle count results from handheld device. Idempotent via client_submission_id. Emits inventory.rfid.cycle_count_submission_uploaded event.';


-- ============================================================================
-- 3. Desktop Workflow - Review & Commit Submissions
-- ============================================================================

-- Function: Get pending RFID submissions for review
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rfid_get_pending_submissions(
    p_tenant_id UUID,
    p_cycle_count_id UUID DEFAULT NULL
)
RETURNS TABLE (
    submission_id UUID,
    cycle_count_id UUID,
    cycle_count_number TEXT,
    device_code TEXT,
    unique_epcs_count INTEGER,
    total_reads INTEGER,
    uploaded_at TIMESTAMPTZ,
    submission_status TEXT,
    recognized_tags INTEGER,
    unrecognized_epcs INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sub.submission_id,
        sub.cycle_count_id,
        cc.cycle_count_number,
        dev.device_code,
        (SELECT COUNT(*) FROM jsonb_array_elements(sub.epc_list)) AS unique_epcs_count,
        (SELECT SUM((item->>'count')::INTEGER) FROM jsonb_array_elements(sub.epc_list) AS item) AS total_reads,
        sub.uploaded_at,
        sub.submission_status,
        sub.recognized_tags_count,
        sub.unrecognized_epcs_count
    FROM public.rfid_cycle_count_submissions sub
    JOIN public.cycle_counts cc ON sub.cycle_count_id = cc.cycle_count_id
    JOIN public.rfid_devices dev ON sub.device_id = dev.device_id
    WHERE sub.tenant_id = p_tenant_id
      AND sub.submission_status IN ('uploaded', 'reviewed')
      AND (p_cycle_count_id IS NULL OR sub.cycle_count_id = p_cycle_count_id)
    ORDER BY sub.uploaded_at DESC;
END;
$$;

COMMENT ON FUNCTION public.rfid_get_pending_submissions IS
'Returns pending RFID submissions for desktop review (status=uploaded or reviewed).';


-- Function: Commit submission to inventory
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rfid_commit_submission(
    p_submission_id UUID,
    p_tenant_id UUID,
    p_committed_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_submission RECORD;
    v_epc_item JSONB;
    v_tag RECORD;
    v_recognized_count INTEGER := 0;
    v_unrecognized_count INTEGER := 0;
    v_event_id UUID;
BEGIN
    -- Get submission
    SELECT * INTO v_submission
    FROM public.rfid_cycle_count_submissions
    WHERE submission_id = p_submission_id
      AND tenant_id = p_tenant_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Submission not found: %', p_submission_id;
    END IF;
    
    IF v_submission.submission_status = 'committed' THEN
        RAISE EXCEPTION 'Submission already committed';
    END IF;
    
    -- Process each EPC and match to tags
    FOR v_epc_item IN SELECT * FROM jsonb_array_elements(v_submission.epc_list)
    LOOP
        -- Try to find matching tag
        SELECT * INTO v_tag
        FROM public.rfid_tags
        WHERE tenant_id = p_tenant_id
          AND epc = v_epc_item->>'epc'
          AND tag_status = 'active';
        
        IF FOUND THEN
            v_recognized_count := v_recognized_count + 1;
            
            -- Create cycle count line for this tag
            -- (Based on tag_category: asset_tag -> asset_line, bulk_item_tag -> regular line)
            IF v_tag.tag_category = 'asset_tag' THEN
                INSERT INTO public.cycle_count_asset_lines (
                    tenant_id,
                    cycle_count_id,
                    asset_id,
                    expected_location_id,
                    scanned_at,
                    scanned_location_id,
                    variance_type,
                    notes
                ) VALUES (
                    p_tenant_id,
                    v_submission.cycle_count_id,
                    v_tag.asset_id,
                    v_tag.current_location_id, -- Assume tag knows current location
                    (v_epc_item->>'last_seen')::TIMESTAMPTZ,
                    v_tag.current_location_id,
                    'found', -- Can be enhanced with variance detection
                    format('RFID scan: EPC %s, RSSI %s', v_epc_item->>'epc', v_epc_item->>'rssi')
                )
                ON CONFLICT (tenant_id, cycle_count_id, asset_id) DO UPDATE
                SET scanned_at = EXCLUDED.scanned_at;
            ELSIF v_tag.tag_category = 'bulk_item_tag' THEN
                -- For bulk tags, increment count on cycle_count_lines
                -- (This requires more complex logic - simplified here)
                INSERT INTO public.cycle_count_lines (
                    tenant_id,
                    cycle_count_id,
                    catalog_item_id,
                    location_id,
                    expected_qty,
                    counted_qty,
                    variance,
                    notes
                ) VALUES (
                    p_tenant_id,
                    v_submission.cycle_count_id,
                    v_tag.bulk_catalog_item_id,
                    v_tag.current_location_id,
                    0,
                    1, -- Each tag = 1 unit
                    1,
                    format('RFID scan: EPC %s', v_epc_item->>'epc')
                )
                ON CONFLICT (tenant_id, cycle_count_id, catalog_item_id, location_id) DO UPDATE
                SET counted_qty = cycle_count_lines.counted_qty + 1,
                    variance = cycle_count_lines.counted_qty + 1 - cycle_count_lines.expected_qty;
            END IF;
        ELSE
            v_unrecognized_count := v_unrecognized_count + 1;
        END IF;
    END LOOP;
    
    -- Update submission status
    UPDATE public.rfid_cycle_count_submissions
    SET 
        submission_status = 'committed',
        committed_at = NOW(),
        committed_by = p_committed_by,
        recognized_tags_count = v_recognized_count,
        unrecognized_epcs_count = v_unrecognized_count
    WHERE submission_id = p_submission_id;
    
    -- Emit commit event
    v_event_id := emit_event(
        p_tenant_id,
        'inventory.rfid.cycle_count_submission_committed',
        1,
        jsonb_build_object(
            'submission_id', p_submission_id,
            'tenant_id', p_tenant_id,
            'cycle_count_id', v_submission.cycle_count_id,
            'committed_at', NOW(),
            'committed_by', p_committed_by,
            'recognized_tags', v_recognized_count,
            'unrecognized_epcs', v_unrecognized_count,
            'adjustments_created', 0 -- TODO: Count actual adjustments
        ),
        'inventory',
        p_submission_id
    );
    
    RETURN jsonb_build_object(
        'success', TRUE,
        'submission_id', p_submission_id,
        'recognized_tags', v_recognized_count,
        'unrecognized_epcs', v_unrecognized_count,
        'event_id', v_event_id
    );
END;
$$;

COMMENT ON FUNCTION public.rfid_commit_submission IS
'Commits RFID submission to inventory: matches EPCs to tags, creates cycle count lines. Emits inventory.rfid.cycle_count_submission_committed event.';


-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '╔═══════════════════════════════════════════════════════════════════╗';
    RAISE NOTICE '║   RFID Device API Functions Created                              ║';
    RAISE NOTICE '╚═══════════════════════════════════════════════════════════════════╝';
    RAISE NOTICE '';
    RAISE NOTICE '✓ Created 7 RPC functions:';
    RAISE NOTICE '';
    RAISE NOTICE 'Device Management:';
    RAISE NOTICE '  1. rfid_register_device() - Register new device, get API key';
    RAISE NOTICE '  2. rfid_authenticate_device() - Validate API key with bcrypt';
    RAISE NOTICE '  3. rfid_device_heartbeat() - Update telemetry';
    RAISE NOTICE '';
    RAISE NOTICE 'Cycle Count Workflow:';
    RAISE NOTICE '  4. rfid_device_sync_cycle_counts() - Download requests to handheld';
    RAISE NOTICE '  5. rfid_submit_cycle_count_results() - Upload results from handheld';
    RAISE NOTICE '';
    RAISE NOTICE 'Desktop Review:';
    RAISE NOTICE '  6. rfid_get_pending_submissions() - List uploaded scans';
    RAISE NOTICE '  7. rfid_commit_submission() - Match EPCs → create count lines';
    RAISE NOTICE '';
    RAISE NOTICE 'Security:';
    RAISE NOTICE '  • API key authentication via bcrypt (crypt/gen_salt)';
    RAISE NOTICE '  • Scope-based authorization checked in authenticate';
    RAISE NOTICE '  • All functions use SECURITY DEFINER with tenant_id checks';
    RAISE NOTICE '';
    RAISE NOTICE 'Idempotency:';
    RAISE NOTICE '  • rfid_submit_cycle_count_results uses client_submission_id';
    RAISE NOTICE '  • Duplicate submissions return existing record';
    RAISE NOTICE '';
END $$;
