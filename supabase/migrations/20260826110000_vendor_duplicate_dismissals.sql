-- Vendor duplicate dismissals (inventory-wrapup item 06).
--
-- The duplicates browser (/inventory/vendors/duplicates) can Merge a pair, but
-- had no way to say "not a dupe" — false positives resurfaced on every scan.
-- This table remembers dismissed pairs so the duplicates route can filter them
-- out permanently.
--
-- Pair ordering is NORMALIZED (vendor_a_id < vendor_b_id, plain uuid ordering —
-- same as rpc_vendor_duplicate_pairs, which always emits a.id < b.id), so one
-- row covers the pair regardless of which side the user clicked from, and the
-- unique index makes a repeat dismissal an idempotent upsert.
--
-- No FK to supply_chain.vendors on purpose: a dismissal must survive either
-- vendor being merged/deactivated later (rows are tiny, and a dangling pair is
-- simply never matched again). Additive only; nothing existing is altered.

CREATE TABLE IF NOT EXISTS supply_chain.vendor_duplicate_dismissals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  vendor_a_id UUID NOT NULL,
  vendor_b_id UUID NOT NULL,
  -- public.local_users.user_id of the admin who dismissed. Loose reference,
  -- consistent with the rest of supply_chain.
  dismissed_by UUID,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event_id TEXT,
  -- Normalized ordering — one canonical row per unordered pair.
  CONSTRAINT vendor_duplicate_dismissals_ordered CHECK (vendor_a_id < vendor_b_id)
);

-- One dismissal per pair per tenant; repeat dismissals upsert into this.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_duplicate_dismissals_pair
  ON supply_chain.vendor_duplicate_dismissals (tenant_id, vendor_a_id, vendor_b_id);

CREATE INDEX IF NOT EXISTS idx_vendor_duplicate_dismissals_tenant
  ON supply_chain.vendor_duplicate_dismissals (tenant_id);

ALTER TABLE supply_chain.vendor_duplicate_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_duplicate_dismissals_service ON supply_chain.vendor_duplicate_dismissals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY vendor_duplicate_dismissals_tenant ON supply_chain.vendor_duplicate_dismissals
  FOR ALL TO authenticated
  USING (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid));

COMMENT ON TABLE supply_chain.vendor_duplicate_dismissals IS
  'Vendor pairs an admin marked "not a duplicate" — the duplicates scan filters these out so false positives never resurface. Pair is normalized: vendor_a_id < vendor_b_id.';
