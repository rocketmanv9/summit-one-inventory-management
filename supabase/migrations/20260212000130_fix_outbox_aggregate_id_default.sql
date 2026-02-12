-- Ensure inventory.events_outbox.aggregate_id is populated for legacy emitters

BEGIN;

UPDATE inventory.events_outbox
SET aggregate_id = gen_random_uuid()
WHERE aggregate_id IS NULL;

ALTER TABLE inventory.events_outbox
  ALTER COLUMN aggregate_id SET DEFAULT gen_random_uuid();

COMMIT;
