-- ============================================================================
-- RFID Infrastructure - Complete Implementation
-- ============================================================================
-- Purpose: Implement RFID device registry, tag management, handheld cycle
--          counts (offline-first), and portal reader infrastructure
--
-- Date: 2026-01-28
-- Compliance: Multi-tenant, RLS-enabled, Event-driven, Idempotent
-- Dependencies: Requires cycle_counts tables from previous migrations
-- ============================================================================

-- ============================================================================
-- STEP 1: Create RFID Device Registry
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.rfid_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    device_code TEXT NOT NULL, -- Human-readable: "scanner-01", "portal-gate-a"
    device_type TEXT NOT NULL CHECK (device_type IN (
        'handheld_cycle_count',
        'portal_reader_entry',
        'portal_reader_exit',
        'portal_reader_bidirectional',
        'desktop_capture'
    )),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'retired')),
    
    -- Auth (API key stored as bcrypt hash)
    api_key_hash TEXT,
    scopes TEXT[] NOT NULL DEFAULT '{}', -- e.g. {'cycle_count:sync', 'cycle_count:submit'}
    
    -- Metadata
    hardware_model TEXT,
    firmware_version TEXT,
    app_version TEXT,
    notes TEXT,
    
    -- Location (for fixed portals)
    installed_location_id UUID REFERENCES inventory.locations(id) ON DELETE SET NULL,
    installation_notes TEXT,
    
    -- Telemetry
    last_seen_at TIMESTAMPTZ,
    last_ip_address TEXT,
    heartbeat_count INTEGER DEFAULT 0,
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id),
    
    CONSTRAINT rfid_devices_tenant_device_code_unique UNIQUE (tenant_id, device_code)
);

-- Indexes
CREATE INDEX idx_rfid_devices_tenant_id ON inventory.rfid_devices(tenant_id);
CREATE INDEX idx_rfid_devices_device_type ON inventory.rfid_devices(tenant_id, device_type);
CREATE INDEX idx_rfid_devices_status ON inventory.rfid_devices(tenant_id, status);
CREATE INDEX idx_rfid_devices_installed_location 
    ON inventory.rfid_devices(installed_location_id) 
    WHERE installed_location_id IS NOT NULL;
CREATE INDEX idx_rfid_devices_last_seen 
    ON inventory.rfid_devices(tenant_id, last_seen_at DESC)
    WHERE status = 'active';

-- Enable RLS
ALTER TABLE inventory.rfid_devices ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY rfid_devices_tenant_isolation 
    ON inventory.rfid_devices
    FOR ALL
    TO authenticated
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY rfid_devices_service_role 
    ON inventory.rfid_devices
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- Audit triggers
CREATE TRIGGER set_rfid_devices_audit
    BEFORE INSERT OR UPDATE ON inventory.rfid_devices
    FOR EACH ROW
    EXECUTE FUNCTION inventory.set_audit_fields();

CREATE TRIGGER update_rfid_devices_updated_at
    BEFORE UPDATE ON inventory.rfid_devices
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- Comments
COMMENT ON TABLE inventory.rfid_devices IS 'RFID device registry for handhelds, portals, and capture devices with tenant-safe API key authentication';
COMMENT ON COLUMN inventory.rfid_devices.api_key_hash IS 'Bcrypt hash of device API key - NEVER store plaintext';
COMMENT ON COLUMN inventory.rfid_devices.scopes IS 'Array of permission scopes: cycle_count:sync, cycle_count:submit, rfid:assign_tags, portal:emit_observations, device:heartbeat';
COMMENT ON COLUMN inventory.rfid_devices.device_type IS 'Type: handheld_cycle_count, portal_reader_entry/exit/bidirectional, desktop_capture';

