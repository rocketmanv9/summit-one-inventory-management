-- ============================================================================
-- Summit One Producer Protocol Compliance Migration
-- ============================================================================
-- Purpose: Align Inventory service with Command Center Hub polling protocol
-- Date: 2026-01-16
-- Ticket: SUMMIT-PRODUCER-001
-- 
-- Changes:
-- 1. Add missing columns to inventory.events_outbox (locking, retry scheduling)
-- 2. Create public.events_outbox view (hub polling interface)
-- 3. Create public.event_catalog view (hub discovery)
-- 4. Create public.summit_config table (producer metadata)
-- 5. Create public.events_dead_letter table (DLQ)
-- 6. Create summit_bot role (hub polling account)
-- 7. Add helper functions (emit_event, register_event)
-- 8. Add immutability protections
-- 9. Add polling-optimized indexes
-- ============================================================================

-- ============================================================================
-- STEP 1: Add Missing Columns to inventory.events_outbox
-- ============================================================================

-- Add retry scheduling and locking columns for concurrent poller safety
ALTER TABLE inventory.events_outbox 
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS locked_by TEXT,
    ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

-- Update existing pending events to be immediately pollable
UPDATE inventory.events_outbox 
SET next_attempt_at = created_at 
WHERE next_attempt_at IS NULL AND status = 'pending';

-- Add comments
COMMENT ON COLUMN inventory.events_outbox.next_attempt_at IS 'When this event should be attempted next (for retry backoff)';
COMMENT ON COLUMN inventory.events_outbox.locked_at IS 'When this event was locked by a poller (for concurrent safety)';
COMMENT ON COLUMN inventory.events_outbox.locked_by IS 'Identifier of the poller that locked this event (hostname or worker ID)';
COMMENT ON COLUMN inventory.events_outbox.last_attempt_at IS 'Timestamp of most recent delivery attempt';

-- ============================================================================
-- STEP 2: Create public.events_outbox View (Hub Polling Interface)
-- ============================================================================

-- View exposes exactly what hub expects, no more, no less
CREATE OR REPLACE VIEW public.events_outbox AS
SELECT 
    id,                    -- Hub uses as event_id_from_source
    event_type,            -- Hub uses for routing
    tenant_id,             -- Hub uses for filtering
    payload,               -- Hub forwards to subscribers
    created_at,
    status,                -- pending|processing|published|failed|dead
    retry_count AS attempts,  -- Map retry_count to attempts for hub compatibility
    next_attempt_at,
    locked_at,
    locked_by,
    last_attempt_at,
    last_error AS error_message,  -- Map last_error to error_message
    published_at
FROM inventory.events_outbox;

COMMENT ON VIEW public.events_outbox IS 'Hub polling interface - exposes events for Command Center ingestion';

-- Grant summit_bot role read access (role created later)
-- Will be granted after role creation

-- ============================================================================
-- STEP 3: Create public.event_catalog View (Hub Discovery)
-- ============================================================================

-- Expose event_definitions as event_catalog with event_key as primary identifier
CREATE OR REPLACE VIEW public.event_catalog AS
SELECT 
    event_name AS event_key,      -- Hub primary identifier
    event_name,                    -- Full event name
    version AS event_version,      -- Hub expects event_version column
    producer,
    description,
    payload_schema,
    example_payload,
    status,
    deprecation_reason,
    deprecated_at,
    created_at,
    updated_at
FROM public.event_definitions;

COMMENT ON VIEW public.event_catalog IS 'Event catalog for hub discovery - documents available event types';

-- ============================================================================
-- STEP 4: Create public.summit_config Table (Producer Metadata)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.summit_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    service_name TEXT NOT NULL DEFAULT 'inventory',
    environment TEXT NOT NULL DEFAULT 'dev' CHECK (environment IN ('dev', 'staging', 'prod')),
    protocol_version TEXT NOT NULL DEFAULT '1.0',
    polling_enabled BOOLEAN DEFAULT TRUE,
    last_polled_at TIMESTAMPTZ,
    last_poll_event_count INTEGER DEFAULT 0,
    config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default configuration
INSERT INTO public.summit_config (service_name, environment, protocol_version)
VALUES ('inventory', 'dev', '1.0')
ON CONFLICT (publisher_id) DO NOTHING;

