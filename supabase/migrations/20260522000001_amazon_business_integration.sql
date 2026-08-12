-- ============================================================================
-- Migration: amazon_business_integration
-- Description: Tracking table for Amazon Business orders + structured address
--   columns on inventory.locations for shipping integration.
-- ============================================================================

-- ── A) Structured address columns on inventory.locations ─────────────────
-- Required by Amazon's ordering API for shipping. All nullable, non-breaking.

ALTER TABLE inventory.locations
  ADD COLUMN IF NOT EXISTS address_line_1 TEXT;

ALTER TABLE inventory.locations
  ADD COLUMN IF NOT EXISTS address_line_2 TEXT;

ALTER TABLE inventory.locations
  ADD COLUMN IF NOT EXISTS city TEXT;

ALTER TABLE inventory.locations
  ADD COLUMN IF NOT EXISTS state TEXT;

ALTER TABLE inventory.locations
  ADD COLUMN IF NOT EXISTS postal_code TEXT;

ALTER TABLE inventory.locations
  ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'US';

COMMENT ON COLUMN inventory.locations.address_line_1 IS
  'Street address line 1 for structured shipping address.';

COMMENT ON COLUMN inventory.locations.address_line_2 IS
  'Street address line 2 (suite, unit, etc.) for structured shipping address.';

COMMENT ON COLUMN inventory.locations.city IS
  'City for structured shipping address.';

COMMENT ON COLUMN inventory.locations.state IS
  'State/province for structured shipping address.';

COMMENT ON COLUMN inventory.locations.postal_code IS
  'Postal/ZIP code for structured shipping address.';

COMMENT ON COLUMN inventory.locations.country IS
  'ISO country code for structured shipping address. Defaults to US.';


-- ── B) Amazon Business orders tracking table ─────────────────────────────

CREATE TABLE IF NOT EXISTS inventory.amazon_business_orders (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  amazon_order_id     TEXT        NOT NULL,
  amazon_cart_id      TEXT,
  provider_id         UUID        NOT NULL,
  purchase_order_id   UUID,
  status              TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','submitted','confirmed','shipped','delivered','cancelled','failed')),
  items               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  shipping_address    JSONB,
  cost_estimate       JSONB,
  total_cost          NUMERIC,
  tracking_info       JSONB,
  metadata            JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_amazon_business_orders_tenant
  ON inventory.amazon_business_orders (tenant_id);

CREATE INDEX idx_amazon_business_orders_status
  ON inventory.amazon_business_orders (tenant_id, status);

CREATE UNIQUE INDEX idx_amazon_business_orders_amazon_id
  ON inventory.amazon_business_orders (amazon_order_id);

ALTER TABLE inventory.amazon_business_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY amazon_business_orders_service_role
  ON inventory.amazon_business_orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY amazon_business_orders_tenant_isolation
  ON inventory.amazon_business_orders
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

-- Updated-at trigger (uses existing inventory function)
CREATE TRIGGER trg_amazon_business_orders_updated_at
  BEFORE UPDATE ON inventory.amazon_business_orders
  FOR EACH ROW EXECUTE FUNCTION inventory.update_updated_at_column();
