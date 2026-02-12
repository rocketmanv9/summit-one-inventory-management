-- Force aggregate_id to be non-null on insert into inventory.events_outbox

BEGIN;

CREATE OR REPLACE FUNCTION inventory.fn_outbox_set_aggregate_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.aggregate_id IS NULL THEN
    NEW.aggregate_id := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_outbox_set_aggregate_id ON inventory.events_outbox;
CREATE TRIGGER tr_outbox_set_aggregate_id
  BEFORE INSERT ON inventory.events_outbox
  FOR EACH ROW
  EXECUTE FUNCTION inventory.fn_outbox_set_aggregate_id();

COMMIT;