COMMENT ON TABLE public.summit_config IS 'Producer metadata for Command Center hub discovery';
COMMENT ON COLUMN public.summit_config.publisher_id IS 'Unique identifier for this service instance';
COMMENT ON COLUMN public.summit_config.polling_enabled IS 'Whether hub should poll this producer';
COMMENT ON COLUMN public.summit_config.last_polled_at IS 'Last successful poll timestamp (updated by hub)';

-- ============================================================================
-- STEP 5: Create public.events_dead_letter Table (DLQ)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.events_dead_letter (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_event_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    tenant_id UUID NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    dead_lettered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    final_error TEXT,
    total_attempts INTEGER NOT NULL,
    original_metadata JSONB,
    -- Copy of original outbox fields for forensics
    original_scope TEXT,
    original_aggregate_type TEXT,
    original_aggregate_id UUID,
    original_actor_user_id UUID
);

CREATE INDEX idx_events_dlq_tenant ON public.events_dead_letter(tenant_id);
CREATE INDEX idx_events_dlq_event_type ON public.events_dead_letter(event_type);
CREATE INDEX idx_events_dlq_dead_lettered ON public.events_dead_letter(dead_lettered_at DESC);
CREATE INDEX idx_events_dlq_original ON public.events_dead_letter(original_event_id);

COMMENT ON TABLE public.events_dead_letter IS 'Dead letter queue for events exceeding max retry attempts';
COMMENT ON COLUMN public.events_dead_letter.original_event_id IS 'Original ID from inventory.events_outbox';

-- ============================================================================
-- STEP 6: Create summit_bot Role (Hub Polling Account)
-- ============================================================================

-- Create role if not exists (Supabase-safe pattern)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'summit_bot') THEN
        -- Create role with LOGIN capability
        -- Password MUST be set separately using: ALTER USER summit_bot PASSWORD '{{SUMMIT_BOT_PASSWORD}}';
        CREATE ROLE summit_bot LOGIN;
        RAISE NOTICE 'Created role summit_bot - PASSWORD MUST BE SET MANUALLY';
    ELSE
        RAISE NOTICE 'Role summit_bot already exists';
    END IF;
END
$$;

-- Grant minimal required permissions

-- SELECT on outbox view (read events)
GRANT SELECT ON public.events_outbox TO summit_bot;

-- UPDATE on specific outbox columns only (lock management, status updates)
-- Note: Grants on views need to be on underlying table
GRANT UPDATE (status, locked_at, locked_by, last_attempt_at, next_attempt_at, retry_count, last_error, published_at) 
    ON inventory.events_outbox TO summit_bot;

-- SELECT on catalog (discover event schemas)
GRANT SELECT ON public.event_catalog TO summit_bot;
GRANT SELECT ON public.event_definitions TO summit_bot;

-- SELECT and UPDATE on config (polling metadata)
GRANT SELECT, UPDATE (last_polled_at, last_poll_event_count) ON public.summit_config TO summit_bot;

-- SELECT on dead letter queue (monitoring)
GRANT SELECT ON public.events_dead_letter TO summit_bot;

-- GRANT USAGE on schema
GRANT USAGE ON SCHEMA public TO summit_bot;
GRANT USAGE ON SCHEMA inventory TO summit_bot;

COMMENT ON ROLE summit_bot IS 'Command Center hub polling account - minimal privileges for event ingestion';

-- ============================================================================
-- STEP 7: Add Polling-Optimized Indexes
-- ============================================================================

-- Index for efficient polling query: WHERE status IN ('pending','processing') AND next_attempt_at <= NOW()
CREATE INDEX IF NOT EXISTS idx_outbox_polling 
    ON inventory.events_outbox(status, next_attempt_at, created_at) 
    WHERE status IN ('pending', 'processing');

-- Index for lock cleanup (find stale locks)
CREATE INDEX IF NOT EXISTS idx_outbox_locked 
    ON inventory.events_outbox(locked_at) 
    WHERE locked_at IS NOT NULL;

-- Index for retry candidates
CREATE INDEX IF NOT EXISTS idx_outbox_retry 
    ON inventory.events_outbox(status, retry_count, next_attempt_at)
    WHERE status = 'failed' AND retry_count < 5;

