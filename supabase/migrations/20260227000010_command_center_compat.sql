-- @summit/chassis - Migration 00010: Command Center Schema Compatibility
--
-- Reconciles the chassis schema with the Summit One Command Center's
-- Webhook Store expectations. Adds alias columns and missing fields so
-- that services built from the chassis work as CC data sources with zero
-- manual SQL.
--
-- Changes:
--   event_catalog:  +event_key, +display_name, +payload_example, +owner_module,
--                   +aggregate_type, +event_version, +is_deprecated, +deprecated_reason
--   events_outbox:  +event_type, +event_version, +aggregate_type, +aggregate_id,
--                   +actor_user_id, +trace_id, +error_message, +published_at, +attempts
--
-- This migration is idempotent (safe to run multiple times).
-- It does NOT drop or rename existing columns — only adds new ones.

-- ============================================================================
-- 1. event_catalog — Add Command Center columns
-- ============================================================================
DO $$
BEGIN
  -- event_key: mirrors event_type for CC compatibility (CC uses event_key as primary lookup)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_catalog' AND column_name = 'event_key'
  ) THEN
    ALTER TABLE event_catalog ADD COLUMN event_key TEXT;
  END IF;

  -- display_name: human-readable event name for CC UI
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_catalog' AND column_name = 'display_name'
  ) THEN
    ALTER TABLE event_catalog ADD COLUMN display_name TEXT;
  END IF;

  -- payload_example: example payload JSON for CC catalog display
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_catalog' AND column_name = 'payload_example'
  ) THEN
    ALTER TABLE event_catalog ADD COLUMN payload_example JSONB;
  END IF;

  -- owner_module: which module/service owns this event type
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_catalog' AND column_name = 'owner_module'
  ) THEN
    ALTER TABLE event_catalog ADD COLUMN owner_module TEXT;
  END IF;

  -- aggregate_type: DDD aggregate this event belongs to
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_catalog' AND column_name = 'aggregate_type'
  ) THEN
    ALTER TABLE event_catalog ADD COLUMN aggregate_type TEXT;
  END IF;

  -- event_version: alias for schema_version (CC reads event_version)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_catalog' AND column_name = 'event_version'
  ) THEN
    ALTER TABLE event_catalog ADD COLUMN event_version INT;
  END IF;

  -- is_deprecated: marks deprecated event types in CC UI
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_catalog' AND column_name = 'is_deprecated'
  ) THEN
    ALTER TABLE event_catalog ADD COLUMN is_deprecated BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- deprecated_reason: explanation for deprecation
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_catalog' AND column_name = 'deprecated_reason'
  ) THEN
    ALTER TABLE event_catalog ADD COLUMN deprecated_reason TEXT;
  END IF;
END $$;

-- Backfill existing rows: event_key = event_type, event_version = schema_version
UPDATE event_catalog SET event_key = event_type WHERE event_key IS NULL;
UPDATE event_catalog SET event_version = schema_version WHERE event_version IS NULL;

-- Auto-generate display_name from event_type for existing rows
-- e.g. "inventory.item_created" → "Item Created"
UPDATE event_catalog
SET display_name = INITCAP(REPLACE(
  CASE
    WHEN event_type LIKE '%.%' THEN SPLIT_PART(event_type, '.', 2)
    ELSE event_type
  END,
  '_', ' '
))
WHERE display_name IS NULL;

-- Unique index on event_key (CC uses it as primary lookup)
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_catalog_event_key
  ON event_catalog (event_key);

