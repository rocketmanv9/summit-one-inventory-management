-- Fulfillment types for buyable items (snap-and-buy sprint, item 02).
--
-- Every buyable-group item now declares HOW it is actually fulfilled, so nothing
-- dead-ends on the "Guided Purchase" placeholder-vendor mystery again:
--
--   * 'catalog'       (default) — behaves EXACTLY like before: the item drafts
--                     onto a PO via preferred_vendor_id / best vendor_items row.
--   * 'vendor_item'   — pinned to ONE specific supply_chain.vendor_items row;
--                     drafting uses that row's vendor + unit_cost, always.
--   * 'external_link' — ordered OUTSIDE the app (e.g. each estimator's personal
--                     Canva business-card file). These are OPENED, not purchased:
--                     /buyable-groups/request refuses to draft PO lines for them
--                     (deliberate call — no fake POs for Canva orders).
--
-- external_link items resolve their URL per CALLER: a row in
-- buyable_item_person_links (this migration) for the caller's hr_person wins,
-- else the item's external_url fallback, else the clients render "not configured
-- for you — tell an admin" (never a silent dead-end).
--
-- Additive only: existing rows keep fulfillment_kind='catalog' and are unaffected.
-- catalog_item_id stays NOT NULL for every kind — even link items anchor to a
-- catalog item (it names the thing and keeps the /mine payload contract keyed).

ALTER TABLE supply_chain.buyable_item_group_items
  ADD COLUMN IF NOT EXISTS fulfillment_kind TEXT NOT NULL DEFAULT 'catalog',
  ADD COLUMN IF NOT EXISTS external_url TEXT,
  ADD COLUMN IF NOT EXISTS link_label TEXT,
  -- Pin for the 'vendor_item' kind. ON DELETE SET NULL (not RESTRICT) so vendor
  -- cleanup never bricks group config; the API requires it when kind='vendor_item'
  -- and resolution treats a dangling pin as "not configured" (a DB CHECK here
  -- would make the SET NULL itself fail).
  ADD COLUMN IF NOT EXISTS vendor_item_id UUID REFERENCES supply_chain.vendor_items(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'buyable_item_group_items_fulfillment_kind_check'
      AND conrelid = 'supply_chain.buyable_item_group_items'::regclass
  ) THEN
    ALTER TABLE supply_chain.buyable_item_group_items
      ADD CONSTRAINT buyable_item_group_items_fulfillment_kind_check
      CHECK (fulfillment_kind IN ('catalog', 'vendor_item', 'external_link'));
  END IF;
END $$;

-- Per-PERSON link overrides for external_link items — the Canva-per-estimator
-- case: one group item ("Business cards"), a different URL for each estimator.
-- hr_person_id references public.hr_people.hr_person_id (the HR mirror; no FK —
-- the same cross-schema/mirror convention buyable_item_group_items uses for
-- catalog_item_id, and the mirror gets reseeded by HR sync).
CREATE TABLE IF NOT EXISTS supply_chain.buyable_item_person_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  group_item_id UUID NOT NULL REFERENCES supply_chain.buyable_item_group_items(id) ON DELETE CASCADE,
  hr_person_id UUID NOT NULL,
  url TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_event_id UUID,
  UNIQUE (group_item_id, hr_person_id)
);

ALTER TABLE supply_chain.buyable_item_person_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY buyable_item_person_links_service ON supply_chain.buyable_item_person_links
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY buyable_item_person_links_tenant ON supply_chain.buyable_item_person_links
  FOR ALL TO authenticated
  USING (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid));

CREATE INDEX IF NOT EXISTS idx_buyable_item_person_links_tenant
  ON supply_chain.buyable_item_person_links (tenant_id);

-- The /mine resolution scan: all active links for a set of group items.
CREATE INDEX IF NOT EXISTS idx_buyable_item_person_links_item
  ON supply_chain.buyable_item_person_links (group_item_id, active);
