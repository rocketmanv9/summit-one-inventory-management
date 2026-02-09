-- Auto-inject tenant_id for location_types inserts

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'auto_inject_tenant_location_types'
  ) THEN
    CREATE TRIGGER auto_inject_tenant_location_types
      BEFORE INSERT ON inventory.location_types
      FOR EACH ROW
      EXECUTE FUNCTION inventory.auto_inject_tenant_id();
  END IF;
END $$;
