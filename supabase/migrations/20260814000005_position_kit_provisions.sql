-- Position kits, automation half (kits/amazon/fleet sprint, item 04).
--
-- Item 03 gave admins the recipe (supply_chain.position_kits). This migration
-- gives the robot its ledger: ONE row per (person, kit) recording what we
-- decided to do about a new hire and what we actually did about it.
--
-- Why a ledger and not "just check if reservations exist":
--   * Idempotency. New-hire detection arrives twice — the hub webhook
--     (org_people.created) is the realtime path on stage, and runHRSync is the
--     nightly catch-up (Vercel crons don't fire on stage preview builds, so the
--     GH Action stage-hr-sync.yml is the scheduler). Both call the same engine;
--     the unique index below is what stops the second one from double-ordering
--     a laptop.
--   * Audit. "Why does Portland have a draft PO for 3 polos?" answers itself:
--     the plan JSONB freezes the have/reserve/order math at decision time.
--   * Visibility. /inventory/onboarding reads this table directly — the
--     automation is never invisible.
--
-- Statuses:
--   planned          — claim written, engine still working (crash leaves this
--                      behind; the queue's "Provision now" re-runs it safely)
--   provisioned      — reservations and/or PO(s) created
--   skipped_no_kit   — person's position has no kit; recorded, not silent
--   skipped_backfill — hired before this feature landed (see backfill below)
--   error            — engine threw; error text kept, retryable from the queue

CREATE TABLE IF NOT EXISTS supply_chain.position_kit_provisions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  -- public.hr_people.hr_person_id (the HR-side uuid), not a local user id — a
  -- new hire usually has no app login yet, and kits must not wait for one.
  hr_person_id UUID NOT NULL,
  -- NULL when no kit applied (skipped_*). ON DELETE SET NULL so deleting a kit
  -- never erases the history of what it once ordered.
  kit_id UUID REFERENCES supply_chain.position_kits(id) ON DELETE SET NULL,
  -- Snapshots so the queue reads correctly even after HR renames/moves people.
  person_name TEXT,
  position_title TEXT,
  hr_position_id UUID,
  location_id UUID REFERENCES inventory.locations(id) ON DELETE SET NULL,
  location_name TEXT,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'provisioned', 'skipped_no_kit', 'skipped_backfill', 'error')),
  -- Kit order_mode at decision time ('draft' | 'auto_submit').
  order_mode TEXT,
  -- Frozen KitPlan: { kit_id, kit_name, location_id, lines:[{catalog_item_id,
  -- name, needed, have, reserve, shortfall, preferred_vendor_id}], totals }.
  plan JSONB,
  reservation_ids UUID[] NOT NULL DEFAULT '{}',
  purchase_order_ids UUID[] NOT NULL DEFAULT '{}',
  error TEXT,
  -- 'webhook' | 'sync' | 'manual' | 'backfill' — how this row got here.
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ,
  last_event_id UUID
);

-- THE idempotency key. Two partial indexes because kit_id is nullable and a
-- plain UNIQUE lets NULLs repeat (same trick position_kits uses for its
-- all-locations scope):
--   * one provisioning per (person, kit)
--   * one no-kit/backfill marker per person
CREATE UNIQUE INDEX IF NOT EXISTS uq_kit_provision_person_kit
  ON supply_chain.position_kit_provisions (tenant_id, hr_person_id, kit_id)
  WHERE kit_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_kit_provision_person_nokit
  ON supply_chain.position_kit_provisions (tenant_id, hr_person_id)
  WHERE kit_id IS NULL;

ALTER TABLE supply_chain.position_kit_provisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY position_kit_provisions_service ON supply_chain.position_kit_provisions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY position_kit_provisions_tenant ON supply_chain.position_kit_provisions
  FOR ALL TO authenticated
  USING (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid));

-- Queue reads: newest first, per tenant.
CREATE INDEX IF NOT EXISTS idx_kit_provisions_tenant_recent
  ON supply_chain.position_kit_provisions (tenant_id, created_at DESC);

-- Sync-diff read: "which active people have no ledger row yet?"
CREATE INDEX IF NOT EXISTS idx_kit_provisions_person
  ON supply_chain.position_kit_provisions (tenant_id, hr_person_id);

-- ── PO origin badge ──────────────────────────────────────────────────────────
-- Onboarding POs get their own origin so the purchasing inbox can say "this
-- came from a new hire", the same way 'auto_reorder' / 'shortfall' /
-- 'guided_purchase' already do (20260806000004 set the precedent).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'supply_chain.purchase_orders'::regclass
      AND conname = 'purchase_orders_origin_check'
  ) THEN
    ALTER TABLE supply_chain.purchase_orders DROP CONSTRAINT purchase_orders_origin_check;
  END IF;

  ALTER TABLE supply_chain.purchase_orders
    ADD CONSTRAINT purchase_orders_origin_check
    CHECK (origin IN ('user', 'agent', 'auto_reorder', 'guided_purchase', 'shortfall', 'onboarding'));
END $$;

-- ── Backfill guard ───────────────────────────────────────────────────────────
-- On first deploy EVERY existing employee looks like an unprocessed hire to the
-- sync-diff pass. Without this the first nightly sync would kit the entire
-- roster (211 people) and draft a wall of POs. Seed a terminal ledger row for
-- everyone who already exists, so the diff only ever sees people who arrive
-- AFTER this migration. New hires are, by definition, the rows that don't have
-- one of these.
INSERT INTO supply_chain.position_kit_provisions
  (tenant_id, hr_person_id, kit_id, person_name, position_title, hr_position_id,
   location_name, status, source, processed_at)
SELECT
  p.tenant_id,
  p.hr_person_id,
  NULL,
  NULLIF(TRIM(COALESCE(p.preferred_name, p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
  pos.title,
  p.hr_position_id,
  p.location_name,
  'skipped_backfill',
  'backfill',
  now()
FROM public.hr_people p
LEFT JOIN public.positions pos
  ON pos.tenant_id = p.tenant_id AND pos.hr_position_id = p.hr_position_id
ON CONFLICT DO NOTHING;
