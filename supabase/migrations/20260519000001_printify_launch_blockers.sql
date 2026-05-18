-- Provider webhook tracking
ALTER TABLE provisioning.providers
  ADD COLUMN IF NOT EXISTS webhook_status TEXT DEFAULT 'unknown'
    CHECK (webhook_status IN ('unknown','registered','failed','manual'));

-- Dedup columns for external orders
ALTER TABLE provisioning.provisioning_lines
  ADD COLUMN IF NOT EXISTS payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submit_attempt_count INTEGER NOT NULL DEFAULT 0;

-- Structured shipping address on locations + default ship-to flag
ALTER TABLE inventory.locations
  ADD COLUMN IF NOT EXISTS shipping_address JSONB,
  ADD COLUMN IF NOT EXISTS is_default_ship_to BOOLEAN NOT NULL DEFAULT false;

-- At most one default ship-to per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_default_ship_to
  ON inventory.locations (tenant_id) WHERE is_default_ship_to = true;
