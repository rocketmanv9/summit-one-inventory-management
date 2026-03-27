-- @summit/chassis - Migration 00009: Dead-Letter Trace Enrichment
--
-- Adds observability columns to events_dead_letter for forensic debugging:
--   trace_id, causation_id, error_category, error_fingerprint, service_name,
--   replay_of_id (links replayed events to their original dead-letter entry)
--
-- Also adds a trace_id index on events_outbox for trace query support
-- and a correlation_id index on hub_event_inbox.
--
-- All statements are idempotent (safe to run multiple times).

-- ============================================================================
-- 1. Add trace columns to events_dead_letter
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_dead_letter' AND column_name = 'trace_id'
  ) THEN
    ALTER TABLE events_dead_letter ADD COLUMN trace_id TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_dead_letter' AND column_name = 'causation_id'
  ) THEN
    ALTER TABLE events_dead_letter ADD COLUMN causation_id TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_dead_letter' AND column_name = 'error_category'
  ) THEN
    ALTER TABLE events_dead_letter ADD COLUMN error_category TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_dead_letter' AND column_name = 'error_fingerprint'
  ) THEN
    ALTER TABLE events_dead_letter ADD COLUMN error_fingerprint TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_dead_letter' AND column_name = 'service_name'
  ) THEN
    ALTER TABLE events_dead_letter ADD COLUMN service_name TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_dead_letter' AND column_name = 'replay_of_id'
  ) THEN
    ALTER TABLE events_dead_letter ADD COLUMN replay_of_id UUID;
  END IF;
END $$;

-- Index for trace-based queries on dead letters
CREATE INDEX IF NOT EXISTS idx_events_dead_letter_trace_id
  ON events_dead_letter (trace_id) WHERE trace_id IS NOT NULL;

-- Index for correlation-based queries on outbox
CREATE INDEX IF NOT EXISTS idx_events_outbox_correlation_id
  ON events_outbox (correlation_id) WHERE correlation_id IS NOT NULL;

-- Index for correlation-based queries on inbox
CREATE INDEX IF NOT EXISTS idx_hub_event_inbox_correlation_id
  ON hub_event_inbox (correlation_id) WHERE correlation_id IS NOT NULL;

-- Index for trace-based queries on inbox
CREATE INDEX IF NOT EXISTS idx_hub_event_inbox_trace_id
  ON hub_event_inbox (trace_id) WHERE trace_id IS NOT NULL;

-- ============================================================================
-- 2. Update move_to_dead_letter to carry trace metadata
-- ============================================================================
CREATE OR REPLACE FUNCTION move_to_dead_letter(p_event_id UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_event events_outbox%ROWTYPE;
  v_dead_id UUID;
  v_causation_id TEXT;
BEGIN
  SELECT * INTO v_event FROM events_outbox WHERE id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event "%" not found in outbox', p_event_id;
  END IF;

  IF v_event.status NOT IN ('failed', 'dead') THEN
    RAISE EXCEPTION 'Event "%" has status "%" — only failed/dead events can be moved to dead letter', p_event_id, v_event.status;
  END IF;

  -- Extract causation_id from payload if present (put there by emitOutboxEvent)
  v_causation_id := v_event.payload ->> 'causation_id';

  INSERT INTO events_dead_letter (
    original_event_id, event_type, tenant_id, payload, actor,
    correlation_id, error, attempts, original_created_at,
    trace_id, causation_id
  ) VALUES (
    v_event.id, v_event.type, v_event.tenant_id, v_event.payload, v_event.actor,
    v_event.correlation_id, v_event.dispatch_error, v_event.retry_count, v_event.created_at,
    v_event.correlation_id, v_causation_id
  )
  RETURNING id INTO v_dead_id;

  DELETE FROM events_outbox WHERE id = p_event_id;

  RETURN v_dead_id;
END;
$$;

-- ============================================================================
-- 3. Bump schema version
-- ============================================================================
UPDATE summit_config SET value = '9' WHERE key = 'chassis_schema_version';
