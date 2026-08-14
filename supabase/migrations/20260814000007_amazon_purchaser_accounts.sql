-- Amazon purchaser registry (item 06 — kits/amazon/fleet sprint 2026-08-14).
--
-- Grant's question this answers: "who actually has an Amazon Business account,
-- and who is allowed to punch out?" Today the only record of that is
-- inventory.punchout_orders.initiated_by / user_email — i.e. a log of who
-- ALREADY did it, never a list of who MAY. This table is that list.
--
-- Deliberate shape decisions:
--   * user-level, keyed on local_users.user_id (unique per tenant). Position
--     gating already exists for external purchase links; Amazon accounts are a
--     per-person fact (a real amazon.com login), so the registry is per person.
--   * amazon_email is the address on the Amazon Business seat. It is often NOT
--     the Summit work email (people get added to the business account with
--     whatever address they used), which is exactly why it needs recording.
--   * can_punch_out is separate from active: a purchaser can be on the account
--     (so buyers know who to ask) with punchout switched off.
--
-- SOFT GATE, dormant by default: src/lib/amazon-access.ts treats an EMPTY
-- registry for a tenant as "feature not configured" and lets everything through
-- exactly as it did before this migration. The gate only bites once an admin has
-- registered at least one purchaser. See canUserPunchOut().
--
-- cXML punchout is THE Amazon integration here — the SP-API dev account lapsed
-- 2026-08 on purpose. Nothing in this table feeds SP-API.

CREATE TABLE IF NOT EXISTS supply_chain.amazon_purchaser_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  -- public.local_users.user_id. No FK: local_users is a cross-schema mirror and
  -- the rest of supply_chain references it the same loose way.
  user_id UUID NOT NULL,
  -- The address on their Amazon Business seat (may differ from their work email).
  amazon_email TEXT,
  account_type TEXT NOT NULL DEFAULT 'business'
    CHECK (account_type IN ('business', 'personal')),
  -- May start a cXML punchout session. Separate from `active` on purpose.
  can_punch_out BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event_id TEXT
);

-- One registry row per person per tenant — the UI edits, never duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_amazon_purchaser_accounts_user
  ON supply_chain.amazon_purchaser_accounts (tenant_id, user_id);

-- The gate's hot query: "is the registry configured, and is this user in it?"
CREATE INDEX IF NOT EXISTS idx_amazon_purchaser_accounts_tenant_active
  ON supply_chain.amazon_purchaser_accounts (tenant_id, active);

ALTER TABLE supply_chain.amazon_purchaser_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY amazon_purchaser_accounts_service ON supply_chain.amazon_purchaser_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY amazon_purchaser_accounts_tenant ON supply_chain.amazon_purchaser_accounts
  FOR ALL TO authenticated
  USING (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid));

COMMENT ON TABLE supply_chain.amazon_purchaser_accounts IS
  'Who has an Amazon Business seat and who may punch out. Empty for a tenant = gate dormant (pre-existing behaviour preserved).';
