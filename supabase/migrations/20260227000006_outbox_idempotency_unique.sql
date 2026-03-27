-- @summit/chassis - Migration 00006: Outbox Idempotency Unique Constraint
--
-- Adds a partial UNIQUE index on events_outbox.idempotency_key so that
-- emitOutboxEvent() can use ON CONFLICT (idempotency_key) DO NOTHING
-- for idempotent event emission.
--
-- This migration is idempotent (safe to run multiple times).

-- ============================================================================
-- 1. Deduplicate existing rows (keep earliest per idempotency_key)
-- ============================================================================
-- If any non-NULL idempotency_key values have duplicates, keep the oldest row.
DELETE FROM events_outbox
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY idempotency_key ORDER BY created_at ASC) AS rn
    FROM events_outbox
    WHERE idempotency_key IS NOT NULL
  ) dupes
  WHERE rn > 1
);

-- ============================================================================
-- 2. Create partial UNIQUE index (NULLs excluded — multiple NULL keys allowed)
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_outbox_idempotency_key_unique
  ON events_outbox (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