-- ============================================================================
-- STEP 2: Create RFID Tag Identity & Assignment Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.rfid_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    epc TEXT NOT NULL, -- EPC-96 or EPC-128 as hex string
    
    -- Assignment
    tag_category TEXT NOT NULL CHECK (tag_category IN ('asset_tag', 'bulk_item_tag', 'unassigned')),
    assignment_status TEXT NOT NULL DEFAULT 'unassigned' CHECK (assignment_status IN (
        'unassigned',
        'assigned',
        'retired',
        'lost',
        'damaged'
    )),
    
    -- Asset assignment (1:1)
    asset_id UUID REFERENCES inventory.assets(id) ON DELETE SET NULL,
    
    -- Bulk item assignment (many EPCs : 1 item type)
    bulk_catalog_item_id UUID REFERENCES inventory.catalog_items(id) ON DELETE SET NULL,
    bulk_assignment_session_id UUID, -- Link to bulk assignment session
    
    -- Assignment metadata
    assigned_at TIMESTAMPTZ,
    assigned_by UUID REFERENCES auth.users(id),
    assigned_via_device_id UUID REFERENCES inventory.rfid_devices(id),
    assignment_notes TEXT,
    
    -- Tag lifecycle
    first_seen_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    seen_count INTEGER DEFAULT 0,
    
    -- Physical tag metadata
    manufacturer TEXT,
    tag_model TEXT,
    memory_size_bits INTEGER,
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id),
    last_event_id TEXT, -- For event-driven assignment
    
    CONSTRAINT rfid_tags_tenant_epc_unique UNIQUE (tenant_id, epc),
    CONSTRAINT rfid_tags_check_assignment CHECK (
        (tag_category = 'asset_tag' AND asset_id IS NOT NULL AND bulk_catalog_item_id IS NULL) OR
        (tag_category = 'bulk_item_tag' AND bulk_catalog_item_id IS NOT NULL AND asset_id IS NULL) OR
        (tag_category = 'unassigned' AND asset_id IS NULL AND bulk_catalog_item_id IS NULL)
    )
);

-- Indexes
CREATE INDEX idx_rfid_tags_tenant_epc ON inventory.rfid_tags(tenant_id, epc);
CREATE INDEX idx_rfid_tags_asset_id ON inventory.rfid_tags(asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX idx_rfid_tags_bulk_catalog_item 
    ON inventory.rfid_tags(bulk_catalog_item_id) 
    WHERE bulk_catalog_item_id IS NOT NULL;
CREATE INDEX idx_rfid_tags_assignment_status 
    ON inventory.rfid_tags(tenant_id, assignment_status);
CREATE INDEX idx_rfid_tags_tag_category 
    ON inventory.rfid_tags(tenant_id, tag_category);
CREATE INDEX idx_rfid_tags_bulk_session 
    ON inventory.rfid_tags(bulk_assignment_session_id) 
    WHERE bulk_assignment_session_id IS NOT NULL;

-- Enable RLS
ALTER TABLE inventory.rfid_tags ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY rfid_tags_tenant_isolation 
    ON inventory.rfid_tags
    FOR ALL
    TO authenticated
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY rfid_tags_service_role 
    ON inventory.rfid_tags
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- Audit triggers
CREATE TRIGGER set_rfid_tags_audit
    BEFORE INSERT OR UPDATE ON inventory.rfid_tags
    FOR EACH ROW
    EXECUTE FUNCTION inventory.set_audit_fields();

CREATE TRIGGER update_rfid_tags_updated_at
    BEFORE UPDATE ON inventory.rfid_tags
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- Comments
COMMENT ON TABLE inventory.rfid_tags IS 'RFID tag identity and assignment mapping - supports 1:1 asset tags and pooled bulk item tags';
COMMENT ON COLUMN inventory.rfid_tags.epc IS 'Electronic Product Code (EPC-96 or EPC-128) as hex string';
COMMENT ON COLUMN inventory.rfid_tags.tag_category IS 'asset_tag (1:1 with asset), bulk_item_tag (pooled), or unassigned';
COMMENT ON COLUMN inventory.rfid_tags.asset_id IS 'For asset_tag category: links to specific asset';
COMMENT ON COLUMN inventory.rfid_tags.bulk_catalog_item_id IS 'For bulk_item_tag category: represents one unit of this item type';

-- ============================================================================
-- STEP 3: Create RFID Tag Assignment History (Audit Trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.rfid_tag_assignment_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    tag_id UUID NOT NULL REFERENCES inventory.rfid_tags(id) ON DELETE CASCADE,
    epc TEXT NOT NULL,
    
    -- Action
    action TEXT NOT NULL CHECK (action IN ('assigned', 'reassigned', 'unassigned', 'retired')),
    
    -- Previous state
    previous_category TEXT,
    previous_asset_id UUID,
    previous_bulk_catalog_item_id UUID,
    
    -- New state
    new_category TEXT,
    new_asset_id UUID,
    new_bulk_catalog_item_id UUID,
    
    -- Context
    assigned_by UUID REFERENCES auth.users(id),
    assigned_via_device_id UUID REFERENCES inventory.rfid_devices(id),
    reason TEXT,
    notes TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_rfid_tag_assignment_history_tag_id 
    ON inventory.rfid_tag_assignment_history(tag_id, created_at DESC);
CREATE INDEX idx_rfid_tag_assignment_history_epc 
    ON inventory.rfid_tag_assignment_history(tenant_id, epc, created_at DESC);
CREATE INDEX idx_rfid_tag_assignment_history_asset 
    ON inventory.rfid_tag_assignment_history(new_asset_id, created_at DESC) 
    WHERE new_asset_id IS NOT NULL;

-- Enable RLS
ALTER TABLE inventory.rfid_tag_assignment_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY rfid_tag_assignment_history_tenant_isolation 
    ON inventory.rfid_tag_assignment_history
    FOR SELECT
    TO authenticated
    USING (tenant_id = current_tenant_id());

CREATE POLICY rfid_tag_assignment_history_service_role 
    ON inventory.rfid_tag_assignment_history
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- Comments
COMMENT ON TABLE inventory.rfid_tag_assignment_history IS 'Audit trail for all RFID tag assignments, reassignments, and retirements';

-- ============================================================================
-- STEP 4: Create Bulk Assignment Sessions
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.rfid_bulk_assignment_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    session_number TEXT NOT NULL,
    
    catalog_item_id UUID NOT NULL REFERENCES inventory.catalog_items(id) ON DELETE RESTRICT,
    
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'cancelled')),
    
    epcs_assigned TEXT[], -- Array of EPCs in this session
    tag_count INTEGER DEFAULT 0,
    
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    started_by UUID REFERENCES auth.users(id),
    device_id UUID REFERENCES inventory.rfid_devices(id),
    notes TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT rfid_bulk_assignment_sessions_tenant_session_unique 
        UNIQUE (tenant_id, session_number)
);

