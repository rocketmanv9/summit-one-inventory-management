-- Price wars — competitive quote rounds (kits/amazon/fleet sprint, item 09).
--
-- Grant's intent: "we buy the same cones from three vendors at three prices —
-- make them fight for it." Detection needs no schema at all (it's a query over
-- supply_chain.vendor_items + purchase_order_lines). What DOES need storage is
-- the round itself: who was invited, what they actually quoted, the AI-drafted
-- messages, and who won.
--
-- HARD RULE baked into the design: nothing here sends anything. `draft_message`
-- is text a human copies; there is no sent_at, no queue, no outbound worker.
-- Auto-send is parked for Grant's green light.
--
-- Truthfulness rule: `current_quote` and `quote_history` only ever hold numbers
-- a human recorded (typed, or extracted from a pasted vendor reply and
-- confirmed). The AI drafting route reads these; it never writes them.

CREATE TABLE IF NOT EXISTS supply_chain.quote_rounds (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  -- inventory.catalog_items across schemas — no FK, the supply_chain convention.
  catalog_item_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awarded', 'abandoned')),
  -- What we're telling vendors we'd buy. Drives "savings if they all hit the low".
  target_qty NUMERIC NOT NULL DEFAULT 1 CHECK (target_qty > 0),
  -- Snapshot of the spread at the moment the war was declared, so the arena can
  -- show "started at $60, now $41" even after vendor_items moves underneath it.
  baseline_unit_cost NUMERIC,
  notes TEXT,
  awarded_vendor_id UUID REFERENCES supply_chain.vendors(id) ON DELETE SET NULL,
  awarded_unit_cost NUMERIC,
  awarded_po_id UUID,
  closed_at TIMESTAMPTZ,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event_id TEXT
);

ALTER TABLE supply_chain.quote_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY quote_rounds_service ON supply_chain.quote_rounds
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY quote_rounds_tenant ON supply_chain.quote_rounds
  FOR ALL TO authenticated
  USING (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid));

CREATE INDEX IF NOT EXISTS idx_quote_rounds_tenant_status
  ON supply_chain.quote_rounds (tenant_id, status, created_at DESC);

-- Only one live war per item — two open rounds on the same cones would have the
-- vendors bidding against ghosts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_rounds_open_item
  ON supply_chain.quote_rounds (tenant_id, catalog_item_id)
  WHERE status = 'open';

-- One row per vendor in the arena.
--   current_quote  — the latest price this vendor has actually given us.
--   quote_history  — [{ unit_cost, recorded_at, source: 'manual'|'extracted',
--                       moq?, lead_time_days?, confidence?, raw? }]
--   draft_message  — the CURRENT AI draft awaiting a human to copy/send.
--   message_history— [{ kind: 'rfq'|'counter', body, created_at, cited_low? }]
CREATE TABLE IF NOT EXISTS supply_chain.quote_round_bids (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  round_id UUID NOT NULL REFERENCES supply_chain.quote_rounds(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES supply_chain.vendors(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'quoted', 'declined')),
  -- The price we knew before the war started (vendor_items or last PO line).
  -- Kept so the arena can show "was $60 → now $41".
  baseline_unit_cost NUMERIC,
  current_quote NUMERIC,
  quote_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  draft_message TEXT,
  message_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  contact_email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event_id TEXT,
  UNIQUE (round_id, vendor_id)
);

ALTER TABLE supply_chain.quote_round_bids ENABLE ROW LEVEL SECURITY;

CREATE POLICY quote_round_bids_service ON supply_chain.quote_round_bids
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY quote_round_bids_tenant ON supply_chain.quote_round_bids
  FOR ALL TO authenticated
  USING (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid));

CREATE INDEX IF NOT EXISTS idx_quote_round_bids_round
  ON supply_chain.quote_round_bids (round_id, current_quote);

CREATE INDEX IF NOT EXISTS idx_quote_round_bids_tenant
  ON supply_chain.quote_round_bids (tenant_id, vendor_id);
