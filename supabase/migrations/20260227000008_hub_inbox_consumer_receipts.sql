-- @summit/chassis - Migration 00008: Hub Event Inbox + Consumer Receipts
--
-- Adds the consumer/inbox side of the Summit Publisher Protocol:
-- 1. hub_event_inbox table       — idempotent store for events received FROM Hub
-- 2. consumer_event_receipts     — exactly-once processing guard per consumer
-- 3. hub_inbox_try_insert() RPC  — called by the hub-ingest edge function
-- 4. consumer_try_begin() RPC    — called by consumer workers before processing
-- 5. RLS policies for both tables
-- 6. summit_bot policies for both tables
--
-- This migration is idempotent (safe to run multiple times).
-- Depends on: 00004 (fn_update_timestamp, summit_config)

-- ============================================================================
-- 1. hub_event_inbox table
-- ============================================================================
-- Status model:
--   received    = inserted, not yet claimed by a worker
--   processing  = claimed by a worker (requires lock + lease)
--   processed   = terminal success (requires processed_at)
--   failed      = retryable, waiting for next_attempt_at
--   dead        = exhausted attempts / manual intervention needed
CREATE TABLE IF NOT EXISTS hub_event_inbox (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_event_id     UUID        NOT NULL,

  tenant_id        UUID,
  event_type       TEXT        NOT NULL,
  event_version    INTEGER     NOT NULL DEFAULT 1,
  correlation_id   UUID,
  causation_id     UUID,
  trace_id         UUID,

  payload          JSONB       NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  status           TEXT        NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','processing','processed','failed','dead')),

  attempts         INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempt_at  TIMESTAMPTZ,
  next_attempt_at  TIMESTAMPTZ,
  processed_at     TIMESTAMPTZ,

  error_message    TEXT CHECK (error_message IS NULL OR length(error_message) <= 2000),
  last_error_at    TIMESTAMPTZ,
  error_type       TEXT CHECK (error_type IS NULL OR length(error_type) <= 120),

  locked_at        TIMESTAMPTZ,
  locked_by        TEXT,
  lease_expires_at TIMESTAMPTZ,

  CONSTRAINT hub_event_inbox_hub_event_id_uk UNIQUE (hub_event_id)
);

-- Integrity constraints (rerunnable)
ALTER TABLE hub_event_inbox
  DROP CONSTRAINT IF EXISTS hub_inbox_processing_requires_lock;
ALTER TABLE hub_event_inbox
  ADD CONSTRAINT hub_inbox_processing_requires_lock
  CHECK (
    (status <> 'processing')
    OR (locked_at IS NOT NULL AND locked_by IS NOT NULL AND lease_expires_at IS NOT NULL)
  );

ALTER TABLE hub_event_inbox
  DROP CONSTRAINT IF EXISTS hub_inbox_lock_implies_processing;
ALTER TABLE hub_event_inbox
  ADD CONSTRAINT hub_inbox_lock_implies_processing
  CHECK (
    (locked_at IS NULL) OR (status = 'processing')
  );

ALTER TABLE hub_event_inbox
  DROP CONSTRAINT IF EXISTS hub_inbox_processed_requires_processed_at;
ALTER TABLE hub_event_inbox
  ADD CONSTRAINT hub_inbox_processed_requires_processed_at
  CHECK (
    (status <> 'processed') OR (processed_at IS NOT NULL)
  );

-- Claim indexes: workers find receivable/retryable events
CREATE INDEX IF NOT EXISTS ix_hub_inbox_claim_due
ON hub_event_inbox(status, next_attempt_at, received_at)
WHERE status IN ('received','failed') AND locked_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_hub_inbox_claim_due_tenant
ON hub_event_inbox(tenant_id, status, next_attempt_at, received_at)
WHERE status IN ('received','failed') AND locked_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_hub_inbox_lease_expired
ON hub_event_inbox(lease_expires_at)
WHERE lease_expires_at IS NOT NULL AND status = 'processing';

CREATE INDEX IF NOT EXISTS ix_hub_inbox_event_type
ON hub_event_inbox(event_type);

