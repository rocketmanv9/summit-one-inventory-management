-- ============================================================================
-- Migration: Consolidate events_outbox tables
-- Date: 2026-03-25
--
-- Problem:
--   Business triggers write to inventory.events_outbox via inventory.publish_event(),
--   but the chassis poller reads from public.events_outbox via outbox_claim_batch().
--   Events written by triggers never get dispatched.
--
-- Solution:
--   1. Add inventory-specific columns to public.events_outbox (scope, event_name, metadata)
--   2. Migrate pending events from inventory.events_outbox -> public.events_outbox
--   3. Redirect inventory.publish_event() to write into public.events_outbox
--   4. Redirect inventory.get_failed_events() to read from public.events_outbox
--   5. Redirect inventory.get_outbox_stats() to read from public.events_outbox
--   6. Redirect public.get_event_catalog_stats() to join public.events_outbox
--   7. Deprecate inventory.events_outbox (retained for historical reference)
--
-- This migration is idempotent (safe to run multiple times).
-- It does NOT drop inventory.events_outbox — only deprecates it.
-- It does NOT modify any chassis-owned functions (outbox_claim_batch, etc.).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Add inventory-specific columns to public.events_outbox (IF NOT EXISTS)
-- ============================================================================
DO $$
BEGIN
  -- scope: event scope (tenant, profile, global) — used by inventory triggers
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events_outbox' AND column_name = 'scope'
  ) THEN
    ALTER TABLE public.events_outbox ADD COLUMN scope TEXT DEFAULT 'tenant';
  END IF;

  -- event_name: explicit event name (FK-like reference to event_definitions.event_name)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events_outbox' AND column_name = 'event_name'
  ) THEN
    ALTER TABLE public.events_outbox ADD COLUMN event_name TEXT;
  END IF;

  -- metadata: arbitrary event metadata JSONB — used by inventory triggers
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events_outbox' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE public.events_outbox ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
  END IF;
END $$;


-- ============================================================================
-- 2. Migrate pending/processing/failed events from inventory -> public
-- ============================================================================
-- Only migrates non-terminal events so they can be dispatched by the chassis poller.
-- Uses ON CONFLICT DO NOTHING to be safely re-runnable.
INSERT INTO public.events_outbox (
  type,
  event_type,
  event_version,
  tenant_id,
  actor_user_id,
  payload,
  metadata,
  status,
  retry_count,
  aggregate_type,
  aggregate_id,
  trace_id,
  correlation_id,
  scope,
  event_name,
  created_at
)
SELECT
  COALESCE(e.event_name, e.event_type),       -- chassis 'type' column
  e.event_type,
  COALESCE(e.event_version, 1),
  e.tenant_id::text,                           -- public uses TEXT, inventory uses UUID
  e.actor_user_id,
  e.payload,
  COALESCE(e.metadata, '{}'::jsonb),
  e.status,
  e.retry_count,
  e.aggregate_type,
  e.aggregate_id,
  e.trace_id::text,                            -- public uses TEXT, inventory uses UUID
  e.correlation_id::text,                      -- public uses TEXT, inventory uses UUID
  COALESCE(e.scope, 'tenant'),
  e.event_name,
  e.created_at
FROM inventory.events_outbox e
WHERE e.status IN ('pending', 'processing', 'failed')
ON CONFLICT DO NOTHING;


-- ============================================================================
-- 3. Replace inventory.publish_event() — Overload 1 (basic, 7 params)
--
-- Signature: (p_tenant_id UUID, p_scope TEXT, p_event_type TEXT,
--             p_aggregate_type TEXT, p_aggregate_id UUID,
--             p_payload JSONB, p_metadata JSONB)
--
-- Now inserts into public.events_outbox instead of inventory.events_outbox.
-- ============================================================================
DROP FUNCTION IF EXISTS inventory.publish_event(uuid, text, text, text, uuid, jsonb, jsonb) CASCADE;

