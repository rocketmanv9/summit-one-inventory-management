-- @summit/chassis - Migration 00003: Events Outbox Table
--
-- Creates the events_outbox table used by publishEvent().
-- This migration is idempotent (safe to run multiple times).
-- No dependency on auth.tenants or any non-standard tables.

-- ============================================================================
-- 1. Create events_outbox table
-- ============================================================================
CREATE TABLE IF NOT EXISTS events_outbox (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type             TEXT        NOT NULL,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id        TEXT        NOT NULL,
  actor            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  correlation_id   TEXT,
  idempotency_key  TEXT,
  payload          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  version          INT         NOT NULL DEFAULT 1,

  -- Delivery tracking
  --   pending   → row waiting to be claimed by a poller
  --   leased    → claimed by a poller, locked until lease_expires_at
  --   dispatched → successfully delivered
  --   failed    → exhausted retries, moved to dead-letter
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'dispatched', 'failed')),
  dispatched_at    TIMESTAMPTZ,
  dispatch_error   TEXT,
  retry_count      INT         NOT NULL DEFAULT 0,

  -- Lease columns: prevent double-dispatch when poller crashes mid-batch
  leased_by        TEXT,                  -- poller instance identifier
  lease_expires_at TIMESTAMPTZ,           -- lease auto-expires, row becomes reclaimable

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for the poller: fetch oldest pending events per tenant
CREATE INDEX IF NOT EXISTS idx_events_outbox_pending
  ON events_outbox (status, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_events_outbox_tenant
  ON events_outbox (tenant_id, created_at DESC);

-- Index for reclaiming expired leases
CREATE INDEX IF NOT EXISTS idx_events_outbox_expired_leases
  ON events_outbox (lease_expires_at)
  WHERE status = 'leased';

-- Add lease columns idempotently (for existing installations)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_outbox' AND column_name = 'leased_by'
  ) THEN
    ALTER TABLE events_outbox ADD COLUMN leased_by TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_outbox' AND column_name = 'lease_expires_at'
  ) THEN
    ALTER TABLE events_outbox ADD COLUMN lease_expires_at TIMESTAMPTZ;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE events_outbox ENABLE ROW LEVEL SECURITY;

-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- RLS policies for events_outbox
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- ACCESS PATTERN:
--   Service role (service_role key) — full CRUD. Used by pollers and publishEvent().
--   Authenticated role — INSERT only, tenant-scoped. Allows app code running
--     under a user JWT to publish events, but never read/drain the outbox.
--   Anon role — no access.
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- Drop the old permissive-everything policy if it exists (upgrade path)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'events_outbox' AND policyname = 'Service manages events outbox'
  ) THEN
    DROP POLICY "Service manages events outbox" ON events_outbox;
  END IF;
END $$;

-- Service role: full access (pollers, mark-dispatched, cleanup)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'events_outbox' AND policyname = 'service_role full access'
  ) THEN
    CREATE POLICY "service_role full access"
      ON events_outbox
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Authenticated users: can INSERT events scoped to their tenant only
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'events_outbox' AND policyname = 'authenticated can insert own tenant events'
  ) THEN
    CREATE POLICY "authenticated can insert own tenant events"
      ON events_outbox
      FOR INSERT
      TO authenticated
      WITH CHECK (
        tenant_id = coalesce(
          current_setting('app.current_tenant_id', true),
          ''
        )
      );
  END IF;
END $$;

-- Allow 'leased' as a valid status (idempotent constraint replacement)
ALTER TABLE events_outbox DROP CONSTRAINT IF EXISTS events_outbox_status_check;
ALTER TABLE events_outbox ADD CONSTRAINT events_outbox_status_check
  CHECK (status IN ('pending', 'leased', 'dispatched', 'failed'));

-- ============================================================================
-- 2. Claim a batch of pending events (concurrency-safe, lease-based)
-- ============================================================================
-- Uses FOR UPDATE SKIP LOCKED so multiple pollers never claim the same row.
-- Sets lease_expires_at so crashed pollers don't hold events forever.
-- Also reclaims rows whose lease has expired (status = 'leased' AND lease_expires_at < now()).
--
-- p_poller_id:      string identifying this poller instance (e.g. hostname or UUID)
-- p_batch_size:     max rows to claim (default 50)
-- p_lease_seconds:  how long the lease lasts before auto-expiry (default 60)
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
    WHERE status = 'pending'
       OR (status = 'leased' AND lease_expires_at < now())  -- reclaim expired leases
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
-- 3. Mark events as dispatched (batch update)
-- ============================================================================
-- Only transitions from 'leased' to prevent double-dispatch.
-- A poller that lost its lease (another poller reclaimed) will no-op here.
CREATE OR REPLACE FUNCTION outbox_mark_dispatched(p_event_ids UUID[])
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE events_outbox
  SET status           = 'dispatched',
      dispatched_at    = now(),
      leased_by        = NULL,
      lease_expires_at = NULL
  WHERE id = ANY(p_event_ids)
    AND status = 'leased';
END;
$$;

-- ============================================================================
-- 4. Mark event as failed (with retry)
-- ============================================================================
-- Retry: resets to 'pending' so next poll picks it up.
-- After 5 retries: moves to 'failed' (dead-letter).
CREATE OR REPLACE FUNCTION outbox_mark_failed(
  p_event_id UUID,
  p_error    TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE events_outbox
  SET status           = CASE WHEN retry_count >= 5 THEN 'failed' ELSE 'pending' END,
      dispatch_error   = p_error,
      retry_count      = retry_count + 1,
      leased_by        = NULL,
      lease_expires_at = NULL
  WHERE id = p_event_id
    AND status = 'leased';
END;
$$;

-- ============================================================================
-- 5. Cleanup old dispatched events
-- ============================================================================
CREATE OR REPLACE FUNCTION cleanup_events_outbox(days_to_keep INT DEFAULT 30)
RETURNS TABLE(deleted_count BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  DELETE FROM events_outbox
  WHERE status = 'dispatched'
    AND dispatched_at < now() - (days_to_keep || ' days')::interval;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count;
END;
$$;
