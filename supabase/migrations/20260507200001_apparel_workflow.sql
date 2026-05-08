-- ============================================================================
-- Migration: apparel_workflow
-- Description: Apparel config and orders tables for HR → shirt reservation →
--              Printful reorder workflow.
-- ============================================================================

-- ── apparel_config ──────────────────────────────────────────────────────────
-- One row per tenant linking shirt sizes to inventory catalog_items and
-- Printful variant IDs, plus shipping config.
-- NOTE: Design files (logos, branding) come from Core tenant branding at order
-- time — they are NOT stored here. Core/HR owns the brand assets.

CREATE TABLE IF NOT EXISTS inventory.apparel_config (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID        NOT NULL,
  printful_product_id INTEGER,
  size_variant_map    JSONB   NOT NULL DEFAULT '{}'::jsonb,
  shipping_address    JSONB,
  reorder_threshold   INTEGER DEFAULT 5,
  default_reorder_qty INTEGER DEFAULT 10,
  enabled             BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE inventory.apparel_config ENABLE ROW LEVEL SECURITY;

-- Service role: full access
CREATE POLICY "apparel_config_service_all"
  ON inventory.apparel_config
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated: tenant-scoped
CREATE POLICY "apparel_config_tenant_access"
  ON inventory.apparel_config
  FOR ALL
  TO authenticated
  USING (tenant_id = ((current_setting('request.jwt.claims', true))::json ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = ((current_setting('request.jwt.claims', true))::json ->> 'tenant_id')::uuid);

CREATE UNIQUE INDEX idx_apparel_config_tenant ON inventory.apparel_config (tenant_id);

-- ── apparel_orders ──────────────────────────────────────────────────────────
-- Tracks shirt reorder requests from pending_approval through Printful fulfillment.

CREATE TABLE IF NOT EXISTS inventory.apparel_orders (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID        NOT NULL,
  status              TEXT        DEFAULT 'pending_approval'
                                  CHECK (status IN (
                                    'pending_approval','approved','rejected',
                                    'ordered','in_production','shipped',
                                    'fulfilled','failed','canceled'
                                  )),
  trigger_event       TEXT,
  trigger_payload     JSONB,
  items               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  total_estimated_cost NUMERIC,
  printful_order_id   INTEGER,
  printful_external_id TEXT,
  printful_status     TEXT,
  approved_by         UUID,
  approved_at         TIMESTAMPTZ,
  rejected_by         UUID,
  rejected_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE inventory.apparel_orders ENABLE ROW LEVEL SECURITY;

-- Service role: full access
CREATE POLICY "apparel_orders_service_all"
  ON inventory.apparel_orders
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated: tenant-scoped
CREATE POLICY "apparel_orders_tenant_access"
  ON inventory.apparel_orders
  FOR ALL
  TO authenticated
  USING (tenant_id = ((current_setting('request.jwt.claims', true))::json ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = ((current_setting('request.jwt.claims', true))::json ->> 'tenant_id')::uuid);

CREATE INDEX idx_apparel_orders_tenant ON inventory.apparel_orders (tenant_id);
CREATE INDEX idx_apparel_orders_status ON inventory.apparel_orders (tenant_id, status);
