-- External order sessions: guided-purchase captures → AI extraction → draft PO
-- (item 06 — inventory-buying sprint).
--
-- Grant's flow: an estimator taps an external purchase link on mobile (item 04's
-- /mine catalog), a guided browser opens the external site (Canva, a supplier's
-- web store, etc.), and while they shop the app streams up screenshots. On
-- completion, AI vision turns those captures into a DRAFT purchase order with the
-- screenshots attached — the human still places the real order on the site; we
-- only watch and record.
--
-- Lifecycle modeled on inventory.punchout_orders (session row + status
-- progression + JSONB payloads): active → completed | abandoned | cancelled.
-- Stale 'active' sessions (>24h) are swept to 'abandoned' lazily on read and by
-- an optional cron (see the sweep route).
--
-- The captures live in the private 'external-order-captures' storage bucket,
-- tenant-scoped (bucket + policies created below). extracted holds the AI vision
-- result (vendor/site, line items, totals, order number, per-field confidence).
-- draft_po_id points at the PO drafted on completion when the link requires_po.
--
-- A new purchase_orders.origin value 'guided_purchase' lets the purchasing hub
-- badge these POs (mirrors how 'auto_reorder' is badged). rpc_create_purchase_order
-- itself doesn't set origin, so the completion route stamps it after creation.

-- ── 1. origin: allow 'guided_purchase' ───────────────────────────────────────
-- 20260806000004 added the CHECK (origin IN ('user','agent','auto_reorder')).
-- Widen it so guided-purchase POs are a first-class origin.
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
    CHECK (origin IN ('user', 'agent', 'auto_reorder', 'guided_purchase'));
END $$;

-- ── 2. Sessions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supply_chain.external_order_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  link_id UUID NOT NULL REFERENCES supply_chain.external_purchase_links(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'abandoned', 'cancelled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  capture_count INTEGER NOT NULL DEFAULT 0,
  -- AI vision extraction result (vendor/site, items[], totals, order number,
  -- per-field confidence). NULL until completion; {} shell when nothing extracted.
  extracted JSONB,
  -- The draft PO drafted on completion (when the link requires_po).
  draft_po_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event_id UUID,
  -- Idempotent create: the route upserts on (tenant_id, last_event_id) so a
  -- retried start returns the same session instead of a duplicate.
  UNIQUE (tenant_id, last_event_id)
);

ALTER TABLE supply_chain.external_order_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY external_order_sessions_service ON supply_chain.external_order_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY external_order_sessions_tenant ON supply_chain.external_order_sessions
  FOR ALL TO authenticated
  USING (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid));

CREATE INDEX IF NOT EXISTS idx_external_order_sessions_tenant
  ON supply_chain.external_order_sessions (tenant_id, user_id, status);

-- Sweep support: find stale active sessions fast.
CREATE INDEX IF NOT EXISTS idx_external_order_sessions_active
  ON supply_chain.external_order_sessions (tenant_id, started_at)
  WHERE status = 'active';

-- ── 3. Captures ──────────────────────────────────────────────────────────────
-- One row per screenshot streamed up during a session. storage_path points into
-- the private 'external-order-captures' bucket (tenant-scoped path).
CREATE TABLE IF NOT EXISTS supply_chain.external_order_captures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  session_id UUID NOT NULL REFERENCES supply_chain.external_order_sessions(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event_id UUID,
  -- Idempotent capture upload: retried POST with the same key is a no-op.
  UNIQUE (tenant_id, last_event_id)
);

ALTER TABLE supply_chain.external_order_captures ENABLE ROW LEVEL SECURITY;

CREATE POLICY external_order_captures_service ON supply_chain.external_order_captures
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY external_order_captures_tenant ON supply_chain.external_order_captures
  FOR ALL TO authenticated
  USING (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid));

CREATE INDEX IF NOT EXISTS idx_external_order_captures_session
  ON supply_chain.external_order_captures (session_id, sort);

-- ── 4. Storage bucket + tenant-scoped policies ───────────────────────────────
-- Private bucket (like 'purchase-documents'). Paths are `<tenant_id>/<session_id>/<n>.jpg`;
-- policies scope authenticated access to the caller's tenant folder. Route work
-- uses the service-role client, which bypasses these — they're the safety net for
-- any future direct (anon/authenticated) access.
INSERT INTO storage.buckets (id, name, public)
VALUES ('external-order-captures', 'external-order-captures', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS external_order_captures_read ON storage.objects;
CREATE POLICY external_order_captures_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'external-order-captures'
    AND (storage.foldername(name))[1] = COALESCE(
      (auth.jwt()->'app_metadata'->>'tenant_id'),
      (auth.jwt()->>'tenant_id')
    )
  );

DROP POLICY IF EXISTS external_order_captures_write ON storage.objects;
CREATE POLICY external_order_captures_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'external-order-captures'
    AND (storage.foldername(name))[1] = COALESCE(
      (auth.jwt()->'app_metadata'->>'tenant_id'),
      (auth.jwt()->>'tenant_id')
    )
  );
