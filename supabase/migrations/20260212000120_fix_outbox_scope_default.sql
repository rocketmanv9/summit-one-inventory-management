-- Ensure inventory.events_outbox.scope is populated for legacy emitters

BEGIN;

UPDATE inventory.events_outbox
SET scope = 'tenant'
WHERE scope IS NULL;

ALTER TABLE inventory.events_outbox
  ALTER COLUMN scope SET DEFAULT 'tenant';

COMMIT;