-- Indexes
CREATE INDEX idx_rfid_bulk_sessions_tenant_session 
    ON inventory.rfid_bulk_assignment_sessions(tenant_id, session_number);
CREATE INDEX idx_rfid_bulk_sessions_catalog_item 
    ON inventory.rfid_bulk_assignment_sessions(catalog_item_id);
CREATE INDEX idx_rfid_bulk_sessions_status 
    ON inventory.rfid_bulk_assignment_sessions(tenant_id, status);

-- Enable RLS
ALTER TABLE inventory.rfid_bulk_assignment_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY rfid_bulk_sessions_tenant_isolation 
    ON inventory.rfid_bulk_assignment_sessions
    FOR ALL
    TO authenticated
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY rfid_bulk_sessions_service_role 
    ON inventory.rfid_bulk_assignment_sessions
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- Audit trigger
CREATE TRIGGER update_rfid_bulk_sessions_updated_at
    BEFORE UPDATE ON inventory.rfid_bulk_assignment_sessions
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- Comments
COMMENT ON TABLE inventory.rfid_bulk_assignment_sessions IS 'Bulk assignment sessions for pooled item tags - one session assigns many EPCs to same item type';

-- ============================================================================
-- STEP 5: Create Cycle Count Submissions (Staged Handheld Uploads)
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.rfid_cycle_count_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL, -- Derived from device
    
    -- Device & Request
    device_id UUID NOT NULL REFERENCES inventory.rfid_devices(id) ON DELETE RESTRICT,
    cycle_count_id UUID NOT NULL REFERENCES inventory.cycle_counts(id) ON DELETE RESTRICT,
    
    -- Idempotency
    client_submission_id UUID NOT NULL, -- Generated on device
    
    -- Session metadata
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    duration_seconds INTEGER GENERATED ALWAYS AS (
        EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER
    ) STORED,
    
    -- Power mode tracking
    power_mode_used TEXT NOT NULL CHECK (power_mode_used IN ('LOW', 'MED', 'HIGH')),
    power_mode_changes JSONB, -- [{timestamp, old_mode, new_mode, reason}]
    
    -- Status
    status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN (
        'staged',      -- Uploaded, awaiting review
        'committed',   -- Desktop reviewed and posted to inventory
        'rejected',    -- Desktop rejected
        'superseded'   -- Newer submission exists
    )),
    
    -- Evidence: JSONB array of tag reads
    tag_evidence JSONB NOT NULL, -- [{epc, first_seen_at, last_seen_at, seen_count, avg_rssi}]
    
    -- Summary stats
    unique_epcs_count INTEGER,
    total_reads INTEGER,
    recognized_tags INTEGER, -- EPCs that matched known tags
    unrecognized_epcs INTEGER, -- EPCs not in rfid_tags table
    
    -- Review/commit
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES auth.users(id),
    review_notes TEXT,
    committed_at TIMESTAMPTZ,
    committed_by UUID REFERENCES auth.users(id),
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT rfid_cycle_count_submissions_idempotent 
        UNIQUE (tenant_id, device_id, client_submission_id)
);

