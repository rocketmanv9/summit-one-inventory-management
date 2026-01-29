-- ============================================================================
-- Cycle Count Events - Event Catalog Registration
-- ============================================================================
-- Purpose: Register all cycle count events in the event catalog
-- Date: 2026-01-28
-- Dependencies: Requires public.event_definitions table
-- ============================================================================

-- ============================================================================
-- Register Cycle Count Events
-- ============================================================================

-- Event 1: inventory.cycle_count.created
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.cycle_count.created',
    1,
    'inventory',
    'Emitted when a new cycle count is created in draft or scheduled status',
    '{
        "type": "object",
        "required": ["cycle_count_id", "tenant_id", "count_number", "location_id", "count_type"],
        "properties": {
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "count_number": {"type": "string"},
            "location_id": {"type": "string", "format": "uuid"},
            "count_type": {"type": "string", "enum": ["full", "partial"]},
            "is_blind": {"type": "boolean"},
            "scheduled_for": {"type": "string", "format": "date"},
            "created_by_user_id": {"type": "string", "format": "uuid"}
        }
    }'::jsonb,
    '{
        "cycle_count_id": "550e8400-e29b-41d4-a716-446655440001",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "count_number": "CC-2026-001",
        "location_id": "550e8400-e29b-41d4-a716-446655440010",
        "count_type": "full",
        "is_blind": false,
        "scheduled_for": "2026-01-30",
        "created_by_user_id": "550e8400-e29b-41d4-a716-446655440020"
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    version = EXCLUDED.version,
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 2: inventory.cycle_count.started
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.cycle_count.started',
    1,
    'inventory',
    'Emitted when cycle count transitions to in_progress and snapshot is captured',
    '{
        "type": "object",
        "required": ["cycle_count_id", "tenant_id", "snapshot_at"],
        "properties": {
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "snapshot_at": {"type": "string", "format": "date-time"},
            "started_by_user_id": {"type": "string", "format": "uuid"},
            "skus_snapshotted": {"type": "integer"},
            "assets_snapshotted": {"type": "integer"}
        }
    }'::jsonb,
    '{
        "cycle_count_id": "550e8400-e29b-41d4-a716-446655440001",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "snapshot_at": "2026-01-28T10:00:00Z",
        "started_by_user_id": "550e8400-e29b-41d4-a716-446655440020",
        "skus_snapshotted": 45,
        "assets_snapshotted": 12
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    version = EXCLUDED.version,
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 3: inventory.cycle_count.snapshot_captured
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.cycle_count.snapshot_captured',
    1,
    'inventory',
    'Emitted when snapshot tables are populated with expected state',
    '{
        "type": "object",
        "required": ["cycle_count_id", "tenant_id", "snapshot_at"],
        "properties": {
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "snapshot_at": {"type": "string", "format": "date-time"},
            "location_id": {"type": "string", "format": "uuid"},
            "skus_count": {"type": "integer"},
            "assets_count": {"type": "integer"}
        }
    }'::jsonb,
    '{
        "cycle_count_id": "550e8400-e29b-41d4-a716-446655440001",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "snapshot_at": "2026-01-28T10:00:00Z",
        "location_id": "550e8400-e29b-41d4-a716-446655440010",
        "skus_count": 45,
        "assets_count": 12
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    version = EXCLUDED.version,
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 4: inventory.cycle_count.line_counted
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.cycle_count.line_counted',
    1,
    'inventory',
    'Emitted when a cycle count line (SKU) is counted. Note: Can be chatty for large counts.',
    '{
        "type": "object",
        "required": ["cycle_count_id", "line_id", "tenant_id", "catalog_item_id"],
        "properties": {
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "line_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "catalog_item_id": {"type": "string", "format": "uuid"},
            "qty_expected": {"type": "number"},
            "qty_counted": {"type": "number"},
            "variance": {"type": "number"},
            "counted_by_user_id": {"type": "string", "format": "uuid"},
            "counted_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "cycle_count_id": "550e8400-e29b-41d4-a716-446655440001",
        "line_id": "550e8400-e29b-41d4-a716-446655440002",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "catalog_item_id": "550e8400-e29b-41d4-a716-446655440030",
        "qty_expected": 100,
        "qty_counted": 98,
        "variance": -2,
        "counted_by_user_id": "550e8400-e29b-41d4-a716-446655440020",
        "counted_at": "2026-01-28T10:15:00Z"
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    version = EXCLUDED.version,
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 5: inventory.cycle_count.asset_scanned
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.cycle_count.asset_scanned',
    1,
    'inventory',
    'Emitted when a serialized asset is scanned during cycle count',
    '{
        "type": "object",
        "required": ["cycle_count_id", "asset_line_id", "tenant_id", "asset_id"],
        "properties": {
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "asset_line_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "asset_id": {"type": "string", "format": "uuid"},
            "expected_present": {"type": "boolean"},
            "counted_present": {"type": "boolean"},
            "status": {"type": "string", "enum": ["matched", "missing", "unexpected"]},
            "scanned_by_user_id": {"type": "string", "format": "uuid"},
            "scanned_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "cycle_count_id": "550e8400-e29b-41d4-a716-446655440001",
        "asset_line_id": "550e8400-e29b-41d4-a716-446655440003",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "asset_id": "550e8400-e29b-41d4-a716-446655440040",
        "expected_present": true,
        "counted_present": true,
        "status": "matched",
        "scanned_by_user_id": "550e8400-e29b-41d4-a716-446655440020",
        "scanned_at": "2026-01-28T10:20:00Z"
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    version = EXCLUDED.version,
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 6: inventory.cycle_count.submitted_for_review
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.cycle_count.submitted_for_review',
    1,
    'inventory',
    'Emitted when cycle count is submitted for approval review',
    '{
        "type": "object",
        "required": ["cycle_count_id", "tenant_id"],
        "properties": {
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "submitted_by_user_id": {"type": "string", "format": "uuid"},
            "submitted_at": {"type": "string", "format": "date-time"},
            "total_variances": {"type": "integer"},
            "requires_approval": {"type": "boolean"}
        }
    }'::jsonb,
    '{
        "cycle_count_id": "550e8400-e29b-41d4-a716-446655440001",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "submitted_by_user_id": "550e8400-e29b-41d4-a716-446655440020",
        "submitted_at": "2026-01-28T11:00:00Z",
        "total_variances": 5,
        "requires_approval": true
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    version = EXCLUDED.version,
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 7: inventory.cycle_count.approved
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.cycle_count.approved',
    1,
    'inventory',
    'Emitted when cycle count is approved for posting',
    '{
        "type": "object",
        "required": ["cycle_count_id", "tenant_id", "approved_at"],
        "properties": {
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "approved_by_user_id": {"type": "string", "format": "uuid"},
            "approved_at": {"type": "string", "format": "date-time"},
            "approval_notes": {"type": "string"},
            "auto_approved": {"type": "boolean"}
        }
    }'::jsonb,
    '{
        "cycle_count_id": "550e8400-e29b-41d4-a716-446655440001",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "approved_by_user_id": "550e8400-e29b-41d4-a716-446655440025",
        "approved_at": "2026-01-28T11:30:00Z",
        "approval_notes": "Variances reviewed and approved",
        "auto_approved": false
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    version = EXCLUDED.version,
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 8: inventory.cycle_count.posted
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.cycle_count.posted',
    1,
    'inventory',
    'Emitted when cycle count adjustments are posted to inventory',
    '{
        "type": "object",
        "required": ["cycle_count_id", "tenant_id", "posted_at"],
        "properties": {
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "posted_at": {"type": "string", "format": "date-time"},
            "posted_by_user_id": {"type": "string", "format": "uuid"},
            "adjustments_created": {"type": "integer"},
            "correlation_id": {"type": "string", "format": "uuid"}
        }
    }'::jsonb,
    '{
        "cycle_count_id": "550e8400-e29b-41d4-a716-446655440001",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "posted_at": "2026-01-28T11:35:00Z",
        "posted_by_user_id": "550e8400-e29b-41d4-a716-446655440025",
        "adjustments_created": 5,
        "correlation_id": "550e8400-e29b-41d4-a716-446655440050"
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    version = EXCLUDED.version,
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 9: inventory.cycle_count.adjustments_created
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.cycle_count.adjustments_created',
    1,
    'inventory',
    'Emitted when stock movements (adjustments) are created from cycle count. Includes batch details.',
    '{
        "type": "object",
        "required": ["cycle_count_id", "tenant_id", "correlation_id"],
        "properties": {
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "correlation_id": {"type": "string", "format": "uuid"},
            "adjustments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "movement_id": {"type": "string", "format": "uuid"},
                        "catalog_item_id": {"type": "string", "format": "uuid"},
                        "location_id": {"type": "string", "format": "uuid"},
                        "quantity_delta": {"type": "number"}
                    }
                }
            }
        }
    }'::jsonb,
    '{
        "cycle_count_id": "550e8400-e29b-41d4-a716-446655440001",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "correlation_id": "550e8400-e29b-41d4-a716-446655440050",
        "adjustments": [
            {
                "movement_id": "550e8400-e29b-41d4-a716-446655440060",
                "catalog_item_id": "550e8400-e29b-41d4-a716-446655440030",
                "location_id": "550e8400-e29b-41d4-a716-446655440010",
                "quantity_delta": -2
            }
        ]
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    version = EXCLUDED.version,
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 10: inventory.cycle_count.closed
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.cycle_count.closed',
    1,
    'inventory',
    'Emitted when cycle count is closed and becomes immutable',
    '{
        "type": "object",
        "required": ["cycle_count_id", "tenant_id", "closed_at"],
        "properties": {
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "closed_at": {"type": "string", "format": "date-time"},
            "closed_by_user_id": {"type": "string", "format": "uuid"}
        }
    }'::jsonb,
    '{
        "cycle_count_id": "550e8400-e29b-41d4-a716-446655440001",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "closed_at": "2026-01-28T12:00:00Z",
        "closed_by_user_id": "550e8400-e29b-41d4-a716-446655440025"
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    version = EXCLUDED.version,
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 11: inventory.cycle_count.cancelled
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.cycle_count.cancelled',
    1,
    'inventory',
    'Emitted when cycle count is cancelled before posting',
    '{
        "type": "object",
        "required": ["cycle_count_id", "tenant_id", "cancelled_at"],
        "properties": {
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "cancelled_at": {"type": "string", "format": "date-time"},
            "cancelled_by_user_id": {"type": "string", "format": "uuid"},
            "cancellation_reason": {"type": "string"}
        }
    }'::jsonb,
    '{
        "cycle_count_id": "550e8400-e29b-41d4-a716-446655440001",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "cancelled_at": "2026-01-28T10:30:00Z",
        "cancelled_by_user_id": "550e8400-e29b-41d4-a716-446655440020",
        "cancellation_reason": "Location changed during count"
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    version = EXCLUDED.version,
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- Event 12: inventory.stock.adjusted (if not exists)
-- Note: This event may already exist for general adjustments
-- We include it here to ensure it's registered for cycle count use case
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES (
    'inventory.stock.adjusted',
    1,
    'inventory',
    'Emitted when stock quantity is adjusted via cycle count, manual adjustment, or damage',
    '{
        "type": "object",
        "required": ["movement_id", "tenant_id", "catalog_item_id", "location_id", "quantity_delta"],
        "properties": {
            "movement_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "catalog_item_id": {"type": "string", "format": "uuid"},
            "location_id": {"type": "string", "format": "uuid"},
            "quantity_delta": {"type": "number"},
            "reason": {"type": "string"},
            "source_ref_type": {"type": "string"},
            "source_ref_id": {"type": "string", "format": "uuid"}
        }
    }'::jsonb,
    '{
        "movement_id": "550e8400-e29b-41d4-a716-446655440060",
        "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
        "catalog_item_id": "550e8400-e29b-41d4-a716-446655440030",
        "location_id": "550e8400-e29b-41d4-a716-446655440010",
        "quantity_delta": -2,
        "reason": "Cycle count adjustment",
        "source_ref_type": "cycle_count",
        "source_ref_id": "550e8400-e29b-41d4-a716-446655440001"
    }'::jsonb,
    'active'
) ON CONFLICT (event_name, version) DO UPDATE SET
    version = EXCLUDED.version,
    description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema,
    example_payload = EXCLUDED.example_payload,
    status = EXCLUDED.status,
    updated_at = NOW();

