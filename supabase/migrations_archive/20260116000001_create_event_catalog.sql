-- ================================================================
-- Event Catalog System
-- ================================================================
-- Purpose: Single source of truth for all events in the system
-- Benefits:
--   - Documentation lives in the database
--   - Enforce event naming conventions
--   - Track versions and breaking changes
--   - Auto-generate docs
--   - Prevent drift between code and reality
-- ================================================================

-- ================================================================
-- Event Definitions (Registry)
-- ================================================================

CREATE TABLE IF NOT EXISTS public.event_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Event identity
    event_name TEXT NOT NULL,  -- e.g., 'inventory.receipt.created'
    version INTEGER NOT NULL DEFAULT 1,
    
    -- Metadata
    producer TEXT NOT NULL,  -- e.g., 'trigger_receipt_events' or 'receipts_service'
    description TEXT NOT NULL,
    
    -- Payload documentation
    payload_schema JSONB,  -- JSON Schema-like shape
    example_payload JSONB,
    
    -- Lifecycle
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'deprecated')),
    deprecation_reason TEXT,
    deprecated_at TIMESTAMPTZ,
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(event_name, version)
);

CREATE INDEX idx_event_definitions_name ON public.event_definitions(event_name);
CREATE INDEX idx_event_definitions_status ON public.event_definitions(status) WHERE status = 'active';
CREATE INDEX idx_event_definitions_created ON public.event_definitions(created_at DESC);

GRANT SELECT ON public.event_definitions TO authenticated;
GRANT ALL ON public.event_definitions TO service_role;

COMMENT ON TABLE public.event_definitions IS 'Event catalog - single source of truth for all events';
COMMENT ON COLUMN public.event_definitions.event_name IS 'Follows pattern: <domain>.<entity>.<verb>';
COMMENT ON COLUMN public.event_definitions.version IS 'Increment on breaking changes';
COMMENT ON COLUMN public.event_definitions.payload_schema IS 'JSON Schema describing payload structure';
COMMENT ON COLUMN public.event_definitions.example_payload IS 'Sample payload for documentation';

-- ================================================================
-- Event Consumers (Optional - for tracking who listens)
-- ================================================================

CREATE TABLE IF NOT EXISTS public.event_consumers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_name TEXT NOT NULL,
    consumer_name TEXT NOT NULL,  -- e.g., 'Core Service', 'Analytics Pipeline'
    consumer_type TEXT NOT NULL CHECK (consumer_type IN ('webhook', 'function', 'service')),
    endpoint_url TEXT,
    description TEXT,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(event_name, consumer_name)
);

CREATE INDEX idx_event_consumers_name ON public.event_consumers(event_name);
CREATE INDEX idx_event_consumers_active ON public.event_consumers(active) WHERE active = true;

GRANT SELECT ON public.event_consumers TO authenticated;
GRANT ALL ON public.event_consumers TO service_role;

COMMENT ON TABLE public.event_consumers IS 'Tracks which systems/services consume each event';

-- ================================================================
-- Add event catalog reference to outbox
-- ================================================================

-- Add columns to events_outbox for catalog reference
ALTER TABLE inventory.events_outbox
    ADD COLUMN IF NOT EXISTS event_name TEXT,
    ADD COLUMN IF NOT EXISTS event_version INTEGER DEFAULT 1;

-- Create index for querying by event name
CREATE INDEX IF NOT EXISTS idx_events_outbox_event_name 
    ON inventory.events_outbox(event_name);

-- Backfill existing records (map event_type to event_name)
UPDATE inventory.events_outbox
SET 
    event_name = event_type,
    event_version = 1
WHERE event_name IS NULL;

COMMENT ON COLUMN inventory.events_outbox.event_name IS 'References event_definitions.event_name';
COMMENT ON COLUMN inventory.events_outbox.event_version IS 'References event_definitions.version';

-- ================================================================
-- Helper function: Get event stats
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_event_catalog_stats()
RETURNS TABLE (
    event_name TEXT,
    version INTEGER,
    status TEXT,
    total_emitted BIGINT,
    last_emitted_at TIMESTAMPTZ,
    pending_count BIGINT,
    published_count BIGINT,
    failed_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ed.event_name,
        ed.version,
        ed.status,
        COUNT(eo.id) as total_emitted,
        MAX(eo.created_at) as last_emitted_at,
        COUNT(eo.id) FILTER (WHERE eo.status = 'pending') as pending_count,
        COUNT(eo.id) FILTER (WHERE eo.status = 'published') as published_count,
        COUNT(eo.id) FILTER (WHERE eo.status = 'failed') as failed_count
    FROM public.event_definitions ed
    LEFT JOIN inventory.events_outbox eo ON ed.event_name = eo.event_name AND ed.version = eo.event_version
    GROUP BY ed.event_name, ed.version, ed.status
    ORDER BY ed.event_name, ed.version DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_event_catalog_stats TO authenticated, service_role;

COMMENT ON FUNCTION public.get_event_catalog_stats IS 'Get statistics for each event in the catalog';

-- ================================================================
-- Helper function: Validate event exists in catalog
-- ================================================================

CREATE OR REPLACE FUNCTION public.validate_event_in_catalog(
    p_event_name TEXT,
    p_event_version INTEGER DEFAULT 1
) RETURNS BOOLEAN AS $$
DECLARE
    v_exists BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 
        FROM public.event_definitions 
        WHERE event_name = p_event_name 
        AND version = p_event_version
        AND status IN ('active', 'draft')
    ) INTO v_exists;
    
    IF NOT v_exists THEN
        RAISE WARNING 'Event % version % not found in catalog or is deprecated', p_event_name, p_event_version;
    END IF;
    
    RETURN v_exists;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.validate_event_in_catalog TO authenticated, service_role;

COMMENT ON FUNCTION public.validate_event_in_catalog IS 'Check if event exists in catalog (soft enforcement)';

-- ================================================================
-- Updated publish_event function with catalog validation
-- ================================================================

CREATE OR REPLACE FUNCTION inventory.publish_event(
    p_tenant_id UUID,
    p_scope TEXT,
    p_event_name TEXT,  -- Changed from event_type to event_name
    p_aggregate_type TEXT,
    p_aggregate_id UUID,
    p_payload JSONB,
    p_event_version INTEGER DEFAULT 1,
    p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID AS $$
DECLARE
    v_event_id UUID;
BEGIN
    -- Soft validation: log warning if event not in catalog
    PERFORM public.validate_event_in_catalog(p_event_name, p_event_version);
    
    INSERT INTO inventory.events_outbox (
        tenant_id,
        scope,
        event_type,  -- Keep for backwards compatibility
        event_name,
        event_version,
        aggregate_type,
        aggregate_id,
        payload,
        metadata,
        status
    ) VALUES (
        p_tenant_id,
        p_scope,
        p_event_name,  -- Same as event_name
        p_event_name,
        p_event_version,
        p_aggregate_type,
        p_aggregate_id,
        p_payload,
        p_metadata,
        'pending'
    ) RETURNING id INTO v_event_id;
    
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION inventory.publish_event(UUID, TEXT, TEXT, TEXT, UUID, JSONB, INTEGER, JSONB) IS 'Publish event to outbox with catalog validation';
