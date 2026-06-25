-- Per-asset make / model / year (the real "variant" detail for fleet-synced assets).
-- Sourced from Fleet (fleet_assets.make/model/model_year). Plain columns on the
-- asset; tenant-private, not the shared GV variant catalog.
ALTER TABLE inventory.assets
  ADD COLUMN IF NOT EXISTS make text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS model_year integer;

COMMENT ON COLUMN inventory.assets.make IS 'Manufacturer/make (e.g. from Fleet sync).';
COMMENT ON COLUMN inventory.assets.model IS 'Model designation (the asset variant).';
COMMENT ON COLUMN inventory.assets.model_year IS 'Model year.';
