-- ============================================================================
-- Migration: create_printify_orders
-- Description: Tracking table for orders placed to Printify via the integration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.printify_orders (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  printify_order_id   TEXT        NOT NULL,
  provider_id         UUID        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','submitted','in_production','shipped','delivered','cancelled','failed')),
  items               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  shipping_address    JSONB,
  total_cost          NUMERIC,
  metadata            JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_printify_orders_tenant ON inventory.printify_orders (tenant_id);
CREATE INDEX idx_printify_orders_status ON inventory.printify_orders (tenant_id, status);
CREATE INDEX idx_printify_orders_printify_id ON inventory.printify_orders (printify_order_id);

ALTER TABLE inventory.printify_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY printify_orders_service_role ON inventory.printify_orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY printify_orders_tenant_isolation ON inventory.printify_orders
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

-- Updated-at trigger (uses existing inventory function)
CREATE TRIGGER trg_printify_orders_updated_at
  BEFORE UPDATE ON inventory.printify_orders
  FOR EACH ROW EXECUTE FUNCTION inventory.update_updated_at_column();
