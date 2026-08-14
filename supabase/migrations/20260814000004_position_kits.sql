-- Position kits (kits/amazon/fleet sprint, item 03).
--
-- Grant's intent: "an estimator gets a laptop, 3 polos, pens" — the stuff every
-- new hire in a position should be issued. This migration is the CONFIG half:
-- admins define kits per HR position (optionally per location). Item 04 wires
-- the automation (new-hire detection -> reserve what's on hand, order the rest).
--
-- Sibling of supply_chain.buyable_item_groups (who can buy what), deliberately
-- NOT folded into it: buyable groups are self-service shopping gated by position
-- title; kits are an issuance recipe keyed on the stable hr_position_id, with a
-- location override and an order mode. Same design language, own tables.
--
-- Resolution rule (implemented in src/lib/position-kits.ts, shared with item 04):
--   exact (hr_position_id, location_id) kit wins;
--   else the (hr_position_id, NULL) kit = "all locations";
--   else no kit.

CREATE TABLE IF NOT EXISTS supply_chain.position_kits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  -- Stable HR position UUID (public.positions.hr_position_id). Titles change;
  -- this doesn't. Titles are joined for display only.
  hr_position_id UUID NOT NULL,
  -- NULL = applies to every location. A row with a location_id OVERRIDES the
  -- NULL-location kit for that location.
  location_id UUID REFERENCES inventory.locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  -- 'draft'       = build a draft PO for the shortfall, a human submits it
  -- 'auto_submit' = submit it through the normal approval gate automatically
  order_mode TEXT NOT NULL DEFAULT 'draft' CHECK (order_mode IN ('draft', 'auto_submit')),
  created_by_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_event_id UUID
);

-- One kit per position per location scope. Partial unique indexes because
-- NULL location_id must also be unique (a plain UNIQUE lets NULLs repeat).
CREATE UNIQUE INDEX IF NOT EXISTS uq_position_kits_scoped
  ON supply_chain.position_kits (tenant_id, hr_position_id, location_id)
  WHERE location_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_position_kits_all_locations
  ON supply_chain.position_kits (tenant_id, hr_position_id)
  WHERE location_id IS NULL;

ALTER TABLE supply_chain.position_kits ENABLE ROW LEVEL SECURITY;

CREATE POLICY position_kits_service ON supply_chain.position_kits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY position_kits_tenant ON supply_chain.position_kits
  FOR ALL TO authenticated
  USING (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid));

CREATE INDEX IF NOT EXISTS idx_position_kits_tenant
  ON supply_chain.position_kits (tenant_id, active);

CREATE INDEX IF NOT EXISTS idx_position_kits_lookup
  ON supply_chain.position_kits (tenant_id, hr_position_id, location_id);

-- The lines of a kit. catalog_item_id references inventory.catalog_items across
-- schemas (no FK — the same convention the rest of supply_chain uses).
-- `note` carries the spec a buyer needs but the catalog doesn't model:
-- "16-inch, 32GB", "size L", "black".
CREATE TABLE IF NOT EXISTS supply_chain.position_kit_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  kit_id UUID NOT NULL REFERENCES supply_chain.position_kits(id) ON DELETE CASCADE,
  catalog_item_id UUID NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  preferred_vendor_id UUID REFERENCES supply_chain.vendors(id) ON DELETE SET NULL,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_event_id UUID,
  UNIQUE (kit_id, catalog_item_id)
);

ALTER TABLE supply_chain.position_kit_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY position_kit_items_service ON supply_chain.position_kit_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY position_kit_items_tenant ON supply_chain.position_kit_items
  FOR ALL TO authenticated
  USING (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid));

CREATE INDEX IF NOT EXISTS idx_position_kit_items_kit
  ON supply_chain.position_kit_items (kit_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_position_kit_items_tenant
  ON supply_chain.position_kit_items (tenant_id);
