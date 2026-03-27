-- @summit/chassis - Migration 00005: Outbox Retry Backoff + Schema Version
--
-- Adds:
-- 1. next_attempt_at and attempt_count columns to events_outbox for exponential backoff.
-- 2. Updates outbox_claim_batch to honor next_attempt_at.
-- 3. Updates outbox_mark_failed with exponential backoff (30s base, doubling, capped at 30m).
-- 4. Auto-move to dead letter after max attempts (5).
-- 5. chassis_schema_version in summit_config.
--
-- This migration is idempotent (safe to run multiple times).

-- ============================================================================
-- 1. Add backoff columns to events_outbox (idempotent)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_outbox' AND column_name = 'next_attempt_at'
  ) THEN
    ALTER TABLE events_outbox ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_outbox' AND column_name = 'attempt_count'
  ) THEN
    ALTER TABLE events_outbox ADD COLUMN attempt_count INT NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Index for backoff-aware claiming
CREATE INDEX IF NOT EXISTS idx_events_outbox_next_attempt
  ON events_outbox (next_attempt_at ASC)
  WHERE status IN ('pending', 'leased');

-- ============================================================================
-- 2. Updated outbox_claim_batch — honors next_attempt_at
-- ============================================================================
-- Only claims rows where next_attempt_at <= now().
-- This prevents re-claiming events that are in a backoff window.
CREATE OR REPLACE FUNCTION outbox_claim_batch(
  p_batch_size    INT  DEFAULT 50,
  p_poller_id     TEXT DEFAULT 'default',
  p_lease_seconds INT  DEFAULT 60
)
RETURNS SETOF events_outbox
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT id
    FROM events_outbox
    WHERE (
      (status = 'pending' AND next_attempt_at <= now())
      OR (status = 'leased' AND lease_expires_at < now())  -- reclaim expired leases
    )
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE events_outbox e
  SET status           = 'leased',
      leased_by        = p_poller_id,
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval
  FROM claimable c
  WHERE e.id = c.id
  RETURNING e.*;
END;
$$;

-- ============================================================================
-- 3. Updated outbox_mark_failed — exponential backoff + dead-letter
-- ============================================================================
-- Backoff: base 30s, doubling per attempt, capped at 30 minutes.
-- After 5 attempts, automatically moves to dead letter.
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
  -- Get current attempt count
  SELECT attempt_count INTO v_attempt_count
  FROM events_outbox
  WHERE id = p_event_id AND status = 'leased';

  IF NOT FOUND THEN
    RETURN;  -- Event not found or not leased; no-op
  END IF;

  v_attempt_count := v_attempt_count + 1;

  IF v_attempt_count >= v_max_attempts THEN
    -- Move to dead letter
    SELECT * INTO v_event FROM events_outbox WHERE id = p_event_id;

    INSERT INTO events_dead_letter (
      original_event_id, event_type, tenant_id, payload, actor,
      correlation_id, error, attempts, original_created_at
    ) VALUES (
      v_event.id, v_event.type, v_event.tenant_id, v_event.payload, v_event.actor,
      v_event.correlation_id, p_error, v_attempt_count, v_event.created_at
    );

    UPDATE events_outbox
    SET status           = 'failed',
        dispatch_error   = p_error,
        attempt_count    = v_attempt_count,
        retry_count      = retry_count + 1,
        leased_by        = NULL,
        lease_expires_at = NULL
    WHERE id = p_event_id;
  ELSE
    -- Exponential backoff: 30s * 2^(attempt-1), capped at 1800s (30m)
    v_backoff_seconds := LEAST(30 * POWER(2, v_attempt_count - 1)::INT, 1800);

    UPDATE events_outbox
    SET status           = 'pending',
        dispatch_error   = p_error,
        attempt_count    = v_attempt_count,
        retry_count      = retry_count + 1,
        next_attempt_at  = now() + (v_backoff_seconds || ' seconds')::interval,
        leased_by        = NULL,
        lease_expires_at = NULL
    WHERE id = p_event_id
      AND status = 'leased';
  END IF;
END;
$$;

-- ============================================================================
-- 4. Set chassis_schema_version in summit_config
-- ============================================================================
INSERT INTO summit_config (key, value, description) VALUES
  ('chassis_schema_version', '5'::jsonb, 'Chassis DB schema version — checked by assertChassisSchemaVersion()')
ON CONFLICT (key) DO UPDATE SET
  value = '5'::jsonb,
  description = 'Chassis DB schema version — checked by assertChassisSchemaVersion()';
