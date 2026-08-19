-- Price wars, item 08 — watch the inbox, match the reply, recommend the winner.
--
-- Item 03 shipped the SEND side with no inbound contract: there was no
-- correlation token on a bid and no reply-to wiring, so a vendor's reply had
-- nothing to match back to. This migration adds the producer-side token and an
-- ingest-idempotency ledger so the monitor route can:
--   1. match an inbound message to a (round, bid) by the token stamped in the
--      RFQ subject/body — `[pw:<round_id>:<bid_id>]`, falling back to the
--      vendor's contact_email against open-round bids;
--   2. record each provider message exactly once (a re-poll never double-posts a
--      price).
--
-- Additive only. No column is dropped, nothing existing changes shape.

-- ── Producer side: a per-bid correlation token ──────────────────────────────
-- Opaque, tenant-unique. Stamped into the sent RFQ so the reply carries it back.
ALTER TABLE supply_chain.quote_round_bids
  ADD COLUMN IF NOT EXISTS correlation_token TEXT;

-- One token can only belong to one bid within a tenant (matching must be exact).
CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_round_bids_correlation_token
  ON supply_chain.quote_round_bids (tenant_id, correlation_token)
  WHERE correlation_token IS NOT NULL;

-- Backfill a token for EVERY existing bid so already-open rounds are matchable.
-- The token is deterministic on the bid id so a resend stamps the same marker.
UPDATE supply_chain.quote_round_bids
   SET correlation_token = replace(id::text, '-', '')
 WHERE correlation_token IS NULL;

-- ── Ingest idempotency ledger ───────────────────────────────────────────────
-- One row per provider message we've looked at for price-wars ingest. Unique on
-- (tenant_id, provider_message_id) so the same vendor reply is never ingested
-- twice, even across overlapping polls. Holds the outcome for an audit trail.
CREATE TABLE IF NOT EXISTS supply_chain.quote_round_reply_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  -- Which bid/round this reply resolved to (null when it matched nothing).
  round_id UUID,
  bid_id UUID,
  vendor_id UUID,
  -- The email provider + its message id (Gmail message id). The dedupe key.
  provider TEXT NOT NULL DEFAULT 'gmail',
  provider_message_id TEXT NOT NULL,
  provider_thread_id TEXT,
  from_email TEXT,
  subject TEXT,
  snippet TEXT,
  -- How we matched: 'token' | 'email' | 'unmatched'.
  matched_by TEXT,
  -- What we did: 'recorded' | 'price_unclear' | 'declined' | 'unmatched' | 'duplicate_bid'.
  outcome TEXT,
  -- The price we read, when we read one (never a guess — mirrors the bid write).
  extracted_unit_cost NUMERIC,
  extraction_confidence NUMERIC,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event_id TEXT
);

ALTER TABLE supply_chain.quote_round_reply_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY quote_round_reply_events_service ON supply_chain.quote_round_reply_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY quote_round_reply_events_tenant ON supply_chain.quote_round_reply_events
  FOR ALL TO authenticated
  USING (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid));

CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_round_reply_events_msg
  ON supply_chain.quote_round_reply_events (tenant_id, provider_message_id);

CREATE INDEX IF NOT EXISTS idx_quote_round_reply_events_round
  ON supply_chain.quote_round_reply_events (tenant_id, round_id, created_at DESC);
