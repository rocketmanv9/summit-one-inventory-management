-- @summit/chassis - Migration 00002: Atomic Idempotency Keys
--
-- Replaces the processed_events-based idempotency with an atomic
-- INSERT ... ON CONFLICT pattern using RPC functions.
--
-- This migration is idempotent (safe to run multiple times).
-- No dependency on auth.tenants or any non-standard tables.

-- ============================================================================
-- 1. Create idempotency_keys table
-- ============================================================================
CREATE TABLE IF NOT EXISTS idempotency_keys (
  tenant_id  TEXT        NOT NULL,
  key        TEXT        NOT NULL,
  scope      TEXT        NOT NULL DEFAULT 'default',
  status     TEXT        NOT NULL DEFAULT 'processing'
                         CHECK (status IN ('processing', 'completed')),
  result     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,

  PRIMARY KEY (tenant_id, key, scope)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at
  ON idempotency_keys (created_at);

-- Enable RLS
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- RLS policies for idempotency_keys
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- ACCESS PATTERN:
--   Service role — full CRUD. The withIdempotency() helper runs server-side
--     with the service_role key. It claims, completes, and releases keys.
--   Authenticated role — no direct access. Idempotency is managed by the
--     server-side handler, not by the client. Allowing direct access would let
--     a user pre-claim keys to DoS other users' writes.
--   Anon role — no access.
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- Drop the old permissive-everything policy if it exists (upgrade path)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'idempotency_keys' AND policyname = 'Service manages idempotency keys'
  ) THEN
    DROP POLICY "Service manages idempotency keys" ON idempotency_keys;
  END IF;
END $$;

-- Service role: full access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'idempotency_keys' AND policyname = 'service_role full access'
  ) THEN
    CREATE POLICY "service_role full access"
      ON idempotency_keys
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- ============================================================================
-- 2. Atomic claim function
-- ============================================================================
-- Returns JSON: { "status": "claimed" | "completed" | "processing", "result": ... }
CREATE OR REPLACE FUNCTION idempotency_claim(
  p_tenant_id TEXT,
  p_idempotency_key TEXT,
  p_scope TEXT DEFAULT 'default'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing RECORD;
BEGIN
  -- Attempt atomic insert
  INSERT INTO idempotency_keys (tenant_id, key, scope, status)
  VALUES (p_tenant_id, p_idempotency_key, p_scope, 'processing')
  ON CONFLICT (tenant_id, key, scope) DO NOTHING;

  -- Check what's there
  SELECT status, result INTO v_existing
  FROM idempotency_keys
  WHERE tenant_id = p_tenant_id
    AND key = p_idempotency_key
    AND scope = p_scope;

  IF v_existing IS NULL THEN
    -- Should not happen, but defensive
    RETURN jsonb_build_object('status', 'claimed');
  END IF;

  IF v_existing.status = 'completed' THEN
    RETURN jsonb_build_object('status', 'completed', 'result', v_existing.result);
  END IF;

  -- status = 'processing'
  -- Check if WE just inserted it (no completed_at) or if it's a stale lock
  -- If created_at is older than 5 minutes and still processing, treat as stale and reclaim
  IF EXISTS (
    SELECT 1 FROM idempotency_keys
    WHERE tenant_id = p_tenant_id
      AND key = p_idempotency_key
      AND scope = p_scope
      AND status = 'processing'
      AND created_at < now() - interval '5 minutes'
  ) THEN
    -- Stale lock, reclaim it
    UPDATE idempotency_keys
    SET created_at = now(), result = NULL
    WHERE tenant_id = p_tenant_id
      AND key = p_idempotency_key
      AND scope = p_scope
      AND status = 'processing';
    RETURN jsonb_build_object('status', 'claimed');
  END IF;

  -- We either just claimed it, or another request is processing.
  -- Use advisory lock on the row to distinguish.
  -- If we can get the lock, we own it.
  IF pg_try_advisory_xact_lock(hashtext(p_tenant_id || ':' || p_idempotency_key || ':' || p_scope)) THEN
    RETURN jsonb_build_object('status', 'claimed');
  ELSE
    RETURN jsonb_build_object('status', 'processing');
  END IF;
END;
$$;

-- ============================================================================
-- 3. Complete function (store result)
-- ============================================================================
CREATE OR REPLACE FUNCTION idempotency_complete(
  p_tenant_id TEXT,
  p_idempotency_key TEXT,
  p_scope TEXT DEFAULT 'default',
  p_result JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE idempotency_keys
  SET status = 'completed',
      result = p_result,
      completed_at = now()
  WHERE tenant_id = p_tenant_id
    AND key = p_idempotency_key
    AND scope = p_scope;
END;
$$;

-- ============================================================================
-- 4. Release function (on handler failure, allow retry)
-- ============================================================================
CREATE OR REPLACE FUNCTION idempotency_release(
  p_tenant_id TEXT,
  p_idempotency_key TEXT,
  p_scope TEXT DEFAULT 'default'
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM idempotency_keys
  WHERE tenant_id = p_tenant_id
    AND key = p_idempotency_key
    AND scope = p_scope
    AND status = 'processing';
END;
$$;

-- ============================================================================
-- 5. Cleanup function (retention)
-- ============================================================================
CREATE OR REPLACE FUNCTION cleanup_idempotency_keys(days_to_keep INT DEFAULT 30)
RETURNS TABLE(deleted_count BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  DELETE FROM idempotency_keys
  WHERE created_at < now() - (days_to_keep || ' days')::interval;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count;
END;
$$;