-- ============================================================================
-- 2. consumer_event_receipts table (exactly-once processing guard)
-- ============================================================================
-- Prevents double-applying the same inbox event per consumer.
-- consumer_key examples:
--   'hr.user_projection_v1'
--   'core.tenant_projection_v1'
--   'fleet.asset_projection_v2'
CREATE TABLE IF NOT EXISTS consumer_event_receipts (
  consumer_key   TEXT        NOT NULL,
  hub_event_id   UUID        NOT NULL,
  inbox_id       UUID        NULL, -- optional: link to hub_event_inbox.id for debugging
  processed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (consumer_key, hub_event_id)
);

CREATE INDEX IF NOT EXISTS idx_consumer_receipts_hub_event
  ON consumer_event_receipts(hub_event_id);

CREATE INDEX IF NOT EXISTS idx_consumer_receipts_consumer
  ON consumer_event_receipts(consumer_key);

-- ============================================================================
-- 3. RLS on new tables
-- ============================================================================
ALTER TABLE hub_event_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumer_event_receipts ENABLE ROW LEVEL SECURITY;

-- hub_event_inbox: service_role full access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hub_event_inbox' AND policyname = 'service_role full access'
  ) THEN
    CREATE POLICY "service_role full access"
      ON hub_event_inbox FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- consumer_event_receipts: service_role full access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'consumer_event_receipts' AND policyname = 'service_role full access'
  ) THEN
    CREATE POLICY "service_role full access"
      ON consumer_event_receipts FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- summit_bot policies (wrapped in EXCEPTION handler in case role doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hub_event_inbox' AND policyname = 'summit_bot full access'
  ) THEN
    CREATE POLICY "summit_bot full access"
      ON hub_event_inbox FOR ALL TO summit_bot
      USING (true) WITH CHECK (true);
  END IF;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'consumer_event_receipts' AND policyname = 'summit_bot full access'
  ) THEN
    CREATE POLICY "summit_bot full access"
      ON consumer_event_receipts FOR ALL TO summit_bot
      USING (true) WITH CHECK (true);
  END IF;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- ============================================================================
-- 4. hub_inbox_try_insert() — idempotent insert called by edge function
-- ============================================================================
-- Returns { inserted: boolean, inbox_id: uuid }
CREATE OR REPLACE FUNCTION hub_inbox_try_insert(
  p_hub_event_id  UUID,
  p_tenant_id     UUID,
  p_event_type    TEXT,
  p_event_version INTEGER,
  p_correlation_id UUID,
  p_causation_id  UUID,
  p_trace_id      UUID,
  p_payload       JSONB
) RETURNS TABLE(inserted BOOLEAN, inbox_id UUID)
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO hub_event_inbox (
    hub_event_id, tenant_id, event_type, event_version,
    correlation_id, causation_id, trace_id, payload,
    status, received_at
  )
  VALUES (
    p_hub_event_id, p_tenant_id, p_event_type, COALESCE(p_event_version, 1),
    p_correlation_id, p_causation_id, p_trace_id, p_payload,
    'received', NOW()
  )
  ON CONFLICT (hub_event_id) DO NOTHING;

  IF FOUND THEN
    RETURN QUERY
      SELECT TRUE, (SELECT id FROM hub_event_inbox WHERE hub_event_id = p_hub_event_id);
  ELSE
    RETURN QUERY
      SELECT FALSE, (SELECT id FROM hub_event_inbox WHERE hub_event_id = p_hub_event_id);
  END IF;
END;
$$;

-- ============================================================================
-- 5. consumer_try_begin() — exactly-once guard for consumer workers
-- ============================================================================
-- Returns TRUE if this consumer should process (first time),
-- FALSE if already processed (duplicate/retry).
CREATE OR REPLACE FUNCTION consumer_try_begin(
  p_consumer_key  TEXT,
  p_hub_event_id  UUID,
  p_inbox_id      UUID DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO consumer_event_receipts (consumer_key, hub_event_id, inbox_id)
  VALUES (p_consumer_key, p_hub_event_id, p_inbox_id)
  ON CONFLICT (consumer_key, hub_event_id) DO NOTHING;

  RETURN FOUND; -- TRUE if inserted, FALSE if already existed
END;
$$;

-- ============================================================================
-- 6. Bump chassis schema version
-- ============================================================================
INSERT INTO summit_config (key, value, description)
VALUES ('chassis_schema_version', '"8"'::jsonb, 'Chassis DB schema version')
ON CONFLICT (key) DO UPDATE SET value = '"8"'::jsonb;
