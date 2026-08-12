-- ============================================================================
-- Migration: punchout_order_tracking
-- Description: Tenant-scoped table for tracking the full lifecycle of an
--   Amazon Business cXML punchout order: session start → POOM return →
--   OrderRequest submission → confirmation.
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.punchout_orders (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Punchout session (set at start)
  setup_payload_id      TEXT        NOT NULL UNIQUE,
  buyer_cookie          TEXT        NOT NULL UNIQUE,
  punchout_url          TEXT,
  user_email            TEXT        NOT NULL,
  initiated_by          UUID,

  -- POOM return (filled when cart comes back from Amazon)
  poom_received_at      TIMESTAMPTZ,
  poom_raw              TEXT,
  poom_items            JSONB,
  poom_total            NUMERIC,

  -- OrderRequest submission
  order_payload_id      TEXT        UNIQUE,
  order_submitted_at    TIMESTAMPTZ,
  order_response_status TEXT,
  order_response_raw    TEXT,
  amazon_order_id       TEXT,

  -- Internal PO link
  purchase_order_id     UUID,

  -- Resolved items: [{catalog_item_id, supplier_sku, spaid, quantity, unit_price, pack_quantity, description}]
  items                 JSONB       NOT NULL DEFAULT '[]'::jsonb,
  shipping_address      JSONB,
  total_cost            NUMERIC,

  -- Lifecycle
  status                TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending',
                          'punchout_started',
                          'cart_returned',
                          'submitted',
                          'confirmed',
                          'rejected',
                          'failed'
                        )),
  error_message         TEXT,
  metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_punchout_orders_tenant
  ON inventory.punchout_orders (tenant_id);

CREATE INDEX idx_punchout_orders_status
  ON inventory.punchout_orders (tenant_id, status);

CREATE INDEX idx_punchout_orders_cookie
  ON inventory.punchout_orders (buyer_cookie);

ALTER TABLE inventory.punchout_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY punchout_orders_service_role
  ON inventory.punchout_orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY punchout_orders_tenant_isolation
  ON inventory.punchout_orders
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE TRIGGER trg_punchout_orders_updated_at
  BEFORE UPDATE ON inventory.punchout_orders
  FOR EACH ROW EXECUTE FUNCTION inventory.update_updated_at_column();
