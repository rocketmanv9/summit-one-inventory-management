-- External purchase links catalog (item 04 — inventory-buying sprint).
--
-- Grant's intent: "estimators should have a link to business cards in canva…
-- these tasks need to be configurable… estimators are only allowed to purchase
-- certain things… should be a quick action for just certain positions."
--
-- Admins define a catalog of "things you're allowed to buy from outside sites"
-- and gate each one to a set of HR position titles (allowed_positions). The
-- consumer API (/api/inventory/external-purchase-links/mine) only ever serves a
-- caller the links their position allows — position match happens server-side
-- by resolving the caller's email → hr_people → positions.title (see the route).
--
-- Position source of truth is HR; positions.title carries the shared vocabulary
-- the mobile identity pattern (position_title) also uses, so allowed_positions
-- stores title strings (e.g. 'Estimator'). Empty allowed_positions = admins only.
--
-- A link MAY reference a vendor (vendor_id) but doesn't have to — Canva isn't a
-- vendor row and shouldn't be forced into one. requires_po drives whether item
-- 06's guided browser flow drafts an internal PO on completion. monthly_limit is
-- a display-only soft cap this sprint (no spend accounting yet).

CREATE TABLE IF NOT EXISTS supply_chain.external_purchase_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  category TEXT,
  vendor_id UUID REFERENCES supply_chain.vendors(id) ON DELETE SET NULL,
  -- HR position titles allowed to use this link. Empty = admins only.
  allowed_positions TEXT[] NOT NULL DEFAULT '{}',
  -- Whether completing a purchase should draft an internal PO (consumed by item 06).
  requires_po BOOLEAN NOT NULL DEFAULT true,
  -- Display-only soft cap this sprint (no spend enforcement yet).
  monthly_limit NUMERIC,
  icon TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_event_id UUID
);

ALTER TABLE supply_chain.external_purchase_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY external_purchase_links_service ON supply_chain.external_purchase_links
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY external_purchase_links_tenant ON supply_chain.external_purchase_links
  FOR ALL TO authenticated
  USING (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid));

CREATE INDEX IF NOT EXISTS idx_external_purchase_links_tenant
  ON supply_chain.external_purchase_links (tenant_id, active, sort_order);

-- Fast membership scan for the /mine consumer query (position gating).
CREATE INDEX IF NOT EXISTS idx_external_purchase_links_positions
  ON supply_chain.external_purchase_links USING GIN (allowed_positions);
