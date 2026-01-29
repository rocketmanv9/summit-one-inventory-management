-- ============================================================================
-- RFID Events - Event Catalog Registration
-- ============================================================================
-- Purpose: Register all RFID-related events in the event catalog
-- Date: 2026-01-28
-- Dependencies: Requires public.event_definitions table
-- ============================================================================

-- Event 1: inventory.rfid.device_registered
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.rfid.device_registered',
    1,
    'inventory',
    'Emitted when a new RFID device is registered in the system',
    '{
        "type": "object",
        "required": ["device_id", "tenant_id", "device_code", "device_type"],
        "properties": {
            "device_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "device_code": {"type": "string"},
            "device_type": {"type": "string"},
            "scopes": {"type": "array", "items": {"type": "string"}},
            "registered_by": {"type": "string", "format": "uuid"}
        }
    }'::jsonb,
    '{
        "device_id": "550e8400-e29b-41d4-a716-446655440001",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "device_code": "scanner-01",
        "device_type": "handheld_cycle_count",
        "scopes": ["cycle_count:sync", "cycle_count:submit", "device:heartbeat"],
        "registered_by": "550e8400-e29b-41d4-a716-446655440020"
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 2: inventory.rfid.device_heartbeat
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.rfid.device_heartbeat',
    1,
    'inventory',
    'Emitted when device checks in (telemetry update)',
    '{
        "type": "object",
        "required": ["device_id", "tenant_id", "heartbeat_at"],
        "properties": {
            "device_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "heartbeat_at": {"type": "string", "format": "date-time"},
            "firmware_version": {"type": "string"},
            "app_version": {"type": "string"},
            "battery_level": {"type": "number"},
            "ip_address": {"type": "string"}
        }
    }'::jsonb,
    '{
        "device_id": "550e8400-e29b-41d4-a716-446655440001",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "heartbeat_at": "2026-01-28T14:30:00Z",
        "firmware_version": "v2.1.0",
        "app_version": "v1.5.2",
        "battery_level": 75,
        "ip_address": "192.168.1.100"
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 3: inventory.rfid.tag_assigned
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.rfid.tag_assigned',
    1,
    'inventory',
    'Emitted when RFID tag is assigned to asset or item type',
    '{
        "type": "object",
        "required": ["tag_id", "tenant_id", "epc", "tag_category"],
        "properties": {
            "tag_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "epc": {"type": "string"},
            "tag_category": {"type": "string", "enum": ["asset_tag", "bulk_item_tag"]},
            "asset_id": {"type": "string", "format": "uuid"},
            "bulk_catalog_item_id": {"type": "string", "format": "uuid"},
            "assigned_by": {"type": "string", "format": "uuid"},
            "assigned_via_device_id": {"type": "string", "format": "uuid"},
            "assigned_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "tag_id": "550e8400-e29b-41d4-a716-446655440002",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "epc": "3034257BF7194E4000003039",
        "tag_category": "asset_tag",
        "asset_id": "550e8400-e29b-41d4-a716-446655440050",
        "assigned_by": "550e8400-e29b-41d4-a716-446655440020",
        "assigned_via_device_id": "550e8400-e29b-41d4-a716-446655440001",
        "assigned_at": "2026-01-28T10:15:00Z"
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 4: inventory.rfid.tag_reassigned
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.rfid.tag_reassigned',
    1,
    'inventory',
    'Emitted when RFID tag is reassigned from one asset/item to another',
    '{
        "type": "object",
        "required": ["tag_id", "tenant_id", "epc"],
        "properties": {
            "tag_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "epc": {"type": "string"},
            "previous_asset_id": {"type": "string", "format": "uuid"},
            "new_asset_id": {"type": "string", "format": "uuid"},
            "previous_catalog_item_id": {"type": "string", "format": "uuid"},
            "new_catalog_item_id": {"type": "string", "format": "uuid"},
            "reason": {"type": "string"},
            "reassigned_by": {"type": "string", "format": "uuid"}
        }
    }'::jsonb,
    '{
        "tag_id": "550e8400-e29b-41d4-a716-446655440002",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "epc": "3034257BF7194E4000003039",
        "previous_asset_id": "550e8400-e29b-41d4-a716-446655440050",
        "new_asset_id": "550e8400-e29b-41d4-a716-446655440051",
        "reason": "Asset transferred",
        "reassigned_by": "550e8400-e29b-41d4-a716-446655440020"
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 5: inventory.rfid.tag_retired
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.rfid.tag_retired',
    1,
    'inventory',
    'Emitted when RFID tag is retired from active use',
    '{
        "type": "object",
        "required": ["tag_id", "tenant_id", "epc", "reason"],
        "properties": {
            "tag_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "epc": {"type": "string"},
            "reason": {"type": "string"},
            "retired_by": {"type": "string", "format": "uuid"},
            "retired_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "tag_id": "550e8400-e29b-41d4-a716-446655440002",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "epc": "3034257BF7194E4000003039",
        "reason": "Tag damaged",
        "retired_by": "550e8400-e29b-41d4-a716-446655440020",
        "retired_at": "2026-01-28T15:00:00Z"
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 6: inventory.rfid.cycle_count_submission_uploaded
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.rfid.cycle_count_submission_uploaded',
    1,
    'inventory',
    'Emitted when handheld device uploads staged cycle count results',
    '{
        "type": "object",
        "required": ["submission_id", "tenant_id", "device_id", "cycle_count_id"],
        "properties": {
            "submission_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "device_id": {"type": "string", "format": "uuid"},
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "client_submission_id": {"type": "string", "format": "uuid"},
            "unique_epcs_count": {"type": "integer"},
            "total_reads": {"type": "integer"},
            "duration_seconds": {"type": "integer"},
            "power_mode_used": {"type": "string"}
        }
    }'::jsonb,
    '{
        "submission_id": "550e8400-e29b-41d4-a716-446655440010",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "device_id": "550e8400-e29b-41d4-a716-446655440001",
        "cycle_count_id": "550e8400-e29b-41d4-a716-446655440100",
        "client_submission_id": "550e8400-e29b-41d4-a716-446655440011",
        "unique_epcs_count": 45,
        "total_reads": 287,
        "duration_seconds": 320,
        "power_mode_used": "MED"
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 7: inventory.rfid.cycle_count_submission_committed
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.rfid.cycle_count_submission_committed',
    1,
    'inventory',
    'Emitted when desktop user reviews and commits cycle count submission to inventory',
    '{
        "type": "object",
        "required": ["submission_id", "tenant_id", "cycle_count_id", "committed_at"],
        "properties": {
            "submission_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "committed_at": {"type": "string", "format": "date-time"},
            "committed_by": {"type": "string", "format": "uuid"},
            "recognized_tags": {"type": "integer"},
            "unrecognized_epcs": {"type": "integer"},
            "adjustments_created": {"type": "integer"}
        }
    }'::jsonb,
    '{
        "submission_id": "550e8400-e29b-41d4-a716-446655440010",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "cycle_count_id": "550e8400-e29b-41d4-a716-446655440100",
        "committed_at": "2026-01-28T16:30:00Z",
        "committed_by": "550e8400-e29b-41d4-a716-446655440020",
        "recognized_tags": 42,
        "unrecognized_epcs": 3,
        "adjustments_created": 5
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 8: inventory.rfid.bulk_assignment_session_completed
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.rfid.bulk_assignment_session_completed',
    1,
    'inventory',
    'Emitted when bulk tag assignment session is finalized',
    '{
        "type": "object",
        "required": ["session_id", "tenant_id", "catalog_item_id", "tag_count"],
        "properties": {
            "session_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "session_number": {"type": "string"},
            "catalog_item_id": {"type": "string", "format": "uuid"},
            "tag_count": {"type": "integer"},
            "started_by": {"type": "string", "format": "uuid"},
            "completed_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "session_id": "550e8400-e29b-41d4-a716-446655440030",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "session_number": "BULK-2026-001",
        "catalog_item_id": "550e8400-e29b-41d4-a716-446655440060",
        "tag_count": 100,
        "started_by": "550e8400-e29b-41d4-a716-446655440020",
        "completed_at": "2026-01-28T12:00:00Z"
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 9: inventory.rfid.portal_observation_received
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.rfid.portal_observation_received',
    1,
    'inventory',
    'Emitted when portal reader submits raw RFID observation',
    '{
        "type": "object",
        "required": ["observation_id", "tenant_id", "device_id", "epc", "observed_at"],
        "properties": {
            "observation_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "device_id": {"type": "string", "format": "uuid"},
            "epc": {"type": "string"},
            "observed_at": {"type": "string", "format": "date-time"},
            "rssi": {"type": "integer"},
            "antenna_id": {"type": "integer"},
            "batch_id": {"type": "string", "format": "uuid"}
        }
    }'::jsonb,
    '{
        "observation_id": "550e8400-e29b-41d4-a716-446655440070",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "device_id": "550e8400-e29b-41d4-a716-446655440005",
        "epc": "3034257BF7194E4000003039",
        "observed_at": "2026-01-28T13:45:22Z",
        "rssi": -45,
        "antenna_id": 1,
        "batch_id": "550e8400-e29b-41d4-a716-446655440071"
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 10: inventory.rfid.portal_movement_derived
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.rfid.portal_movement_derived',
    1,
    'inventory',
    'Emitted when movement event is derived from portal observations',
    '{
        "type": "object",
        "required": ["movement_event_id", "tenant_id", "epc", "movement_type", "location_id"],
        "properties": {
            "movement_event_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "portal_device_id": {"type": "string", "format": "uuid"},
            "epc": {"type": "string"},
            "tag_id": {"type": "string", "format": "uuid"},
            "movement_type": {"type": "string", "enum": ["entered", "exited", "passed"]},
            "location_id": {"type": "string", "format": "uuid"},
            "confidence_score": {"type": "number"},
            "observation_count": {"type": "integer"},
            "event_time": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "movement_event_id": "550e8400-e29b-41d4-a716-446655440080",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "portal_device_id": "550e8400-e29b-41d4-a716-446655440005",
        "epc": "3034257BF7194E4000003039",
        "tag_id": "550e8400-e29b-41d4-a716-446655440002",
        "movement_type": "entered",
        "location_id": "550e8400-e29b-41d4-a716-446655440090",
        "confidence_score": 0.95,
        "observation_count": 12,
        "event_time": "2026-01-28T13:45:30Z"
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 11: inventory.rfid.portal_movement_applied
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.rfid.portal_movement_applied',
    1,
    'inventory',
    'Emitted when portal movement event is applied to inventory',
    '{
        "type": "object",
        "required": ["movement_event_id", "tenant_id", "applied_at"],
        "properties": {
            "movement_event_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "applied_at": {"type": "string", "format": "date-time"},
            "applied_by": {"type": "string", "format": "uuid"},
            "inventory_movement_id": {"type": "string", "format": "uuid"},
            "asset_id": {"type": "string", "format": "uuid"},
            "new_location_id": {"type": "string", "format": "uuid"}
        }
    }'::jsonb,
    '{
        "movement_event_id": "550e8400-e29b-41d4-a716-446655440080",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "applied_at": "2026-01-28T14:00:00Z",
        "applied_by": "550e8400-e29b-41d4-a716-446655440020",
        "inventory_movement_id": "550e8400-e29b-41d4-a716-446655440085",
        "asset_id": "550e8400-e29b-41d4-a716-446655440050",
        "new_location_id": "550e8400-e29b-41d4-a716-446655440090"
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM public.event_definitions
    WHERE event_name LIKE 'inventory.rfid.%';
    
    RAISE NOTICE '';
    RAISE NOTICE '╔═══════════════════════════════════════════════════════════════════╗';
    RAISE NOTICE '║   RFID Events Registered                                          ║';
    RAISE NOTICE '╚═══════════════════════════════════════════════════════════════════╝';
    RAISE NOTICE '';
    RAISE NOTICE '✓ Registered % RFID events', v_count;
    RAISE NOTICE '';
    RAISE NOTICE 'Events:';
    RAISE NOTICE '  1. inventory.rfid.device_registered';
    RAISE NOTICE '  2. inventory.rfid.device_heartbeat';
    RAISE NOTICE '  3. inventory.rfid.tag_assigned';
    RAISE NOTICE '  4. inventory.rfid.tag_reassigned';
    RAISE NOTICE '  5. inventory.rfid.tag_retired';
    RAISE NOTICE '  6. inventory.rfid.cycle_count_submission_uploaded';
    RAISE NOTICE '  7. inventory.rfid.cycle_count_submission_committed';
    RAISE NOTICE '  8. inventory.rfid.bulk_assignment_session_completed';
    RAISE NOTICE '  9. inventory.rfid.portal_observation_received';
    RAISE NOTICE '  10. inventory.rfid.portal_movement_derived';
    RAISE NOTICE '  11. inventory.rfid.portal_movement_applied';
    RAISE NOTICE '';
END $$;
