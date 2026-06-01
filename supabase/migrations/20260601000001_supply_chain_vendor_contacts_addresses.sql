-- Unify vendors onto the operational table: supply_chain.vendors becomes the
-- single tenant vendor store (used by items/POs). To keep the rich
-- multi-contact / multi-address model the GV vendor system had, add child
-- tables here. Adopt/create/edit on the Vendors page will target these.

-- ── Contacts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supply_chain.vendor_contacts (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  vendor_id   UUID NOT NULL REFERENCES supply_chain.vendors(id) ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  name        TEXT,
  email       TEXT,
  phone       TEXT,
  title       TEXT,
  last_event_id TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE supply_chain.vendor_contacts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='supply_chain' AND tablename='vendor_contacts' AND policyname='vendor_contacts_service_role_all') THEN
    CREATE POLICY vendor_contacts_service_role_all ON supply_chain.vendor_contacts FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='supply_chain' AND tablename='vendor_contacts' AND policyname='vendor_contacts_tenant_all') THEN
    CREATE POLICY vendor_contacts_tenant_all ON supply_chain.vendor_contacts FOR ALL TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sc_vendor_contacts_tenant ON supply_chain.vendor_contacts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sc_vendor_contacts_vendor ON supply_chain.vendor_contacts (vendor_id);
CREATE UNIQUE INDEX IF NOT EXISTS sc_vendor_contacts_tenant_last_event_id_uq ON supply_chain.vendor_contacts (tenant_id, last_event_id);

-- ── Addresses ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supply_chain.vendor_addresses (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  vendor_id   UUID NOT NULL REFERENCES supply_chain.vendors(id) ON DELETE CASCADE,
  address_type TEXT NOT NULL DEFAULT 'general',
  label       TEXT,
  street1     TEXT,
  street2     TEXT,
  city        TEXT,
  state       TEXT,
  zip         TEXT,
  country     TEXT,
  last_event_id TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE supply_chain.vendor_addresses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='supply_chain' AND tablename='vendor_addresses' AND policyname='vendor_addresses_service_role_all') THEN
    CREATE POLICY vendor_addresses_service_role_all ON supply_chain.vendor_addresses FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='supply_chain' AND tablename='vendor_addresses' AND policyname='vendor_addresses_tenant_all') THEN
    CREATE POLICY vendor_addresses_tenant_all ON supply_chain.vendor_addresses FOR ALL TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sc_vendor_addresses_tenant ON supply_chain.vendor_addresses (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sc_vendor_addresses_vendor ON supply_chain.vendor_addresses (vendor_id);
CREATE UNIQUE INDEX IF NOT EXISTS sc_vendor_addresses_tenant_last_event_id_uq ON supply_chain.vendor_addresses (tenant_id, last_event_id);

-- updated_at maintenance (reuse the standard helper if present)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='inventory' AND p.proname='update_updated_at_column') THEN
    DROP TRIGGER IF EXISTS set_sc_vendor_contacts_updated_at ON supply_chain.vendor_contacts;
    CREATE TRIGGER set_sc_vendor_contacts_updated_at BEFORE UPDATE ON supply_chain.vendor_contacts FOR EACH ROW EXECUTE FUNCTION inventory.update_updated_at_column();
    DROP TRIGGER IF EXISTS set_sc_vendor_addresses_updated_at ON supply_chain.vendor_addresses;
    CREATE TRIGGER set_sc_vendor_addresses_updated_at BEFORE UPDATE ON supply_chain.vendor_addresses FOR EACH ROW EXECUTE FUNCTION inventory.update_updated_at_column();
  END IF;
END $$;
