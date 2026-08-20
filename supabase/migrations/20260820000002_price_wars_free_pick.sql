-- 20260820000002_price_wars_free_pick.sql
-- Price wars: let the buyer DECIDE the war (Grant, 2026-08-20).
--
-- The original flow only let you fight over items already sold by 2+ vendors,
-- and only with vendors that already priced every item — so it re-shopped what
-- you already dual-source instead of letting you say "these two vendors, these
-- two or three items, go." The gating lived in the API; the only schema change
-- needed to open it up is supporting AD-HOC lines (something you want priced
-- that isn't a catalog item yet).
--
--   * catalog_item_id becomes nullable — an ad-hoc line has no catalog item.
--   * item_label carries the free-text description for those ad-hoc lines.
--
-- The "one open war per item" unique index is unaffected: Postgres treats NULLs
-- as distinct, so ad-hoc rounds never collide with each other.
--
-- Applied to inventory stage via MCP the same day.

ALTER TABLE supply_chain.quote_rounds
  ALTER COLUMN catalog_item_id DROP NOT NULL;

ALTER TABLE supply_chain.quote_rounds
  ADD COLUMN IF NOT EXISTS item_label TEXT;

COMMENT ON COLUMN supply_chain.quote_rounds.catalog_item_id IS
  'The inventory catalog item being priced. NULL for an ad-hoc line (see item_label).';
COMMENT ON COLUMN supply_chain.quote_rounds.item_label IS
  'Free-text description for an ad-hoc line not in the catalog (used when catalog_item_id IS NULL).';