-- ============================================================================
-- Verification Query
-- ============================================================================

DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM public.event_definitions
    WHERE event_name LIKE 'inventory.cycle_count.%'
        OR event_name = 'inventory.stock.adjusted';
    
    RAISE NOTICE '';
    RAISE NOTICE '╔═══════════════════════════════════════════════════════════════════╗';
    RAISE NOTICE '║   Cycle Count Events Registered                                   ║';
    RAISE NOTICE '╚═══════════════════════════════════════════════════════════════════╝';
    RAISE NOTICE '';
    RAISE NOTICE '✓ Registered % cycle count events', v_count;
    RAISE NOTICE '';
    RAISE NOTICE 'Events:';
    RAISE NOTICE '  1. inventory.cycle_count.created';
    RAISE NOTICE '  2. inventory.cycle_count.started';
    RAISE NOTICE '  3. inventory.cycle_count.snapshot_captured';
    RAISE NOTICE '  4. inventory.cycle_count.line_counted';
    RAISE NOTICE '  5. inventory.cycle_count.asset_scanned';
    RAISE NOTICE '  6. inventory.cycle_count.submitted_for_review';
    RAISE NOTICE '  7. inventory.cycle_count.approved';
    RAISE NOTICE '  8. inventory.cycle_count.posted';
    RAISE NOTICE '  9. inventory.cycle_count.adjustments_created';
    RAISE NOTICE '  10. inventory.cycle_count.closed';
    RAISE NOTICE '  11. inventory.cycle_count.cancelled';
    RAISE NOTICE '  12. inventory.stock.adjusted';
    RAISE NOTICE '';
    RAISE NOTICE 'Verify with: SELECT event_name, version, status FROM public.event_definitions WHERE event_name LIKE ''inventory.cycle_count.%%'';';
    RAISE NOTICE '';
END $$;
