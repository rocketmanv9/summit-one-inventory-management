-- ============================================================================
-- AI PO status tracking from vendor replies
--
--   • Adds AI-extraction columns to purchase_order_email_replies so each synced
--     reply carries a structured interpretation (event type, confidence, dates).
--   • Adds purchase_order_suggestions: the human-in-the-loop queue + activity
--     timeline. High-confidence safe changes are auto-applied (status
--     'auto_applied'); destructive/uncertain ones wait as 'suggested' until a
--     user clicks Apply or Dismiss.
-- ============================================================================

-- ── Extraction columns on replies ───────────────────────────────────────────
ALTER TABLE supply_chain.purchase_order_email_replies
  ADD COLUMN IF NOT EXISTS event_type   TEXT,
  ADD COLUMN IF NOT EXISTS confidence   NUMERIC(4, 3),
  ADD COLUMN IF NOT EXISTS summary      TEXT,
  ADD COLUMN IF NOT EXISTS extracted    JSONB,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_po_replies_unprocessed
  ON supply_chain.purchase_order_email_replies (tenant_id)
  WHERE processed_at IS NULL;

-- ── purchase_order_suggestions (confirm queue + activity timeline) ───────────
CREATE TABLE IF NOT EXISTS supply_chain.purchase_order_suggestions (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id          UUID NOT NULL,
  purchase_order_id  UUID NOT NULL,
  reply_id           UUID REFERENCES supply_chain.purchase_order_email_replies (id) ON DELETE SET NULL,
  -- acknowledged | shipped | delivery_update | backordered | price_change |
  -- qty_change | delay | cancelled | question | other
  event_type         TEXT NOT NULL DEFAULT 'other',
  confidence         NUMERIC(4, 3),
  summary            TEXT,
  -- The structured changes proposed for the PO, e.g.
  -- { "status": "acknowledged", "expected_delivery_date": "2026-06-12",
  --   "external_order_number": "AMZ-99821", "tracking_number": "1Z..." }
  proposed_changes   JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- suggested  → awaiting human Apply/Dismiss
  -- auto_applied → applied automatically (safe + high confidence)
  -- applied    → a human applied it
  -- dismissed  → a human rejected it
  status             TEXT NOT NULL DEFAULT 'suggested'
                       CHECK (status IN ('suggested', 'auto_applied', 'applied', 'dismissed')),
  applied_by_user_id UUID,
  applied_at         TIMESTAMPTZ,
  last_event_id      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_suggestions_tenant_id
  ON supply_chain.purchase_order_suggestions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_po_suggestions_po
  ON supply_chain.purchase_order_suggestions (tenant_id, purchase_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_suggestions_pending
  ON supply_chain.purchase_order_suggestions (tenant_id, status)
  WHERE status = 'suggested';

ALTER TABLE supply_chain.purchase_order_suggestions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'supply_chain' AND tablename = 'purchase_order_suggestions' AND policyname = 'po_suggestions_service_role_all') THEN
    CREATE POLICY po_suggestions_service_role_all ON supply_chain.purchase_order_suggestions
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'supply_chain' AND tablename = 'purchase_order_suggestions' AND policyname = 'po_suggestions_tenant_select') THEN
    CREATE POLICY po_suggestions_tenant_select ON supply_chain.purchase_order_suggestions
      FOR SELECT TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_po_suggestions_updated_at ON supply_chain.purchase_order_suggestions;
CREATE TRIGGER trg_po_suggestions_updated_at
  BEFORE UPDATE ON supply_chain.purchase_order_suggestions
  FOR EACH ROW EXECUTE FUNCTION supply_chain.set_updated_at();
