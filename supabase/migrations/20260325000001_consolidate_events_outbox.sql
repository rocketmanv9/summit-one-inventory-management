-- ============================================================================
-- Migration: Consolidate events_outbox tables
-- Date: 2026-03-25
--
-- Background:
--   The baseline migration created public.events_outbox with CC-style columns
--   (event_type, tenant_id UUID, actor_user_id, etc.). The chassis migration
--   00003 tried CREATE TABLE IF NOT EXISTS with different column names (type,
--   tenant_id TEXT, actor JSONB, etc.) — that was a no-op since the table
--   already existed. As a result, several chassis-native columns are missing
--   from the remote table.
--
-- This migration:
--   0. Adds missing chassis-native columns to public.events_outbox
--   0b. Backfills chassis columns from baseline equivalents
--   1. Adds inventory-specific columns (scope, event_name, metadata)
--   2. Migrates pending events from inventory.events_outbox -> public
--   3. Redirects inventory.publish_event() to write into public.events_outbox
--   4-6. Redirects helper functions to read from public.events_outbox
--   7. Deprecates inventory.events_outbox
--
-- This migration is idempotent (safe to run multiple times).
-- It does NOT drop inventory.events_outbox — only deprecates it.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0. Add missing chassis-native columns to public.events_outbox
--
-- The baseline table has CC-style columns. Chassis functions (outbox_claim_batch,
-- emit_event, fn_prevent_event_modification) reference chassis-native column
-- names. We add them here so both column sets coexist.
-- ============================================================================
DO $$
BEGIN
  -- type: chassis-native event type (baseline equivalent: event_type)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events_outbox' AND column_name = 'type'
  ) THEN
    ALTER TABLE public.events_outbox ADD COLUMN type TEXT;
  END IF;

  -- actor: chassis-native actor JSONB (baseline equivalent: actor_user_id UUID)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events_outbox' AND column_name = 'actor'
  ) THEN
    ALTER TABLE public.events_outbox ADD COLUMN actor JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;

  -- version: chassis-native version int (baseline equivalent: event_version)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events_outbox' AND column_name = 'version'
  ) THEN
    ALTER TABLE public.events_outbox ADD COLUMN version INT NOT NULL DEFAULT 1;
  END IF;

  -- occurred_at: chassis-native event timestamp
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events_outbox' AND column_name = 'occurred_at'
  ) THEN
    ALTER TABLE public.events_outbox ADD COLUMN occurred_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;

  -- idempotency_key: chassis-native idempotency key
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events_outbox' AND column_name = 'idempotency_key'
  ) THEN
    ALTER TABLE public.events_outbox ADD COLUMN idempotency_key TEXT;
  END IF;

  -- dispatch_error: chassis-native error column (baseline equivalent: error_message)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events_outbox' AND column_name = 'dispatch_error'
  ) THEN
    ALTER TABLE public.events_outbox ADD COLUMN dispatch_error TEXT;
  END IF;

  -- dispatched_at: chassis-native dispatched timestamp (baseline equivalent: published_at)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events_outbox' AND column_name = 'dispatched_at'
  ) THEN
    ALTER TABLE public.events_outbox ADD COLUMN dispatched_at TIMESTAMPTZ;
  END IF;

  -- retry_count: chassis-native retry counter (baseline equivalent: attempts)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events_outbox' AND column_name = 'retry_count'
  ) THEN
    ALTER TABLE public.events_outbox ADD COLUMN retry_count INT NOT NULL DEFAULT 0;
  END IF;

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
-- 0b. Backfill chassis columns from baseline equivalents
-- ============================================================================
-- type ← event_type
UPDATE public.events_outbox SET type = event_type
  WHERE type IS NULL AND event_type IS NOT NULL;

-- version ← event_version
UPDATE public.events_outbox SET version = event_version
  WHERE version = 1 AND event_version IS NOT NULL AND event_version != 1;

-- occurred_at ← created_at (for rows where it defaulted to now() at migration time)
-- This is a no-op for most rows since both default to now().

-- dispatch_error ← error_message
UPDATE public.events_outbox SET dispatch_error = error_message
  WHERE dispatch_error IS NULL AND error_message IS NOT NULL;

-- dispatched_at ← published_at
UPDATE public.events_outbox SET dispatched_at = published_at
  WHERE dispatched_at IS NULL AND published_at IS NOT NULL;

-- retry_count ← attempts
UPDATE public.events_outbox SET retry_count = attempts
  WHERE retry_count = 0 AND attempts > 0;

-- actor ← actor_user_id (wrap UUID in JSONB)
UPDATE public.events_outbox SET actor = jsonb_build_object('user_id', actor_user_id::text)
  WHERE actor = '{}'::jsonb AND actor_user_id IS NOT NULL;

-- Create idempotency unique index (chassis 00006 may have failed on original schema)
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_outbox_idempotency_key_unique
  ON public.events_outbox (idempotency_key)
  WHERE idempotency_key IS NOT NULL;


