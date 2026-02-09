-- Auto-inject tenant_id for supply_chain vendors and vendor_items

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'auto_inject_tenant_supply_chain_vendors'
  ) THEN
    CREATE TRIGGER auto_inject_tenant_supply_chain_vendors
      BEFORE INSERT ON supply_chain.vendors
      FOR EACH ROW
      EXECUTE FUNCTION inventory.auto_inject_tenant_id();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'auto_inject_tenant_supply_chain_vendor_items'
  ) THEN
    CREATE TRIGGER auto_inject_tenant_supply_chain_vendor_items
      BEFORE INSERT ON supply_chain.vendor_items
      FOR EACH ROW
      EXECUTE FUNCTION inventory.auto_inject_tenant_id();
  END IF;
END $$;