-- ============================================================================
-- STEP 8: Create Helper Functions
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Function: public.emit_event
-- Purpose: Standard interface for emitting events (wraps inventory.publish_event)
-- Usage: SELECT public.emit_event('inventory.stock.adjusted', '{"sku":"ABC"}'::jsonb, tenant_id);
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.emit_event(
    p_event_type TEXT,
    p_payload JSONB,
    p_tenant_id UUID,
    p_scope TEXT DEFAULT 'tenant',
    p_aggregate_type TEXT DEFAULT NULL,
    p_aggregate_id UUID DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID AS $$
DECLARE
    v_event_id UUID;
    v_event_name TEXT;
    v_event_version INT;
BEGIN
    -- Parse event_type to extract event_name and version if provided
    -- Format: "inventory.stock.adjusted" or "inventory.stock.adjusted@2"
    IF p_event_type LIKE '%@%' THEN
        v_event_name := split_part(p_event_type, '@', 1);
        v_event_version := split_part(p_event_type, '@', 2)::int;
    ELSE
        v_event_name := p_event_type;
        v_event_version := 1;  -- Default version
    END IF;

    -- Call existing publish_event function (with event_name signature)
    v_event_id := inventory.publish_event(
        p_tenant_id := p_tenant_id,
        p_scope := p_scope,
        p_event_name := v_event_name,
        p_aggregate_type := COALESCE(p_aggregate_type, v_event_name),
        p_aggregate_id := COALESCE(p_aggregate_id, gen_random_uuid()),
        p_payload := p_payload,
        p_event_version := v_event_version,
        p_metadata := p_metadata
    );

    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.emit_event TO authenticated, service_role;

COMMENT ON FUNCTION public.emit_event IS 'Standard event emission interface - wraps inventory.publish_event for hub protocol compliance';

-- ---------------------------------------------------------------------------
-- Function: public.register_event
-- Purpose: Upsert event catalog entries
-- Usage: SELECT public.register_event('inventory.stock.adjusted', 1, 'Inventory Service', 'Stock level changed');
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_event(
    p_event_name TEXT,
    p_version INTEGER DEFAULT 1,
    p_producer TEXT DEFAULT 'inventory',
    p_description TEXT DEFAULT '',
    p_payload_schema JSONB DEFAULT NULL,
    p_example_payload JSONB DEFAULT NULL,
    p_status TEXT DEFAULT 'active'
) RETURNS UUID AS $$
DECLARE
    v_definition_id UUID;
BEGIN
    -- Upsert event definition
    INSERT INTO public.event_definitions (
        event_name,
        version,
        producer,
        description,
        payload_schema,
        example_payload,
        status,
        created_at,
        updated_at
    ) VALUES (
        p_event_name,
        p_version,
        p_producer,
        p_description,
        p_payload_schema,
        p_example_payload,
        p_status,
        NOW(),
        NOW()
    )
    ON CONFLICT (event_name, version) 
    DO UPDATE SET
        description = EXCLUDED.description,
        payload_schema = EXCLUDED.payload_schema,
        example_payload = EXCLUDED.example_payload,
        status = EXCLUDED.status,
        updated_at = NOW()
    RETURNING id INTO v_definition_id;

    RETURN v_definition_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.register_event TO service_role;

COMMENT ON FUNCTION public.register_event IS 'Register or update event catalog entry';

-- ============================================================================
-- STEP 9: Add Immutability Protections
-- ============================================================================

-- Trigger function to prevent changes to event_type and payload after insert
CREATE OR REPLACE FUNCTION inventory.prevent_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow status, lock, and error field updates
    IF OLD.event_type IS DISTINCT FROM NEW.event_type THEN
        RAISE EXCEPTION 'event_type cannot be modified after insert (event_id: %)', OLD.id;
    END IF;

    IF OLD.payload IS DISTINCT FROM NEW.payload THEN
        RAISE EXCEPTION 'payload cannot be modified after insert (event_id: %)', OLD.id;
    END IF;

    IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'tenant_id cannot be modified after insert (event_id: %)', OLD.id;
    END IF;

    -- Allow all other updates (status, locked_at, retry_count, etc.)
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger
DROP TRIGGER IF EXISTS enforce_event_immutability ON inventory.events_outbox;
CREATE TRIGGER enforce_event_immutability
    BEFORE UPDATE ON inventory.events_outbox
    FOR EACH ROW
    EXECUTE FUNCTION inventory.prevent_event_mutation();

COMMENT ON FUNCTION inventory.prevent_event_mutation IS 'Ensures event_type, payload, and tenant_id are immutable after insert';

-- ============================================================================
-- STEP 10: Add Dead Letter Queue Handler Function
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory.move_to_dead_letter(p_event_id UUID)
RETURNS VOID AS $$
DECLARE
    v_event RECORD;
BEGIN
    -- Fetch event from outbox
    SELECT * INTO v_event FROM inventory.events_outbox WHERE id = p_event_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event % not found', p_event_id;
    END IF;

    -- Insert into DLQ
    INSERT INTO public.events_dead_letter (
        original_event_id,
        event_type,
        tenant_id,
        payload,
        created_at,
        final_error,
        total_attempts,
        original_metadata,
        original_scope,
        original_aggregate_type,
        original_aggregate_id,
        original_actor_user_id
    ) VALUES (
        v_event.id,
        v_event.event_type,
        v_event.tenant_id,
        v_event.payload,
        v_event.created_at,
        v_event.last_error,
        v_event.retry_count,
        v_event.metadata,
        v_event.scope,
        v_event.aggregate_type,
        v_event.aggregate_id,
        v_event.actor_user_id
    );

    -- Update status to 'dead' in outbox
    UPDATE inventory.events_outbox 
    SET status = 'dead', 
        locked_at = NULL, 
        locked_by = NULL
    WHERE id = p_event_id;

    RAISE NOTICE 'Event % moved to dead letter queue', p_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION inventory.move_to_dead_letter TO service_role, summit_bot;

COMMENT ON FUNCTION inventory.move_to_dead_letter IS 'Moves failed event to dead letter queue after max retries';

-- ============================================================================
-- STEP 11: Update Status Check Constraint
-- ============================================================================

-- Add 'dead' and 'processing' to allowed status values
ALTER TABLE inventory.events_outbox DROP CONSTRAINT IF EXISTS events_outbox_status_check;
ALTER TABLE inventory.events_outbox ADD CONSTRAINT events_outbox_status_check 
    CHECK (status IN ('pending', 'processing', 'published', 'failed', 'dead'));

-- ============================================================================
-- POST-MIGRATION MANUAL STEPS
-- ============================================================================

-- ⚠️ REQUIRED: Set summit_bot password
-- Run this command manually with actual password (NOT in migration):
-- 
-- ALTER USER summit_bot PASSWORD '{{SUMMIT_BOT_PASSWORD}}';
--
-- Recommended: Generate strong password and store in vault
-- Example: openssl rand -base64 32

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check all new objects exist
DO $$
BEGIN
    RAISE NOTICE '=== Verification Results ===';
    
    -- Check columns
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='inventory' AND table_name='events_outbox' AND column_name='locked_at') THEN
        RAISE NOTICE '✓ Column inventory.events_outbox.locked_at exists';
    ELSE
        RAISE WARNING '✗ Column inventory.events_outbox.locked_at MISSING';
    END IF;

    -- Check view
    IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='events_outbox') THEN
        RAISE NOTICE '✓ View public.events_outbox exists';
    ELSE
        RAISE WARNING '✗ View public.events_outbox MISSING';
    END IF;

    -- Check tables
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='summit_config') THEN
        RAISE NOTICE '✓ Table public.summit_config exists';
    ELSE
        RAISE WARNING '✗ Table public.summit_config MISSING';
    END IF;

    -- Check role
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='summit_bot') THEN
        RAISE NOTICE '✓ Role summit_bot exists';
    ELSE
        RAISE WARNING '✗ Role summit_bot MISSING';
    END IF;

    -- Check functions
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public' AND p.proname='emit_event') THEN
        RAISE NOTICE '✓ Function public.emit_event exists';
    ELSE
        RAISE WARNING '✗ Function public.emit_event MISSING';
    END IF;

    RAISE NOTICE '=== End Verification ===';
END;
$$;
