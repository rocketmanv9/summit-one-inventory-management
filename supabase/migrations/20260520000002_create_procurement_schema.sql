-- ============================================================================
-- Migration: create_procurement_schema
-- Description: Creates the procurement domain schema with tables for
--   shopping carts, orders, order items, and an immutable audit log.
--   Supports multi-provider procurement via provisioning.providers registry.
-- ============================================================================

-- ── Schema ──────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS procurement;

-- ── Helper: updated_at trigger function ─────────────────────────────────────
CREATE OR REPLACE FUNCTION procurement.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Helper: sequential order number generator ───────────────────────────────
CREATE OR REPLACE FUNCTION procurement.next_order_number(p_tenant_id uuid)
RETURNS text AS $$
DECLARE
  seq_val integer;
  year_part text;
BEGIN
  year_part := to_char(now(), 'YYYY');

  SELECT COALESCE(MAX(
    CAST(
      SUBSTRING(order_number FROM 'PROC-' || year_part || '-(\d+)')
      AS integer
    )
  ), 0) + 1
  INTO seq_val
  FROM procurement.orders
  WHERE tenant_id = p_tenant_id
    AND order_number LIKE 'PROC-' || year_part || '-%';

  RETURN 'PROC-' || year_part || '-' || LPAD(seq_val::text, 4, '0');
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 1. carts — Shopping carts per user/provider
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurement.carts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_event_id   text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,

  user_id         uuid        NOT NULL,
  provider_id     uuid        NOT NULL REFERENCES provisioning.providers(id) ON DELETE CASCADE,
  status          text        NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'checked_out', 'abandoned', 'expired')),

  notes           text,

  CONSTRAINT uq_carts_active_user_provider UNIQUE (tenant_id, user_id, provider_id, status)
);

CREATE INDEX idx_carts_tenant ON procurement.carts (tenant_id);
CREATE INDEX idx_carts_user ON procurement.carts (tenant_id, user_id);
CREATE INDEX idx_carts_active ON procurement.carts (tenant_id, user_id, status) WHERE status = 'active';

ALTER TABLE procurement.carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY carts_service_role ON procurement.carts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY carts_tenant_isolation ON procurement.carts
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE TRIGGER trg_carts_updated_at
  BEFORE UPDATE ON procurement.carts
  FOR EACH ROW EXECUTE FUNCTION procurement.set_updated_at();


-- ============================================================================
-- 2. cart_items — Line items in a cart
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurement.cart_items (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  last_event_id       text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,

  cart_id             uuid        NOT NULL REFERENCES procurement.carts(id) ON DELETE CASCADE,
  external_product_id text        NOT NULL,
  product_title       text        NOT NULL,
  product_image_url   text,
  quantity            integer     NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price          numeric     NOT NULL DEFAULT 0,
  catalog_item_id     uuid,
  variant_attributes  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  notes               text
);

CREATE INDEX idx_cart_items_tenant ON procurement.cart_items (tenant_id);
CREATE INDEX idx_cart_items_cart ON procurement.cart_items (cart_id);

ALTER TABLE procurement.cart_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY cart_items_service_role ON procurement.cart_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY cart_items_tenant_isolation ON procurement.cart_items
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE TRIGGER trg_cart_items_updated_at
  BEFORE UPDATE ON procurement.cart_items
  FOR EACH ROW EXECUTE FUNCTION procurement.set_updated_at();


-- ============================================================================
-- 3. orders — Placed procurement orders
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurement.orders (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  last_event_id       text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,

  order_number        text        NOT NULL,
  provider_id         uuid        NOT NULL REFERENCES provisioning.providers(id) ON DELETE RESTRICT,
  external_order_id   text,

  status              text        NOT NULL DEFAULT 'draft'
                      CHECK (status IN (
                        'draft', 'submitted', 'confirmed', 'processing',
                        'partially_shipped', 'shipped', 'partially_received',
                        'received', 'cancelled', 'failed'
                      )),

  submitted_by        uuid,
  submitted_at        timestamptz,

  shipping_address    jsonb,
  billing_address     jsonb,

  subtotal            numeric     NOT NULL DEFAULT 0,
  tax_amount          numeric     NOT NULL DEFAULT 0,
  shipping_amount     numeric     NOT NULL DEFAULT 0,
  total_amount        numeric     NOT NULL DEFAULT 0,

  -- Phase 2 nullable fields
  job_id              uuid,
  cost_center         text,
  approval_chain      jsonb,
  approved_by         uuid,
  approved_at         timestamptz,

  notes               text,
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT uq_orders_tenant_number UNIQUE (tenant_id, order_number)
);

CREATE INDEX idx_orders_tenant ON procurement.orders (tenant_id);
CREATE INDEX idx_orders_status ON procurement.orders (tenant_id, status);
CREATE INDEX idx_orders_provider ON procurement.orders (provider_id);
CREATE INDEX idx_orders_submitted_by ON procurement.orders (tenant_id, submitted_by);
CREATE INDEX idx_orders_external ON procurement.orders (provider_id, external_order_id) WHERE external_order_id IS NOT NULL;

ALTER TABLE procurement.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_service_role ON procurement.orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY orders_tenant_isolation ON procurement.orders
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON procurement.orders
  FOR EACH ROW EXECUTE FUNCTION procurement.set_updated_at();


-- ============================================================================
-- 4. order_items — Line items in an order
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurement.order_items (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  last_event_id       text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,

  order_id            uuid        NOT NULL REFERENCES procurement.orders(id) ON DELETE CASCADE,
  external_product_id text        NOT NULL,
  product_title       text        NOT NULL,
  product_image_url   text,
  quantity            integer     NOT NULL DEFAULT 1 CHECK (quantity > 0),
  qty_received        integer     NOT NULL DEFAULT 0,
  unit_price          numeric     NOT NULL DEFAULT 0,
  line_total          numeric     NOT NULL DEFAULT 0,
  catalog_item_id     uuid,
  variant_attributes  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  tracking_number     text,
  tracking_url        text,
  notes               text
);

CREATE INDEX idx_order_items_tenant ON procurement.order_items (tenant_id);
CREATE INDEX idx_order_items_order ON procurement.order_items (order_id);
CREATE INDEX idx_order_items_catalog ON procurement.order_items (tenant_id, catalog_item_id) WHERE catalog_item_id IS NOT NULL;

ALTER TABLE procurement.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_items_service_role ON procurement.order_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY order_items_tenant_isolation ON procurement.order_items
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE TRIGGER trg_order_items_updated_at
  BEFORE UPDATE ON procurement.order_items
  FOR EACH ROW EXECUTE FUNCTION procurement.set_updated_at();


-- ============================================================================
-- 5. audit_log — Immutable procurement activity log
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurement.audit_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  entity_type     text        NOT NULL
                  CHECK (entity_type IN ('cart', 'order', 'provider')),
  entity_id       uuid        NOT NULL,
  action          text        NOT NULL,
  old_value       jsonb,
  new_value       jsonb,
  actor_user_id   uuid,
  details         jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_audit_log_tenant ON procurement.audit_log (tenant_id);
CREATE INDEX idx_audit_log_entity ON procurement.audit_log (tenant_id, entity_type, entity_id);
CREATE INDEX idx_audit_log_created ON procurement.audit_log (created_at);
CREATE INDEX idx_audit_log_actor ON procurement.audit_log (actor_user_id) WHERE actor_user_id IS NOT NULL;

ALTER TABLE procurement.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_service_role ON procurement.audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY audit_log_tenant_isolation ON procurement.audit_log
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
