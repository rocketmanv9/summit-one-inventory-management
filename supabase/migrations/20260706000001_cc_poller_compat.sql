-- 20260706000001_cc_poller_compat.sql
-- Chassis migration 00012 (v2.3.0): Command Center poller compatibility.
-- Applied to stage as: cc_poller_compat
--
-- 1. next_attempt_at NULLABLE — CC's events-poller writes NULL on publish
--    (NULL = "due now" per the Summit Publisher Protocol).
-- 2. locked_at/locked_by — the poller's claim columns.
-- 3. chassis_schema_version = 12 (required by chassis >= 2.3.0 runtime check).
--
-- Idempotent. (This DB's summit_config predates the description column.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events_outbox'
      AND column_name = 'next_attempt_at' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE events_outbox ALTER COLUMN next_attempt_at DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE events_outbox ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE events_outbox ADD COLUMN IF NOT EXISTS locked_by TEXT;

CREATE INDEX IF NOT EXISTS idx_events_outbox_cc_claim
  ON events_outbox (created_at ASC)
  WHERE status = 'pending' AND locked_at IS NULL;

INSERT INTO summit_config (key, value) VALUES
  ('chassis_schema_version', '12'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = '12'::jsonb;
