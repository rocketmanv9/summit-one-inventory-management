-- Price wars — per-line reply extraction (multi-item vendor replies).
--
-- Since the 2026-08-20 "you decide" rework, send-invites mails ONE combined RFQ
-- per vendor covering every line of a request, so vendors naturally reply with
-- one email quoting SEVERAL items. Ingest now extracts an array of per-line
-- quotes and records each on its own round's bid. The reply-events ledger keeps
-- its one-row-per-provider-message dedupe key (that is what makes a re-ingest of
-- the same message a no-op), and gains per-bid granularity for the audit trail:
--
--   * request_id     — the multi-item quote_request the reply resolved to
--                      (null for standalone single-round replies, unchanged).
--   * line_outcomes  — JSONB array, one entry per line the vendor held under
--                      that request: [{ round_id, bid_id, item, outcome
--                      ('recorded'|'not_quoted'|'declined'), unit_cost,
--                      confidence }]. Null on single-line replies (the existing
--                      bid_id/extracted_unit_cost columns already tell the
--                      whole story there).
--
-- Additive only. No column dropped or reshaped; existing rows untouched.

ALTER TABLE supply_chain.quote_round_reply_events
  ADD COLUMN IF NOT EXISTS request_id UUID,
  ADD COLUMN IF NOT EXISTS line_outcomes JSONB;

COMMENT ON COLUMN supply_chain.quote_round_reply_events.request_id IS
  'The multi-item quote_request this reply resolved to; null when the reply matched a standalone round.';
COMMENT ON COLUMN supply_chain.quote_round_reply_events.line_outcomes IS
  'Per-line audit for multi-item replies: [{ round_id, bid_id, item, outcome, unit_cost, confidence }]. Null for single-line replies.';

CREATE INDEX IF NOT EXISTS idx_quote_round_reply_events_request
  ON supply_chain.quote_round_reply_events (tenant_id, request_id)
  WHERE request_id IS NOT NULL;
