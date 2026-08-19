-- Price wars, item 03 — actually SEND the RFQ invites.
--
-- Until now quote_round_bids.draft_message was copy/paste-only and the arena
-- said out loud "nothing here emails a vendor". We now send the drafted RFQ to
-- each vendor by email (reusing the PO email transport: tenant Gmail preferred,
-- Resend fallback). These additive columns record that a send happened so the
-- arena can show a "Sent · {time}" badge instead of just "Draft", and so a
-- retry is idempotent (we don't re-blast a vendor we already reached).
--
-- Additive only. No column is dropped, nothing existing changes shape.

ALTER TABLE supply_chain.quote_round_bids
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_by_user_id UUID,
  -- 'gmail' | 'resend' — which transport actually carried it.
  ADD COLUMN IF NOT EXISTS sent_method TEXT,
  -- Provider message id (Gmail message id / Resend id) for later reference.
  ADD COLUMN IF NOT EXISTS sent_message_id TEXT,
  -- The exact address we reached, snapshotted at send time.
  ADD COLUMN IF NOT EXISTS sent_to_email TEXT;

-- Handy for "which invites went out in this round".
CREATE INDEX IF NOT EXISTS idx_quote_round_bids_sent
  ON supply_chain.quote_round_bids (round_id, sent_at DESC);