-- ============================================================================
-- 2. Migrate pending/processing/failed events from inventory -> public
-- ============================================================================
-- Only migrates non-terminal events so they can be dispatched by the chassis poller.
-- Uses ON CONFLICT DO NOTHING to be safely re-runnable.
-- Populates BOTH baseline columns (event_type, tenant_id UUID, etc.) AND
-- chassis columns (type, retry_count, etc.) for full compatibility.
INSERT INTO public.events_outbox (
  event_type,
  event_version,
  tenant_id,
  actor_user_id,
  payload,
  metadata,
  status,
  attempts,
  aggregate_type,
  aggregate_id,
  trace_id,
  correlation_id,
  scope,
  event_name,
  created_at,
  -- Chassis-native columns (dual-write for compatibility)
  type,
  version,
  retry_count
)
SELECT
  e.event_type,
  COALESCE(e.event_version, 1),
  e.tenant_id,                                    -- UUID → UUID (same type)
  e.actor_user_id,
  e.payload,
  COALESCE(e.metadata, '{}'::jsonb),
  e.status,
  COALESCE(e.retry_count, 0),
  e.aggregate_type,
  e.aggregate_id,
  e.trace_id,                                     -- UUID → UUID (same type)
  e.correlation_id,                                -- UUID → UUID (same type)
  COALESCE(e.scope, 'tenant'),
  e.event_name,
  e.created_at,
  -- Chassis-native columns
  COALESCE(e.event_name, e.event_type),            -- type = best event identifier
  COALESCE(e.event_version, 1),                    -- version
  COALESCE(e.retry_count, 0)                       -- retry_count
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
-- Populates both baseline AND chassis column sets.
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
        -- Baseline columns
        event_type,
        tenant_id,
        payload,
        aggregate_type,
        aggregate_id,
        status,
        attempts,
        -- Chassis columns
        type,
        retry_count,
        -- Inventory columns
        metadata,
        scope
    ) VALUES (
        p_event_type,                                  -- baseline event_type
        p_tenant_id,                                   -- UUID (baseline type)
        p_payload,
        p_aggregate_type,
        COALESCE(p_aggregate_id, gen_random_uuid()),
        'pending',
        0,
        -- Chassis columns
        p_event_type,                                  -- chassis type
        0,
        -- Inventory columns
        p_metadata,
        p_scope
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
        -- Baseline columns
        event_type,
        event_version,
        tenant_id,
        payload,
        aggregate_type,
        aggregate_id,
        status,
        -- Chassis columns
        type,
        version,
        -- Inventory columns
        event_name,
        metadata,
        scope
    ) VALUES (
        p_event_name,                                  -- baseline event_type
        p_event_version,                               -- baseline event_version
        p_tenant_id,                                   -- UUID (baseline type)
        p_payload,
        p_aggregate_type,
        COALESCE(p_aggregate_id, gen_random_uuid()),
        'pending',
        -- Chassis columns
        p_event_name,                                  -- chassis type
        p_event_version,                               -- chassis version
        -- Inventory columns
        p_event_name,                                  -- explicit event name
        p_metadata,
        p_scope
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
    e.tenant_id,                                       -- already UUID
    COALESCE(e.event_name, e.event_type) AS event_type,
    e.aggregate_type,
    e.aggregate_id,
    COALESCE(e.retry_count, e.attempts) AS retry_count,
    COALESCE(e.dispatch_error, e.error_message) AS last_error,
    e.created_at
  FROM public.events_outbox e
  WHERE e.status = 'failed'
    AND (p_tenant_id IS NULL OR e.tenant_id = p_tenant_id)
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
        e.tenant_id,                                   -- already UUID
        COUNT(*)::bigint AS total_events,
        COUNT(*) FILTER (WHERE e.status = 'pending')::bigint AS pending_events,
        COUNT(*) FILTER (WHERE e.status = 'published')::bigint AS published_events,
        COUNT(*) FILTER (WHERE e.status = 'failed')::bigint AS failed_events,
        AVG(EXTRACT(EPOCH FROM (COALESCE(e.published_at, e.dispatched_at) - e.created_at)))
          FILTER (WHERE e.published_at IS NOT NULL OR e.dispatched_at IS NOT NULL) AS avg_processing_time_seconds,
        EXTRACT(EPOCH FROM (NOW() - MIN(e.created_at) FILTER (WHERE e.status = 'pending')))
          AS oldest_pending_age_seconds
    FROM public.events_outbox e
    WHERE p_tenant_id IS NULL OR e.tenant_id = p_tenant_id
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
      ON ed.event_name = COALESCE(eo.event_name, eo.event_type)
      AND ed.version = COALESCE(eo.event_version, 1)
    GROUP BY ed.event_name, ed.version, ed.status
    ORDER BY ed.event_name, ed.version DESC;
END;
$$;

COMMENT ON FUNCTION public.get_event_catalog_stats()
  IS 'Get statistics for each event in the catalog (reads from public.events_outbox)';


-- ============================================================================
-- 7. Verify status constraint covers all needed values
-- ============================================================================
DO $$
BEGIN
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
-- ============================================================================
COMMENT ON TABLE inventory.events_outbox
  IS 'DEPRECATED: All events now flow through public.events_outbox. This table is retained for historical reference only.';


COMMIT;