-- Indexes
CREATE INDEX idx_rfid_submissions_idempotent 
    ON inventory.rfid_cycle_count_submissions(tenant_id, device_id, client_submission_id);
CREATE INDEX idx_rfid_submissions_cycle_count 
    ON inventory.rfid_cycle_count_submissions(cycle_count_id, status);
CREATE INDEX idx_rfid_submissions_device 
    ON inventory.rfid_cycle_count_submissions(device_id, created_at DESC);
CREATE INDEX idx_rfid_submissions_status_review 
    ON inventory.rfid_cycle_count_submissions(tenant_id, status, created_at) 
    WHERE status = 'staged';

-- GIN index for JSONB searches
CREATE INDEX idx_rfid_submissions_tag_evidence 
    ON inventory.rfid_cycle_count_submissions USING GIN (tag_evidence);

-- Enable RLS
ALTER TABLE inventory.rfid_cycle_count_submissions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY rfid_submissions_tenant_isolation 
    ON inventory.rfid_cycle_count_submissions
    FOR ALL
    TO authenticated
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY rfid_submissions_service_role 
    ON inventory.rfid_cycle_count_submissions
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- Audit trigger
CREATE TRIGGER update_rfid_submissions_updated_at
    BEFORE UPDATE ON inventory.rfid_cycle_count_submissions
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- Comments
COMMENT ON TABLE inventory.rfid_cycle_count_submissions IS 'Staged RFID cycle count uploads from handheld devices - awaiting desktop review/commit';
COMMENT ON COLUMN inventory.rfid_cycle_count_submissions.client_submission_id IS 'Device-generated UUID for idempotency - safe to retry uploads';
COMMENT ON COLUMN inventory.rfid_cycle_count_submissions.tag_evidence IS 'JSONB array: [{epc, first_seen_at, last_seen_at, seen_count, avg_rssi}]';
COMMENT ON COLUMN inventory.rfid_cycle_count_submissions.power_mode_used IS 'PRIMARY power mode: LOW/MED/HIGH - see power_mode_changes for switches';

-- ============================================================================
-- STEP 6: Create EPC Capture Events (Desktop Assignment Workflow)
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.rfid_epc_captures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    
    device_id UUID NOT NULL REFERENCES inventory.rfid_devices(id) ON DELETE RESTRICT,
    epc TEXT NOT NULL,
    rssi INTEGER,
    
    -- Context: What triggered this capture
    capture_context TEXT CHECK (capture_context IN (
        'asset_assignment',
        'bulk_assignment',
        'verification',
        'adhoc'
    )),
    
    -- Session (for multi-scan workflows)
    session_id UUID,
    
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    captured_by UUID REFERENCES auth.users(id),
    
    -- Resolved tag (if known)
    resolved_tag_id UUID REFERENCES inventory.rfid_tags(id),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_rfid_captures_tenant_time 
    ON inventory.rfid_epc_captures(tenant_id, captured_at DESC);
CREATE INDEX idx_rfid_captures_device 
    ON inventory.rfid_epc_captures(device_id, captured_at DESC);