-- ============================================================================
-- 2. events_outbox — Add Command Center alias columns
-- ============================================================================
DO $$
BEGIN
  -- event_type: alias for "type" column (CC reads event_type)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_outbox' AND column_name = 'event_type'
  ) THEN
    ALTER TABLE events_outbox ADD COLUMN event_type TEXT;
  END IF;

  -- event_version: alias for "version" column (CC reads event_version)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_outbox' AND column_name = 'event_version'
  ) THEN
    ALTER TABLE events_outbox ADD COLUMN event_version INT;
  END IF;

  -- aggregate_type: DDD aggregate type
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_outbox' AND column_name = 'aggregate_type'
  ) THEN
    ALTER TABLE events_outbox ADD COLUMN aggregate_type TEXT;
  END IF;

  -- aggregate_id: DDD aggregate instance ID
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_outbox' AND column_name = 'aggregate_id'
  ) THEN
    ALTER TABLE events_outbox ADD COLUMN aggregate_id UUID;
  END IF;

  -- actor_user_id: extracted UUID from actor JSONB (CC reads this)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_outbox' AND column_name = 'actor_user_id'
  ) THEN
    ALTER TABLE events_outbox ADD COLUMN actor_user_id UUID;
  END IF;

  -- trace_id: trace identifier for observability (CC reads this)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_outbox' AND column_name = 'trace_id'
  ) THEN
    ALTER TABLE events_outbox ADD COLUMN trace_id TEXT;
  END IF;

  -- error_message: alias for dispatch_error (CC reads error_message)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_outbox' AND column_name = 'error_message'
  ) THEN
    ALTER TABLE events_outbox ADD COLUMN error_message TEXT;
  END IF;

  -- published_at: alias for dispatched_at (CC reads published_at)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_outbox' AND column_name = 'published_at'
  ) THEN
    ALTER TABLE events_outbox ADD COLUMN published_at TIMESTAMPTZ;
  END IF;

  -- attempts: alias for retry_count (CC reads attempts)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_outbox' AND column_name = 'attempts'
  ) THEN
    ALTER TABLE events_outbox ADD COLUMN attempts INT NOT NULL DEFAULT 0;
  END IF;

  -- last_attempt_at: CC reads this from outbox
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_outbox' AND column_name = 'last_attempt_at'
  ) THEN
    ALTER TABLE events_outbox ADD COLUMN last_attempt_at TIMESTAMPTZ;
  END IF;

  -- locked_at: CC standard schema expects this
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_outbox' AND column_name = 'locked_at'
  ) THEN
    ALTER TABLE events_outbox ADD COLUMN locked_at TIMESTAMPTZ;
  END IF;
END $$;

