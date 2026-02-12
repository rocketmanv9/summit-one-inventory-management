-- Add trace_id to inventory.events_outbox for compatibility with newer emitters

BEGIN;

ALTER TABLE inventory.events_outbox
  ADD COLUMN IF NOT EXISTS trace_id UUID DEFAULT gen_random_uuid();

COMMIT;