CREATE INDEX idx_rfid_captures_session 
    ON inventory.rfid_epc_captures(session_id, captured_at) 
    WHERE session_id IS NOT NULL;
CREATE INDEX idx_rfid_captures_epc 
    ON inventory.rfid_epc_captures(tenant_id, epc, captured_at DESC);

-- Enable RLS
ALTER TABLE inventory.rfid_epc_captures ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY rfid_captures_tenant_isolation 
    ON inventory.rfid_epc_captures
    FOR ALL
    TO authenticated
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY rfid_captures_service_role 
    ON inventory.rfid_epc_captures
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- Comments
COMMENT ON TABLE inventory.rfid_epc_captures IS 'EPC capture events for desktop-driven assignment workflows - device acts as scanner';
COMMENT ON COLUMN inventory.rfid_epc_captures.session_id IS 'Links multiple captures in same assignment session (e.g., bulk assignment)';

-- ============================================================================
-- STEP 7: Create Portal Observations (Raw Reader Data)
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.rfid_portal_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    
    device_id UUID NOT NULL REFERENCES inventory.rfid_devices(id) ON DELETE RESTRICT,
    epc TEXT NOT NULL,
    
    observed_at TIMESTAMPTZ NOT NULL,
    rssi INTEGER,
    antenna_id INTEGER, -- Which antenna on multi-antenna portal
    read_count INTEGER DEFAULT 1,
    
    -- Batching: device can send batch of reads
    batch_id UUID, -- Device-generated batch identifier
    batch_sequence INTEGER, -- Order within batch
    
    -- Derived movement (processed async)
    movement_event_id UUID, -- Link to derived movement event
    processed_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_portal_obs_device_time 
    ON inventory.rfid_portal_observations(device_id, observed_at DESC);
CREATE INDEX idx_portal_obs_epc_time 
    ON inventory.rfid_portal_observations(tenant_id, epc, observed_at DESC);
CREATE INDEX idx_portal_obs_unprocessed 
    ON inventory.rfid_portal_observations(tenant_id, observed_at) 
    WHERE processed_at IS NULL;
CREATE INDEX idx_portal_obs_batch 
    ON inventory.rfid_portal_observations(batch_id, batch_sequence) 
    WHERE batch_id IS NOT NULL;

-- Enable RLS
ALTER TABLE inventory.rfid_portal_observations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY rfid_portal_obs_tenant_isolation 
    ON inventory.rfid_portal_observations
    FOR SELECT
    TO authenticated
    USING (tenant_id = current_tenant_id());

CREATE POLICY rfid_portal_obs_service_role 
    ON inventory.rfid_portal_observations
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- Comments
COMMENT ON TABLE inventory.rfid_portal_observations IS 'Raw RFID observations from fixed portal readers - processed async into movement events';
COMMENT ON COLUMN inventory.rfid_portal_observations.batch_id IS 'Device-generated batch ID for grouping simultaneous reads';

-- ============================================================================
-- STEP 8: Create Portal Movement Events (Derived from Observations)
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.rfid_portal_movement_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    
    -- Device & Tag
    portal_device_id UUID NOT NULL REFERENCES inventory.rfid_devices(id) ON DELETE RESTRICT,
    epc TEXT NOT NULL,
    tag_id UUID REFERENCES inventory.rfid_tags(id), -- Resolved tag
    
    -- Movement
    movement_type TEXT NOT NULL CHECK (movement_type IN ('entered', 'exited', 'passed')),
    location_id UUID NOT NULL REFERENCES inventory.locations(id) ON DELETE RESTRICT,
    
    -- Confidence
    confidence_score NUMERIC(3,2) CHECK (confidence_score BETWEEN 0 AND 1),
    confidence_reason TEXT,
    
    -- Time window
    event_time TIMESTAMPTZ NOT NULL, -- Derived event time
    first_observation_time TIMESTAMPTZ NOT NULL,
    last_observation_time TIMESTAMPTZ NOT NULL,
    observation_count INTEGER NOT NULL,
    
    -- Evidence
    observation_ids UUID[], -- Array of observation record IDs
    avg_rssi INTEGER,
    primary_antenna_id INTEGER,
    
    -- Lifecycle
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',      -- Detected but not confirmed
        'confirmed',    -- Desktop approved
        'rejected',     -- Desktop rejected
        'auto_applied'  -- Auto-applied by rules
    )),
    
    -- Application to inventory
    applied_at TIMESTAMPTZ,
    applied_by UUID REFERENCES auth.users(id),
    inventory_movement_id UUID, -- Link to stock_movements or asset_events
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_event_id TEXT
);

