-- ============================================================================
-- Migration: vendor_item_mapping_enhancements
-- Description: Adds price-tracking and active-flag columns to vendor_items
--   for Amazon Business cXML integration (and future supplier mappings).
-- ============================================================================

ALTER TABLE supply_chain.vendor_items
  ADD COLUMN IF NOT EXISTS last_known_price NUMERIC(18,4);

ALTER TABLE supply_chain.vendor_items
  ADD COLUMN IF NOT EXISTS price_checked_at TIMESTAMPTZ;

ALTER TABLE supply_chain.vendor_items
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN supply_chain.vendor_items.last_known_price IS
  'Last observed price from the supplier (e.g., Amazon listing price at time of check).';

COMMENT ON COLUMN supply_chain.vendor_items.price_checked_at IS
  'When last_known_price was last verified against the supplier.';

COMMENT ON COLUMN supply_chain.vendor_items.active IS
  'Whether this vendor-item mapping is active. Inactive mappings are excluded from ordering.';

CREATE INDEX IF NOT EXISTS idx_vendor_items_active
  ON supply_chain.vendor_items (tenant_id, vendor_id, active)
  WHERE active = true;
