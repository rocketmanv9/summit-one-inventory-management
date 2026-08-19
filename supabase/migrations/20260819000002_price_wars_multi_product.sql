-- Price wars — multi-product rounds (inventory-fixes sprint, item 02).
--
-- Grant's intent for "start a price war": pick a couple of vendors, add a few
-- products with quantities like a mini purchase order, and draft one RFQ per
-- vendor that lists all the products. Today a round is single-item and the war
-- auto-includes every candidate vendor. This adds a lightweight PARENT so one
-- "request" can own several single-item rounds that share the same invited
-- vendors — WITHOUT touching the per-item bid/award mechanics.
--
-- MODEL: quote_requests (parent) 1──N quote_rounds (one per product, existing
-- table). A round gets a nullable request_id: existing standalone rounds keep
-- request_id = NULL and behave exactly as before. The uniqueness rule ("one
-- open round per item") is unchanged, so a product already in a war can't be
-- pulled into a second one.
--
-- Nothing here sends anything — same hard rule as the original price_wars
-- migration. The parent just groups rounds and carries the shared vendor set +
-- notes for drafting.

CREATE TABLE IF NOT EXISTS supply_chain.quote_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'abandoned')),
  -- The vendors invited to this whole request. Denormalised as a convenience for
  -- drafting a per-vendor RFQ across the request's products; the source of truth
  -- for who's in each product's ring is still quote_round_bids.
  vendor_ids UUID[] NOT NULL DEFAULT '{}',
  notes TEXT,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event_id TEXT
);

ALTER TABLE supply_chain.quote_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY quote_requests_service ON supply_chain.quote_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY quote_requests_tenant ON supply_chain.quote_requests
  FOR ALL TO authenticated
  USING (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid));

CREATE INDEX IF NOT EXISTS idx_quote_requests_tenant_status
  ON supply_chain.quote_requests (tenant_id, status, created_at DESC);

-- Round → parent link. NULL = a legacy standalone round (unchanged behaviour).
ALTER TABLE supply_chain.quote_rounds
  ADD COLUMN IF NOT EXISTS request_id UUID REFERENCES supply_chain.quote_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quote_rounds_request
  ON supply_chain.quote_rounds (request_id);
