-- Buyable item groups (item 11 — inventory-buying sprint).
--
-- Grant's intent: "a configurable way to save who can buy what and stuff from
-- inventory, like groups of items per position that people are allowed to buy,
-- and then that should show up under quick actions for inventory for them to
-- get stuff."
--
-- This is the INTERNAL-catalog sibling of item 04 (external purchase links).
-- Two different things, one philosophy: position-gated buying. Admins define
-- named groups of catalog items ("Estimator kit", "Field consumables") and gate
-- each group to a set of HR position titles (allowed_positions). The consumer
-- API (/api/inventory/buyable-groups/mine) only ever serves a caller the groups
-- their position allows — position match happens server-side by resolving the
-- caller's email → hr_people → positions.title (see resolveCallerPurchaseIdentity,
-- the same helper item 04's /mine route uses). Empty allowed_positions = admins only.
--
-- A group holds catalog items (inventory.catalog_items). When a user submits
-- their picks, /buyable-groups/request turns them into DRAFT PO(s) through the
-- normal rpc_create_purchase_order path — grouped by each item's preferred/known
-- vendor from supply_chain.vendor_items — so buying flows through the existing
-- approval gate unchanged.

CREATE TABLE IF NOT EXISTS supply_chain.buyable_item_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  -- HR position titles allowed to buy from this group. Empty = admins only.
  allowed_positions TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_event_id UUID
);

ALTER TABLE supply_chain.buyable_item_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY buyable_item_groups_service ON supply_chain.buyable_item_groups
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY buyable_item_groups_tenant ON supply_chain.buyable_item_groups
  FOR ALL TO authenticated
  USING (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid));

CREATE INDEX IF NOT EXISTS idx_buyable_item_groups_tenant
  ON supply_chain.buyable_item_groups (tenant_id, active, sort_order);

-- Fast membership scan for the /mine consumer query (position gating).
CREATE INDEX IF NOT EXISTS idx_buyable_item_groups_positions
  ON supply_chain.buyable_item_groups USING GIN (allowed_positions);

-- The catalog items inside a group. catalog_item_id references
-- inventory.catalog_items (a different schema, so no FK — same convention the
-- rest of supply_chain uses for cross-schema catalog references). default_qty is
-- a suggestion the consumer UI pre-fills; preferred_vendor_id is optional and, if
-- set, overrides the vendor_items best-row resolution when drafting the PO.
CREATE TABLE IF NOT EXISTS supply_chain.buyable_item_group_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  group_id UUID NOT NULL REFERENCES supply_chain.buyable_item_groups(id) ON DELETE CASCADE,
  catalog_item_id UUID NOT NULL,
  default_qty INTEGER NOT NULL DEFAULT 1,
  preferred_vendor_id UUID REFERENCES supply_chain.vendors(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_event_id UUID,
  UNIQUE (group_id, catalog_item_id)
);

ALTER TABLE supply_chain.buyable_item_group_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY buyable_item_group_items_service ON supply_chain.buyable_item_group_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY buyable_item_group_items_tenant ON supply_chain.buyable_item_group_items
  FOR ALL TO authenticated
  USING (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid));

CREATE INDEX IF NOT EXISTS idx_buyable_item_group_items_group
  ON supply_chain.buyable_item_group_items (group_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_buyable_item_group_items_tenant
  ON supply_chain.buyable_item_group_items (tenant_id);