CREATE OR REPLACE FUNCTION inventory.publish_event(
  p_tenant_id      uuid,
  p_scope          text,
  p_event_type     text,
  p_aggregate_type text,
  p_aggregate_id   uuid,
  p_payload        jsonb DEFAULT '{}'::jsonb,
  p_metadata       jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public'
AS $$
DECLARE
    v_event_id uuid;
BEGIN
    INSERT INTO public.events_outbox (
        type,
        event_type,
        tenant_id,
        payload,
        metadata,
        scope,
        aggregate_type,
        aggregate_id,
        status,
        retry_count
    ) VALUES (
        p_event_type,                              -- chassis 'type' column
        p_event_type,                              -- CC alias
        p_tenant_id::text,                         -- public table uses TEXT
        p_payload,
        p_metadata,
        p_scope,
        p_aggregate_type,
        COALESCE(p_aggregate_id, gen_random_uuid()),
        'pending',
        0
    ) RETURNING id INTO v_event_id;

    RETURN v_event_id;
END;
$$;

ALTER FUNCTION inventory.publish_event(uuid, text, text, text, uuid, jsonb, jsonb) OWNER TO postgres;

COMMENT ON FUNCTION inventory.publish_event(uuid, text, text, text, uuid, jsonb, jsonb)
  IS 'Publishes an event to public.events_outbox for async processing by the chassis poller';

GRANT ALL ON FUNCTION inventory.publish_event(uuid, text, text, text, uuid, jsonb, jsonb) TO service_role;
GRANT ALL ON FUNCTION inventory.publish_event(uuid, text, text, text, uuid, jsonb, jsonb) TO authenticated;


-- ============================================================================
-- 3b. Replace inventory.publish_event() — Overload 2 (versioned, 8 params)
--
-- Signature: (p_tenant_id UUID, p_scope TEXT, p_event_name TEXT,
--             p_aggregate_type TEXT, p_aggregate_id UUID,
--             p_payload JSONB, p_event_version INT, p_metadata JSONB)
--
-- Validates event against catalog, then inserts into public.events_outbox.
-- ============================================================================
DROP FUNCTION IF EXISTS inventory.publish_event(uuid, text, text, text, uuid, jsonb, integer, jsonb) CASCADE;

CREATE OR REPLACE FUNCTION inventory.publish_event(
  p_tenant_id      uuid,
  p_scope          text,
  p_event_name     text,
  p_aggregate_type text,
  p_aggregate_id   uuid,
  p_payload        jsonb,
  p_event_version  integer DEFAULT 1,
  p_metadata       jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public'
AS $$
DECLARE
    v_event_id uuid;
BEGIN
    -- Validate event against catalog before publishing
    PERFORM public.validate_event_in_catalog(p_event_name, p_event_version);

    INSERT INTO public.events_outbox (
        type,
        event_type,
        event_name,
        event_version,
        tenant_id,
        payload,
        metadata,
        scope,
        aggregate_type,
        aggregate_id,
        status
    ) VALUES (
        p_event_name,                              -- chassis 'type' column (prefer event_name)
        p_event_name,                              -- CC alias
        p_event_name,                              -- explicit event name
        p_event_version,
        p_tenant_id::text,                         -- public table uses TEXT
        p_payload,
        p_metadata,
        p_scope,
        p_aggregate_type,
        COALESCE(p_aggregate_id, gen_random_uuid()),
        'pending'
    ) RETURNING id INTO v_event_id;

    RETURN v_event_id;
END;
$$;

ALTER FUNCTION inventory.publish_event(uuid, text, text, text, uuid, jsonb, integer, jsonb) OWNER TO postgres;

COMMENT ON FUNCTION inventory.publish_event(uuid, text, text, text, uuid, jsonb, integer, jsonb)
  IS 'Publish event to public.events_outbox with catalog validation';

GRANT ALL ON FUNCTION inventory.publish_event(uuid, text, text, text, uuid, jsonb, integer, jsonb) TO service_role;
GRANT ALL ON FUNCTION inventory.publish_event(uuid, text, text, text, uuid, jsonb, integer, jsonb) TO authenticated;


-- ============================================================================
-- 4. Update inventory.get_failed_events() to read from public.events_outbox
-- ============================================================================
CREATE OR REPLACE FUNCTION inventory.get_failed_events(
  p_tenant_id uuid DEFAULT NULL,
  p_limit     integer DEFAULT 100
) RETURNS TABLE(
  id             uuid,
  tenant_id      uuid,
  event_type     text,
  aggregate_type text,
  aggregate_id   uuid,
  retry_count    integer,
  last_error     text,
  created_at     timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public'
AS $$
  SELECT
    e.id,
    e.tenant_id::uuid,
    COALESCE(e.event_name, e.type) AS event_type,
    e.aggregate_type,
    e.aggregate_id,
    e.retry_count,
    COALESCE(e.dispatch_error, e.error_message) AS last_error,
    e.created_at
  FROM public.events_outbox e
  WHERE e.status = 'failed'
    AND (p_tenant_id IS NULL OR e.tenant_id = p_tenant_id::text)
  ORDER BY e.created_at DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION inventory.get_failed_events(uuid, integer)
  IS 'Returns failed events from public.events_outbox for monitoring and debugging. Can be filtered by tenant_id.';


-- ============================================================================
-- 5. Update inventory.get_outbox_stats() to read from public.events_outbox
-- ============================================================================
CREATE OR REPLACE FUNCTION inventory.get_outbox_stats(
  p_tenant_id uuid DEFAULT NULL
) RETURNS TABLE(
  tenant_id                  uuid,
  total_events               bigint,
  pending_events             bigint,
  published_events           bigint,
  failed_events              bigint,
  avg_processing_time_seconds numeric,
  oldest_pending_age_seconds  numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public'
AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.tenant_id::uuid,
        COUNT(*)::bigint AS total_events,
        COUNT(*) FILTER (WHERE e.status = 'pending')::bigint AS pending_events,
        COUNT(*) FILTER (WHERE e.status = 'published')::bigint AS published_events,
        COUNT(*) FILTER (WHERE e.status = 'failed')::bigint AS failed_events,
        AVG(EXTRACT(EPOCH FROM (e.published_at - e.created_at)))
          FILTER (WHERE e.published_at IS NOT NULL) AS avg_processing_time_seconds,
        EXTRACT(EPOCH FROM (NOW() - MIN(e.created_at) FILTER (WHERE e.status = 'pending')))
          AS oldest_pending_age_seconds
    FROM public.events_outbox e
    WHERE p_tenant_id IS NULL OR e.tenant_id = p_tenant_id::text
    GROUP BY e.tenant_id;
END;
$$;

COMMENT ON FUNCTION inventory.get_outbox_stats(uuid)
  IS 'Returns statistics about outbox events from public.events_outbox for monitoring dashboards. Can be filtered by tenant_id.';


-- ============================================================================
-- 6. Update public.get_event_catalog_stats() to join with public.events_outbox
--    instead of inventory.events_outbox
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_event_catalog_stats()
RETURNS TABLE(
  event_name     text,
  version        integer,
  status         text,
  total_emitted  bigint,
  last_emitted_at timestamptz,
  pending_count  bigint,
  published_count bigint,
  failed_count   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ed.event_name,
        ed.version,
        ed.status,
        COUNT(eo.id) AS total_emitted,
        MAX(eo.created_at) AS last_emitted_at,
        COUNT(eo.id) FILTER (WHERE eo.status = 'pending') AS pending_count,
        COUNT(eo.id) FILTER (WHERE eo.status = 'published') AS published_count,
        COUNT(eo.id) FILTER (WHERE eo.status = 'failed') AS failed_count
    FROM public.event_definitions ed
    LEFT JOIN public.events_outbox eo
      ON ed.event_name = COALESCE(eo.event_name, eo.type)
      AND ed.version = COALESCE(eo.event_version, eo.version)
    GROUP BY ed.event_name, ed.version, ed.status
    ORDER BY ed.event_name, ed.version DESC;
END;
$$;

COMMENT ON FUNCTION public.get_event_catalog_stats()
  IS 'Get statistics for each event in the catalog (reads from public.events_outbox)';


-- ============================================================================
-- 7. Verify status constraint covers all needed values
--
-- The public.events_outbox CHECK constraint from migration 00010 already
-- allows: 'pending', 'processing', 'published', 'failed', 'dead'.
-- This covers all values that inventory triggers use ('pending', 'processing',
-- 'published', 'failed'). No change needed.
--
-- Guard: idempotently ensure the constraint exists with the right values.
-- ============================================================================
DO $$
BEGIN
  -- Only recreate if the current constraint doesn't include all needed values.
  -- This is a safety net — the constraint should already be correct.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'events_outbox_status_check'
      AND constraint_schema = 'public'
  ) THEN
    ALTER TABLE public.events_outbox ADD CONSTRAINT events_outbox_status_check
      CHECK (status IN ('pending', 'processing', 'published', 'failed', 'dead'));
  END IF;
END $$;


-- ============================================================================
-- 8. Deprecate inventory.events_outbox
--
-- The table is retained for historical reference and to avoid breaking
-- any ad-hoc queries. All new events flow through public.events_outbox.
-- ============================================================================
COMMENT ON TABLE inventory.events_outbox
  IS 'DEPRECATED: All events now flow through public.events_outbox. This table is retained for historical reference only.';


COMMIT;
