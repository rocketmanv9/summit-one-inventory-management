-- ============================================================================
-- Migration: cxml_procurement_pivot
-- Description: Course-correct Amazon Business integration from SP-API/LWA OAuth
--   to cXML Purchasing System integration. Adds auto-order controls to
--   vendor_items and integration mode guard to providers.
-- ============================================================================

-- ── A) Auto-order controls on supply_chain.vendor_items ─────────────────────
-- Per-mapping flags: suggest-first by default, auto-order behind explicit enable.

ALTER TABLE supply_chain.vendor_items
  ADD COLUMN IF NOT EXISTS auto_order_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE supply_chain.vendor_items
  ADD COLUMN IF NOT EXISTS auto_order_max_price NUMERIC;

COMMENT ON COLUMN supply_chain.vendor_items.auto_order_enabled IS
  'When true, system may auto-place orders for this item/vendor. Disabled by default (suggest-first).';

COMMENT ON COLUMN supply_chain.vendor_items.auto_order_max_price IS
  'Maximum unit price for auto-ordering. Null means no cap (requires auto_order_enabled).';


-- ── B) Integration mode on provisioning.providers ───────────────────────────
-- Enforces test-mode-only: code must never programmatically flip to active.

ALTER TABLE provisioning.providers
  ADD COLUMN IF NOT EXISTS integration_mode TEXT NOT NULL DEFAULT 'test'
  CHECK (integration_mode IN ('test', 'active'));

COMMENT ON COLUMN provisioning.providers.integration_mode IS
  'Integration operating mode. Must only be switched to active via manual DB operation, never programmatically.';


-- ── C) Drop amazon_cart_id from amazon_business_orders ──────────────────────
-- cXML ordering has no cart concept; this column was SP-API specific.

ALTER TABLE inventory.amazon_business_orders
  DROP COLUMN IF EXISTS amazon_cart_id;
