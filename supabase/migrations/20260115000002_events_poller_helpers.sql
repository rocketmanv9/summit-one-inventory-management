-- ================================================================
-- Events Poller Helper Functions
-- ================================================================
-- Purpose: SQL functions to support the events-poller Edge Function
-- ================================================================

-- ----------------------------------------------------------------
-- Function: poll_pending_events
-- ----------------------------------------------------------------
-- Selects pending events for processing with row-level locking
-- Uses FOR UPDATE SKIP LOCKED to prevent concurrent processing

CREATE OR REPLACE FUNCTION inventory.poll_pending_events(
    p_batch_size INTEGER DEFAULT 100,
    p_max_attempts INTEGER DEFAULT 5
)
RETURNS TABLE (
    id UUID,
    tenant_id UUID,
    scope TEXT,
    event_type TEXT,
    aggregate_type TEXT,
    aggregate_id UUID,
    payload JSONB,
    metadata JSONB,
    status TEXT,
    retry_count INTEGER,
    created_at TIMESTAMPTZ,
    last_error TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.id,
        e.tenant_id,
        e.scope,
        e.event_type,
        e.aggregate_type,
        e.aggregate_id,
        e.payload,
        e.metadata,
        e.status,
        e.retry_count,
        e.created_at,
        e.last_error
    FROM inventory.events_outbox e
    WHERE e.status = 'pending'
    AND e.retry_count < p_max_attempts
    AND e.created_at <= NOW() -- Only process events in the past
    ORDER BY e.created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED; -- Critical: prevents concurrent processing
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service role (used by Edge Function)
GRANT EXECUTE ON FUNCTION inventory.poll_pending_events TO service_role;

-- Comment for documentation
COMMENT ON FUNCTION inventory.poll_pending_events IS 
    'Selects pending events for processing by events-poller Edge Function. Uses row-level locking to prevent concurrent processing.';

-- ----------------------------------------------------------------
-- Function: get_failed_events
-- ----------------------------------------------------------------
-- Returns events that exceeded max retry attempts for monitoring

CREATE OR REPLACE FUNCTION inventory.get_failed_events(
    p_tenant_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    id UUID,
    tenant_id UUID,
    event_type TEXT,
    aggregate_type TEXT,
    aggregate_id UUID,
    retry_count INTEGER,
    last_error TEXT,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.id,
        e.tenant_id,
        e.event_type,
        e.aggregate_type,
        e.aggregate_id,
        e.retry_count,
        e.last_error,
        e.created_at
    FROM inventory.events_outbox e
    WHERE e.status = 'failed'
    AND (p_tenant_id IS NULL OR e.tenant_id = p_tenant_id)
    ORDER BY e.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users (for monitoring dashboard)
GRANT EXECUTE ON FUNCTION inventory.get_failed_events TO authenticated;

-- Comment for documentation
COMMENT ON FUNCTION inventory.get_failed_events IS 
    'Returns failed events for monitoring and debugging. Can be filtered by tenant_id.';

-- ----------------------------------------------------------------
-- Function: retry_failed_event
-- ----------------------------------------------------------------
-- Manually retry a failed event (resets status to pending)

CREATE OR REPLACE FUNCTION inventory.retry_failed_event(
    p_event_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    v_updated INTEGER;
BEGIN
    UPDATE inventory.events_outbox
    SET 
        status = 'pending',
        retry_count = 0,
        last_error = NULL
    WHERE id = p_event_id
    AND status = 'failed';
    
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    
    RETURN v_updated > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION inventory.retry_failed_event TO authenticated;

-- Comment for documentation
COMMENT ON FUNCTION inventory.retry_failed_event IS 
    'Manually retries a failed event by resetting its status to pending and clearing retry count.';

-- ----------------------------------------------------------------
-- Function: get_outbox_stats
-- ----------------------------------------------------------------
-- Returns statistics about the outbox for monitoring

CREATE OR REPLACE FUNCTION inventory.get_outbox_stats(
    p_tenant_id UUID DEFAULT NULL
)
RETURNS TABLE (
    tenant_id UUID,
    total_events BIGINT,
    pending_events BIGINT,
    published_events BIGINT,
    failed_events BIGINT,
    avg_processing_time_seconds NUMERIC,
    oldest_pending_age_seconds NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.tenant_id,
        COUNT(*)::BIGINT AS total_events,
        COUNT(*) FILTER (WHERE e.status = 'pending')::BIGINT AS pending_events,
        COUNT(*) FILTER (WHERE e.status = 'published')::BIGINT AS published_events,
        COUNT(*) FILTER (WHERE e.status = 'failed')::BIGINT AS failed_events,
        AVG(EXTRACT(EPOCH FROM (e.published_at - e.created_at))) FILTER (WHERE e.published_at IS NOT NULL) AS avg_processing_time_seconds,
        EXTRACT(EPOCH FROM (NOW() - MIN(e.created_at) FILTER (WHERE e.status = 'pending'))) AS oldest_pending_age_seconds
    FROM inventory.events_outbox e
    WHERE p_tenant_id IS NULL OR e.tenant_id = p_tenant_id
    GROUP BY e.tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION inventory.get_outbox_stats TO authenticated;

-- Comment for documentation
COMMENT ON FUNCTION inventory.get_outbox_stats IS 
    'Returns statistics about outbox events for monitoring dashboards. Can be filtered by tenant_id.';