-- Indexes
CREATE INDEX idx_portal_events_portal_time 
    ON inventory.rfid_portal_movement_events(portal_device_id, event_time DESC);
CREATE INDEX idx_portal_events_epc_time 
    ON inventory.rfid_portal_movement_events(tenant_id, epc, event_time DESC);
CREATE INDEX idx_portal_events_location_time 
    ON inventory.rfid_portal_movement_events(location_id, event_time DESC);
CREATE INDEX idx_portal_events_status_pending 
    ON inventory.rfid_portal_movement_events(tenant_id, status, event_time) 
    WHERE status = 'pending';
CREATE INDEX idx_portal_events_tag_id 
    ON inventory.rfid_portal_movement_events(tag_id, event_time DESC) 
    WHERE tag_id IS NOT NULL;

-- Enable RLS
ALTER TABLE inventory.rfid_portal_movement_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY rfid_portal_events_tenant_isolation 
    ON inventory.rfid_portal_movement_events
    FOR ALL
    TO authenticated
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY rfid_portal_events_service_role 
    ON inventory.rfid_portal_movement_events
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- Audit trigger
CREATE TRIGGER update_portal_events_updated_at
    BEFORE UPDATE ON inventory.rfid_portal_movement_events
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- Comments
COMMENT ON TABLE inventory.rfid_portal_movement_events IS 'Derived movement events from portal observations - entered/exited/passed through location';
COMMENT ON COLUMN inventory.rfid_portal_movement_events.confidence_score IS 'Confidence 0-1 based on observation count, duration, RSSI, antenna patterns';
COMMENT ON COLUMN inventory.rfid_portal_movement_events.observation_ids IS 'Array of raw observation IDs used to derive this event';

-- ============================================================================
-- Migration Complete
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '╔═══════════════════════════════════════════════════════════════════╗';
    RAISE NOTICE '║   RFID Infrastructure Migration Complete                         ║';
    RAISE NOTICE '╚═══════════════════════════════════════════════════════════════════╝';
    RAISE NOTICE '';
    RAISE NOTICE '✓ Created 8 new tables:';
    RAISE NOTICE '    1. rfid_devices (device registry & auth)';
    RAISE NOTICE '    2. rfid_tags (tag identity & assignment)';
    RAISE NOTICE '    3. rfid_tag_assignment_history (audit trail)';
    RAISE NOTICE '    4. rfid_bulk_assignment_sessions (pooled tags)';
    RAISE NOTICE '    5. rfid_cycle_count_submissions (staged uploads)';
    RAISE NOTICE '    6. rfid_epc_captures (desktop assignment)';
    RAISE NOTICE '    7. rfid_portal_observations (raw portal data)';
    RAISE NOTICE '    8. rfid_portal_movement_events (derived movements)';
    RAISE NOTICE '';
    RAISE NOTICE '✓ Applied RLS policies to all tables';
    RAISE NOTICE '✓ Created performance-optimized indexes';
    RAISE NOTICE '✓ Added audit triggers';
    RAISE NOTICE '';
    RAISE NOTICE 'Integrates with existing:';
    RAISE NOTICE '  - cycle_counts (requests from desktop)';
    RAISE NOTICE '  - assets (serialized inventory)';
    RAISE NOTICE '  - catalog_items (bulk items)';
    RAISE NOTICE '  - locations (installation & scope)';
    RAISE NOTICE '  - events_outbox (event emission)';
    RAISE NOTICE '';
    RAISE NOTICE 'Next Steps:';
    RAISE NOTICE '  1. Register RFID events in event_definitions';
    RAISE NOTICE '  2. Implement device API endpoints (RPC functions)';
    RAISE NOTICE '  3. Create device authentication middleware';
    RAISE NOTICE '  4. Build desktop review/commit UI';
    RAISE NOTICE '';
END $$;
