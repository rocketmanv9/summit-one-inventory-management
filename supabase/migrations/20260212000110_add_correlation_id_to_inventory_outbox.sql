-- Add correlation_id to inventory.events_outbox for compatibility with newer emitters

BEGIN;

ALTER TABLE inventory.events_outbox
  ADD COLUMN IF NOT EXISTS correlation_id UUID;

COMMIT;