-- Backfill existing outbox rows (runs BEFORE trigger update, so immutability
-- trigger still uses the old column list and won't block these UPDATEs)
UPDATE events_outbox SET event_type = type WHERE event_type IS NULL;
UPDATE events_outbox SET event_version = version WHERE event_version IS NULL;
UPDATE events_outbox SET error_message = dispatch_error WHERE error_message IS NULL AND dispatch_error IS NOT NULL;
UPDATE events_outbox SET published_at = dispatched_at WHERE published_at IS NULL AND dispatched_at IS NOT NULL;
UPDATE events_outbox SET attempts = retry_count WHERE attempts = 0 AND retry_count > 0;
UPDATE events_outbox SET trace_id = correlation_id WHERE trace_id IS NULL AND correlation_id IS NOT NULL;

-- Extract actor_user_id from actor JSONB where it's a valid UUID
UPDATE events_outbox
SET actor_user_id = (actor ->> 'user_id')::UUID
WHERE actor_user_id IS NULL
  AND actor ->> 'user_id' IS NOT NULL
  AND actor ->> 'user_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- ── Status value migration ──────────────────────────────────────────────────
-- CC uses 'processing' (not 'leased') and 'published' (not 'dispatched').
-- Backfill existing rows to CC-standard values.
UPDATE events_outbox SET status = 'published' WHERE status = 'dispatched';
UPDATE events_outbox SET status = 'processing' WHERE status = 'leased';

-- Replace CHECK constraint with CC-compatible values
ALTER TABLE events_outbox DROP CONSTRAINT IF EXISTS events_outbox_status_check;
ALTER TABLE events_outbox ADD CONSTRAINT events_outbox_status_check
  CHECK (status IN ('pending', 'processing', 'published', 'failed', 'dead'));

-- ── Fix partial indexes (drop old 'leased'/'dispatched' references) ────────
DROP INDEX IF EXISTS idx_events_outbox_expired_leases;
DROP INDEX IF EXISTS idx_events_outbox_next_attempt;
DROP INDEX IF EXISTS idx_events_outbox_pending;

-- Recreate with CC-standard status values
CREATE INDEX IF NOT EXISTS idx_events_outbox_pending
  ON events_outbox (status, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_events_outbox_expired_leases
  ON events_outbox (lease_expires_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_events_outbox_next_attempt
  ON events_outbox (next_attempt_at ASC)
  WHERE status IN ('pending', 'processing');

-- Indexes for CC queries
CREATE INDEX IF NOT EXISTS idx_events_outbox_aggregate
  ON events_outbox (aggregate_type, aggregate_id) WHERE aggregate_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_outbox_trace_id
  ON events_outbox (trace_id) WHERE trace_id IS NOT NULL;

-- ============================================================================
-- 3. Update emit_event() RPC — populate alias columns on insert
-- ============================================================================
CREATE OR REPLACE FUNCTION emit_event(
  p_type            TEXT,
  p_tenant_id       TEXT,
  p_payload         JSONB       DEFAULT '{}'::jsonb,
  p_actor           JSONB       DEFAULT '{}'::jsonb,
  p_correlation_id  TEXT        DEFAULT NULL,
  p_idempotency_key TEXT        DEFAULT NULL,
  p_version         INT         DEFAULT 1,
  -- CC-compatible parameters
  p_aggregate_type  TEXT        DEFAULT NULL,
  p_aggregate_id    UUID        DEFAULT NULL,
  p_actor_user_id   UUID        DEFAULT NULL,
  p_trace_id        TEXT        DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
  v_actor_user_id UUID;
BEGIN
  -- Extract actor_user_id from actor JSONB if not explicitly provided
  v_actor_user_id := p_actor_user_id;
  IF v_actor_user_id IS NULL AND p_actor ->> 'user_id' IS NOT NULL THEN
    BEGIN
      v_actor_user_id := (p_actor ->> 'user_id')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      v_actor_user_id := NULL;
    END;
  END IF;

  INSERT INTO events_outbox (
    type, tenant_id, payload, actor, correlation_id, idempotency_key, version,
    event_type, event_version, aggregate_type, aggregate_id, actor_user_id, trace_id
  )
  VALUES (
    p_type, p_tenant_id, p_payload, p_actor, p_correlation_id, p_idempotency_key, p_version,
    p_type, p_version, p_aggregate_type, p_aggregate_id, v_actor_user_id,
    COALESCE(p_trace_id, p_correlation_id)
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============================================================================
-- 4. Update register_event() RPC — accept and populate CC columns
-- ============================================================================
CREATE OR REPLACE FUNCTION register_event(
  p_event_type       TEXT,
  p_description      TEXT        DEFAULT NULL,
  p_payload_schema   JSONB       DEFAULT NULL,
  p_schema_version   INT         DEFAULT 1,
  p_category         TEXT        DEFAULT NULL,
  p_is_internal      BOOLEAN     DEFAULT false,
  p_payload_notes    TEXT        DEFAULT NULL,
  -- CC-compatible parameters
  p_display_name     TEXT        DEFAULT NULL,
  p_payload_example  JSONB       DEFAULT NULL,
  p_owner_module     TEXT        DEFAULT NULL,
  p_aggregate_type   TEXT        DEFAULT NULL,
  p_is_deprecated    BOOLEAN     DEFAULT false,
  p_deprecated_reason TEXT       DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
  v_display_name TEXT;
BEGIN
  -- Auto-generate display_name from event_type if not provided
  -- e.g. "inventory.item_created" → "Item Created"
  v_display_name := p_display_name;
  IF v_display_name IS NULL THEN
    v_display_name := INITCAP(REPLACE(
      CASE
        WHEN p_event_type LIKE '%.%' THEN SPLIT_PART(p_event_type, '.', 2)
        ELSE p_event_type
      END,
      '_', ' '
    ));
  END IF;

  INSERT INTO event_catalog (
    event_type, description, payload_schema, schema_version, category, is_internal, payload_notes,
    event_key, event_version, display_name, payload_example, owner_module, aggregate_type,
    is_deprecated, deprecated_reason
  )
  VALUES (
    p_event_type, p_description, p_payload_schema, p_schema_version, p_category, p_is_internal, p_payload_notes,
    p_event_type, p_schema_version, v_display_name, p_payload_example, p_owner_module, p_aggregate_type,
    p_is_deprecated, p_deprecated_reason
  )
  ON CONFLICT (event_type) DO UPDATE SET
    description      = COALESCE(EXCLUDED.description, event_catalog.description),
    payload_schema   = COALESCE(EXCLUDED.payload_schema, event_catalog.payload_schema),
    schema_version   = EXCLUDED.schema_version,
    category         = COALESCE(EXCLUDED.category, event_catalog.category),
    is_internal      = EXCLUDED.is_internal,
    payload_notes    = COALESCE(EXCLUDED.payload_notes, event_catalog.payload_notes),
    event_key        = EXCLUDED.event_key,
    event_version    = EXCLUDED.schema_version,
    display_name     = COALESCE(EXCLUDED.display_name, event_catalog.display_name),
    payload_example  = COALESCE(EXCLUDED.payload_example, event_catalog.payload_example),
    owner_module     = COALESCE(EXCLUDED.owner_module, event_catalog.owner_module),
    aggregate_type   = COALESCE(EXCLUDED.aggregate_type, event_catalog.aggregate_type),
    is_deprecated    = EXCLUDED.is_deprecated,
    deprecated_reason = COALESCE(EXCLUDED.deprecated_reason, event_catalog.deprecated_reason)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============================================================================
-- 5. Update update_event_catalog_item() — handle CC columns
-- ============================================================================
CREATE OR REPLACE FUNCTION update_event_catalog_item(
  p_event_type       TEXT,
  p_description      TEXT        DEFAULT NULL,
  p_payload_schema   JSONB       DEFAULT NULL,
  p_schema_version   INT         DEFAULT NULL,
  p_category         TEXT        DEFAULT NULL,
  p_is_internal      BOOLEAN     DEFAULT NULL,
  p_payload_notes    TEXT        DEFAULT NULL,
  -- CC-compatible parameters
  p_display_name     TEXT        DEFAULT NULL,
  p_payload_example  JSONB       DEFAULT NULL,
  p_owner_module     TEXT        DEFAULT NULL,
  p_aggregate_type   TEXT        DEFAULT NULL,
  p_is_deprecated    BOOLEAN     DEFAULT NULL,
  p_deprecated_reason TEXT       DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE event_catalog SET
    description      = COALESCE(p_description, description),
    payload_schema   = COALESCE(p_payload_schema, payload_schema),
    schema_version   = COALESCE(p_schema_version, schema_version),
    category         = COALESCE(p_category, category),
    is_internal      = COALESCE(p_is_internal, is_internal),
    payload_notes    = COALESCE(p_payload_notes, payload_notes),
    event_version    = COALESCE(p_schema_version, event_version),
    display_name     = COALESCE(p_display_name, display_name),
    payload_example  = COALESCE(p_payload_example, payload_example),
    owner_module     = COALESCE(p_owner_module, owner_module),
    aggregate_type   = COALESCE(p_aggregate_type, aggregate_type),
    is_deprecated    = COALESCE(p_is_deprecated, is_deprecated),
    deprecated_reason = COALESCE(p_deprecated_reason, deprecated_reason)
  WHERE event_type = p_event_type;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event type "%" not found in catalog', p_event_type;
  END IF;
END;
$$;

-- ============================================================================
-- 6. Update outbox_mark_dispatched() — set published_at alias
-- ============================================================================
CREATE OR REPLACE FUNCTION outbox_mark_dispatched(p_event_ids UUID[])
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE events_outbox
  SET status           = 'published',
      dispatched_at    = now(),
      published_at     = now(),
      last_attempt_at  = now(),
      leased_by        = NULL,
      lease_expires_at = NULL,
      locked_at        = NULL
  WHERE id = ANY(p_event_ids)
    AND status = 'processing';
END;
$$;

-- ============================================================================
-- 7. Update outbox_mark_failed() — set CC alias columns
-- ============================================================================
CREATE OR REPLACE FUNCTION outbox_mark_failed(
  p_event_id UUID,
  p_error    TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_attempt_count INT;
  v_max_attempts  INT := 5;
  v_backoff_seconds INT;
  v_event events_outbox%ROWTYPE;
BEGIN
  SELECT attempt_count INTO v_attempt_count
  FROM events_outbox
  WHERE id = p_event_id AND status = 'processing';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_attempt_count := v_attempt_count + 1;

  IF v_attempt_count >= v_max_attempts THEN
    SELECT * INTO v_event FROM events_outbox WHERE id = p_event_id;

    INSERT INTO events_dead_letter (
      original_event_id, event_type, tenant_id, payload, actor,
      correlation_id, error, attempts, original_created_at,
      trace_id, causation_id
    ) VALUES (
      v_event.id, v_event.type, v_event.tenant_id, v_event.payload, v_event.actor,
      v_event.correlation_id, p_error, v_attempt_count, v_event.created_at,
      v_event.trace_id, v_event.payload ->> 'causation_id'
    );

    UPDATE events_outbox
    SET status           = 'failed',
        dispatch_error   = p_error,
        error_message    = p_error,
        attempt_count    = v_attempt_count,
        attempts         = v_attempt_count,
        retry_count      = retry_count + 1,
        last_attempt_at  = now(),
        locked_at        = now(),
        leased_by        = NULL,
        lease_expires_at = NULL
    WHERE id = p_event_id;
  ELSE
    v_backoff_seconds := LEAST(30 * POWER(2, v_attempt_count - 1)::INT, 1800);

    UPDATE events_outbox
    SET status           = 'pending',
        dispatch_error   = p_error,
        error_message    = p_error,
        attempt_count    = v_attempt_count,
        attempts         = v_attempt_count,
        retry_count      = retry_count + 1,
        last_attempt_at  = now(),
        next_attempt_at  = now() + (v_backoff_seconds || ' seconds')::interval,
        leased_by        = NULL,
        lease_expires_at = NULL
    WHERE id = p_event_id
      AND status = 'processing';
  END IF;
END;
$$;

-- ============================================================================
-- 8. Update move_to_dead_letter() — carry trace_id from outbox
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

  v_causation_id := v_event.payload ->> 'causation_id';

  INSERT INTO events_dead_letter (
    original_event_id, event_type, tenant_id, payload, actor,
    correlation_id, error, attempts, original_created_at,
    trace_id, causation_id
  ) VALUES (
    v_event.id, v_event.type, v_event.tenant_id, v_event.payload, v_event.actor,
    v_event.correlation_id, v_event.dispatch_error,
    COALESCE(v_event.attempts, v_event.retry_count),
    v_event.created_at, v_event.trace_id, v_causation_id
  )
  RETURNING id INTO v_dead_id;

  DELETE FROM events_outbox WHERE id = p_event_id;

  RETURN v_dead_id;
END;
$$;

-- ============================================================================
-- 9. Update immutability trigger — protect CC alias columns
--    (Runs AFTER backfill so existing data is already populated)
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_prevent_event_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.type IS DISTINCT FROM NEW.type
    OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.actor IS DISTINCT FROM NEW.actor
    OR OLD.payload IS DISTINCT FROM NEW.payload
    OR OLD.version IS DISTINCT FROM NEW.version
    OR OLD.occurred_at IS DISTINCT FROM NEW.occurred_at
    OR OLD.correlation_id IS DISTINCT FROM NEW.correlation_id
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.event_type IS DISTINCT FROM NEW.event_type
    OR OLD.event_version IS DISTINCT FROM NEW.event_version
    OR OLD.aggregate_type IS DISTINCT FROM NEW.aggregate_type
    OR OLD.aggregate_id IS DISTINCT FROM NEW.aggregate_id
    OR OLD.actor_user_id IS DISTINCT FROM NEW.actor_user_id
    OR OLD.trace_id IS DISTINCT FROM NEW.trace_id
  THEN
    RAISE EXCEPTION 'Cannot modify immutable event envelope columns';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 10. Update outbox_claim_batch() — CC-standard status values
-- ============================================================================
CREATE OR REPLACE FUNCTION outbox_claim_batch(
  p_batch_size    INT  DEFAULT 50,
  p_poller_id     TEXT DEFAULT 'default',
  p_lease_seconds INT  DEFAULT 60
) RETURNS SETOF events_outbox LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT id FROM events_outbox
    WHERE (status = 'pending' AND next_attempt_at <= now())
       OR (status = 'processing' AND lease_expires_at < now())
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE events_outbox e
  SET status = 'processing',
      leased_by = p_poller_id,
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
      locked_at = now()
  FROM claimable c WHERE e.id = c.id
  RETURNING e.*;
END;
$$;

-- ============================================================================
-- 11. Update cleanup_events_outbox() — use CC-standard 'published' status
-- ============================================================================
CREATE OR REPLACE FUNCTION cleanup_events_outbox(days_to_keep INT DEFAULT 30)
RETURNS TABLE(deleted_count BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  DELETE FROM events_outbox
  WHERE status = 'published'
    AND published_at < now() - (days_to_keep || ' days')::interval;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count;
END;
$$;

-- ============================================================================
-- 12. Bump schema version
-- ============================================================================
INSERT INTO summit_config (key, value, description) VALUES
  ('chassis_schema_version', '10'::jsonb, 'Chassis DB schema version — checked by assertChassisSchemaVersion()')
ON CONFLICT (key) DO UPDATE SET value = '10'::jsonb;
