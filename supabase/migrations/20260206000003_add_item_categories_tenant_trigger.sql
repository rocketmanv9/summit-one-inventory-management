-- Auto-inject tenant_id for item_categories inserts
-- Keeps RLS happy when client omits tenant_id

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'auto_inject_tenant_item_categories'
  ) THEN
    CREATE TRIGGER auto_inject_tenant_item_categories
      BEFORE INSERT ON inventory.item_categories
      FOR EACH ROW
      EXECUTE FUNCTION inventory.auto_inject_tenant_id();
  END IF;
END $$;
