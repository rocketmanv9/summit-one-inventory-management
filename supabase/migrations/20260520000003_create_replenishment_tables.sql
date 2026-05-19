-- ============================================================================
-- Migration: create_replenishment_tables
-- Drop unused cart tables, create replenishment domain tables
-- ============================================================================

-- ── Drop unused cart tables ─────────────────────────────────────────────────
DROP TABLE IF EXISTS procurement.cart_items CASCADE;
DROP TABLE IF EXISTS procurement.carts CASCADE;

-- ── Reorder Rules ───────────────────────────────────────────────────────────
CREATE TABLE procurement.reorder_rules (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  last_event_id   TEXT,
  catalog_item_id UUID NOT NULL,
  item_name       TEXT NOT NULL,
  reorder_point   INTEGER NOT NULL,
  reorder_qty     INTEGER NOT NULL,
  max_stock       INTEGER,
  preferred_provider_id UUID REFERENCES provisioning.providers(id),
  external_product_id   TEXT,
  external_variant_id   TEXT,
  unit_cost       NUMERIC,
  auto_reorder    BOOLEAN DEFAULT false,
  max_auto_amount NUMERIC,
  is_active       BOOLEAN DEFAULT true,
  UNIQUE (tenant_id, catalog_item_id)
);

ALTER TABLE procurement.reorder_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access" ON procurement.reorder_rules
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "tenant isolation" ON procurement.reorder_rules
  FOR ALL TO authenticated
  USING (tenant_id = ((current_setting('request.jwt.claims', true))::json ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = ((current_setting('request.jwt.claims', true))::json ->> 'tenant_id')::uuid);

CREATE INDEX idx_reorder_rules_tenant ON procurement.reorder_rules(tenant_id);
CREATE INDEX idx_reorder_rules_catalog_item ON procurement.reorder_rules(tenant_id, catalog_item_id);

CREATE TRIGGER set_updated_at_reorder_rules
  BEFORE UPDATE ON procurement.reorder_rules
  FOR EACH ROW EXECUTE FUNCTION procurement.set_updated_at();

-- ── Replenishment Requests ──────────────────────────────────────────────────
CREATE TABLE procurement.replenishment_requests (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  last_event_id   TEXT,
  request_number  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'submitted', 'partially_received', 'received', 'cancelled')),
  trigger_type    TEXT NOT NULL
    CHECK (trigger_type IN ('manual', 'low_stock', 'cycle_count', 'consumable_kit', 'scheduled')),
  trigger_details JSONB DEFAULT '{}',
  requested_by    UUID,
  approved_by     UUID,
  approved_at     TIMESTAMPTZ,
  provider_id     UUID REFERENCES provisioning.providers(id),
  order_id        UUID REFERENCES procurement.orders(id),
  shipping_address JSONB,
  subtotal        NUMERIC DEFAULT 0,
  total_amount    NUMERIC DEFAULT 0,
  notes           TEXT,
  job_id          UUID,
  cost_center     TEXT
);

ALTER TABLE procurement.replenishment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access" ON procurement.replenishment_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "tenant isolation" ON procurement.replenishment_requests
  FOR ALL TO authenticated
  USING (tenant_id = ((current_setting('request.jwt.claims', true))::json ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = ((current_setting('request.jwt.claims', true))::json ->> 'tenant_id')::uuid);

CREATE INDEX idx_replenishment_requests_tenant ON procurement.replenishment_requests(tenant_id);
CREATE INDEX idx_replenishment_requests_status ON procurement.replenishment_requests(tenant_id, status);

CREATE TRIGGER set_updated_at_replenishment_requests
  BEFORE UPDATE ON procurement.replenishment_requests
  FOR EACH ROW EXECUTE FUNCTION procurement.set_updated_at();

-- ── Replenishment Request Items ─────────────────────────────────────────────
CREATE TABLE procurement.replenishment_request_items (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  last_event_id       TEXT,
  request_id          UUID NOT NULL REFERENCES procurement.replenishment_requests(id) ON DELETE CASCADE,
  catalog_item_id     UUID NOT NULL,
  item_name           TEXT NOT NULL,
  quantity            INTEGER NOT NULL,
  unit_price          NUMERIC DEFAULT 0,
  external_product_id TEXT,
  external_variant_id TEXT,
  reorder_rule_id     UUID REFERENCES procurement.reorder_rules(id)
);

ALTER TABLE procurement.replenishment_request_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access" ON procurement.replenishment_request_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "tenant isolation" ON procurement.replenishment_request_items
  FOR ALL TO authenticated
  USING (tenant_id = ((current_setting('request.jwt.claims', true))::json ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = ((current_setting('request.jwt.claims', true))::json ->> 'tenant_id')::uuid);

CREATE INDEX idx_replenishment_request_items_tenant ON procurement.replenishment_request_items(tenant_id);
CREATE INDEX idx_replenishment_request_items_request ON procurement.replenishment_request_items(request_id);

CREATE TRIGGER set_updated_at_replenishment_request_items
  BEFORE UPDATE ON procurement.replenishment_request_items
  FOR EACH ROW EXECUTE FUNCTION procurement.set_updated_at();
