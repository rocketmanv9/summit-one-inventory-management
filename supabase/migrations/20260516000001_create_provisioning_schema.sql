-- ============================================================================
-- Migration: create_provisioning_schema
-- Description: Creates the provisioning domain schema with tables for
--   policy-driven, event-reactive employee provisioning.
--   Supports multiple fulfillment providers, kit templates, policy rules,
--   request lifecycle tracking, and employee gear management.
-- ============================================================================

-- ── Schema ──────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS provisioning;

-- ── Helper: tenant_id from JWT ──────────────────────────────────────────────
-- Reuse the same pattern as other schemas for RLS tenant isolation
-- (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid

-- ============================================================================
-- 1. providers — Fulfillment provider registry
-- ============================================================================
CREATE TABLE IF NOT EXISTS provisioning.providers (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  last_event_id     text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,

  provider_key      text        NOT NULL,
  display_name      text        NOT NULL,
  provider_type     text        NOT NULL
                    CHECK (provider_type IN (
                      'print_on_demand', 'uniform_vendor',
                      'internal_warehouse', 'custom'
                    )),
  config            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  capabilities      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  priority          integer     NOT NULL DEFAULT 100,
  is_active         boolean     NOT NULL DEFAULT true,

  CONSTRAINT uq_providers_tenant_key UNIQUE (tenant_id, provider_key)
);

CREATE INDEX idx_providers_tenant ON provisioning.providers (tenant_id);
CREATE INDEX idx_providers_active ON provisioning.providers (tenant_id, is_active, priority);

ALTER TABLE provisioning.providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY providers_service_role ON provisioning.providers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY providers_tenant_isolation ON provisioning.providers
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);


-- ============================================================================
-- 2. provider_item_mappings — Maps catalog items to provider product/variant IDs
-- ============================================================================
CREATE TABLE IF NOT EXISTS provisioning.provider_item_mappings (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  last_event_id       text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,

  provider_id         uuid        NOT NULL REFERENCES provisioning.providers(id) ON DELETE CASCADE,
  catalog_item_id     uuid        NOT NULL,
  external_product_id text,
  external_variant_id text,
  unit_cost           numeric,
  lead_time_days      integer,
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT uq_provider_item_mapping UNIQUE (tenant_id, provider_id, catalog_item_id)
);

CREATE INDEX idx_provider_item_mappings_tenant ON provisioning.provider_item_mappings (tenant_id);
CREATE INDEX idx_provider_item_mappings_provider ON provisioning.provider_item_mappings (provider_id);
CREATE INDEX idx_provider_item_mappings_catalog ON provisioning.provider_item_mappings (tenant_id, catalog_item_id);

ALTER TABLE provisioning.provider_item_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY provider_item_mappings_service_role ON provisioning.provider_item_mappings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY provider_item_mappings_tenant_isolation ON provisioning.provider_item_mappings
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);


-- ============================================================================
-- 3. kits — Reusable provisioning templates
-- ============================================================================
CREATE TABLE IF NOT EXISTS provisioning.kits (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  last_event_id     text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,

  name              text        NOT NULL,
  description       text,
  is_active         boolean     NOT NULL DEFAULT true,

  CONSTRAINT uq_kits_tenant_name UNIQUE (tenant_id, name)
);

CREATE INDEX idx_kits_tenant ON provisioning.kits (tenant_id);
CREATE INDEX idx_kits_active ON provisioning.kits (tenant_id, is_active);

ALTER TABLE provisioning.kits ENABLE ROW LEVEL SECURITY;

CREATE POLICY kits_service_role ON provisioning.kits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY kits_tenant_isolation ON provisioning.kits
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);


-- ============================================================================
-- 4. kit_lines — Items within a kit
-- ============================================================================
CREATE TABLE IF NOT EXISTS provisioning.kit_lines (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid        NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  last_event_id               text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,

  kit_id                      uuid        NOT NULL REFERENCES provisioning.kits(id) ON DELETE CASCADE,
  catalog_item_id             uuid        NOT NULL,
  qty                         integer     NOT NULL DEFAULT 1 CHECK (qty > 0),
  is_required                 boolean     NOT NULL DEFAULT true,
  size_source                 text        NOT NULL DEFAULT 'employee_profile'
                              CHECK (size_source IN ('employee_profile', 'fixed', 'ask_at_provision')),
  fixed_variant_attributes    jsonb,
  provider_id                 uuid        REFERENCES provisioning.providers(id) ON DELETE SET NULL,
  substitute_catalog_item_id  uuid,
  sort_order                  integer     NOT NULL DEFAULT 0
);

CREATE INDEX idx_kit_lines_tenant ON provisioning.kit_lines (tenant_id);
CREATE INDEX idx_kit_lines_kit ON provisioning.kit_lines (kit_id);

ALTER TABLE provisioning.kit_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY kit_lines_service_role ON provisioning.kit_lines
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY kit_lines_tenant_isolation ON provisioning.kit_lines
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);


-- ============================================================================
-- 5. policy_rules — Policy engine rules
-- ============================================================================
CREATE TABLE IF NOT EXISTS provisioning.policy_rules (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid        NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  last_event_id           text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,

  name                    text        NOT NULL,
  description             text,
  priority                integer     NOT NULL DEFAULT 100,

  -- Match conditions (null = wildcard / match any)
  match_positions         text[],
  match_divisions         text[],
  match_locations         text[],
  match_certifications    text[],
  match_employment_type   text,
  match_custom            jsonb,

  -- Action: either a kit reference or inline items
  kit_id                  uuid        REFERENCES provisioning.kits(id) ON DELETE SET NULL,
  items                   jsonb,

  -- Trigger events this rule reacts to
  trigger_events          text[]      NOT NULL DEFAULT '{}',

  -- Temporal validity
  effective_from          date,
  effective_until         date,

  requires_approval       boolean     NOT NULL DEFAULT false,
  is_active               boolean     NOT NULL DEFAULT true
);

CREATE INDEX idx_policy_rules_tenant ON provisioning.policy_rules (tenant_id);
CREATE INDEX idx_policy_rules_evaluation ON provisioning.policy_rules (tenant_id, is_active, priority);
CREATE INDEX idx_policy_rules_trigger_events ON provisioning.policy_rules USING gin (trigger_events);

ALTER TABLE provisioning.policy_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY policy_rules_service_role ON provisioning.policy_rules
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY policy_rules_tenant_isolation ON provisioning.policy_rules
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);


-- ============================================================================
-- 6. provisioning_requests — Central orchestration entity
-- ============================================================================
CREATE TABLE IF NOT EXISTS provisioning.provisioning_requests (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  last_event_id         text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,

  employee_id           text        NOT NULL,
  employee_name         text,
  employee_attributes   jsonb       NOT NULL DEFAULT '{}'::jsonb,

  trigger_event         text        NOT NULL,
  trigger_payload       jsonb,

  policy_rule_id        uuid        REFERENCES provisioning.policy_rules(id) ON DELETE SET NULL,
  kit_id                uuid        REFERENCES provisioning.kits(id) ON DELETE SET NULL,

  status                text        NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending', 'evaluating', 'awaiting_approval',
                          'approved', 'provisioning', 'partially_fulfilled',
                          'fulfilled', 'cancelled', 'failed'
                        )),

  delivery_method       text,
  shipping_address      jsonb,
  priority              integer     NOT NULL DEFAULT 100,
  needed_by             date,

  -- Idempotency dedup key for event-triggered requests
  dedup_key             text        UNIQUE
);

CREATE INDEX idx_prov_requests_tenant ON provisioning.provisioning_requests (tenant_id);
CREATE INDEX idx_prov_requests_employee ON provisioning.provisioning_requests (tenant_id, employee_id);
CREATE INDEX idx_prov_requests_status ON provisioning.provisioning_requests (tenant_id, status);

ALTER TABLE provisioning.provisioning_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY provisioning_requests_service_role ON provisioning.provisioning_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY provisioning_requests_tenant_isolation ON provisioning.provisioning_requests
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);


-- ============================================================================
-- 7. provisioning_lines — Individual items to fulfill
-- ============================================================================
CREATE TABLE IF NOT EXISTS provisioning.provisioning_lines (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid        NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  last_event_id               text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,

  request_id                  uuid        NOT NULL REFERENCES provisioning.provisioning_requests(id) ON DELETE CASCADE,
  catalog_item_id             uuid        NOT NULL,
  qty                         integer     NOT NULL DEFAULT 1 CHECK (qty > 0),

  fulfillment_method          text        NOT NULL DEFAULT 'from_stock'
                              CHECK (fulfillment_method IN ('from_stock', 'external_order', 'backorder')),

  provider_id                 uuid        REFERENCES provisioning.providers(id) ON DELETE SET NULL,
  resolved_variant_attributes jsonb,

  -- Inventory integration
  reservation_id              uuid,
  asset_id                    uuid,
  source_location_id          uuid,

  -- External order tracking
  external_order_id           text,
  tracking_number             text,
  tracking_url                text,

  status                      text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN (
                                'pending', 'reserved', 'ordered',
                                'in_production', 'shipped', 'delivered',
                                'issued', 'cancelled', 'failed',
                                'substituted', 'backordered'
                              )),

  -- Substitution tracking
  original_catalog_item_id    uuid,
  substitution_reason         text
);

CREATE INDEX idx_prov_lines_tenant ON provisioning.provisioning_lines (tenant_id);
CREATE INDEX idx_prov_lines_request ON provisioning.provisioning_lines (request_id);
CREATE INDEX idx_prov_lines_status ON provisioning.provisioning_lines (tenant_id, status);
CREATE INDEX idx_prov_lines_provider ON provisioning.provisioning_lines (provider_id) WHERE provider_id IS NOT NULL;

ALTER TABLE provisioning.provisioning_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY provisioning_lines_service_role ON provisioning.provisioning_lines
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY provisioning_lines_tenant_isolation ON provisioning.provisioning_lines
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);


-- ============================================================================
-- 8. provisioning_history — Immutable audit log
-- ============================================================================
CREATE TABLE IF NOT EXISTS provisioning.provisioning_history (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  request_id        uuid        REFERENCES provisioning.provisioning_requests(id) ON DELETE CASCADE,
  line_id           uuid        REFERENCES provisioning.provisioning_lines(id) ON DELETE CASCADE,

  action            text        NOT NULL,
  old_status        text,
  new_status        text,
  actor_user_id     uuid,
  actor_system      text,
  details           jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_prov_history_tenant ON provisioning.provisioning_history (tenant_id);
CREATE INDEX idx_prov_history_request ON provisioning.provisioning_history (request_id);
CREATE INDEX idx_prov_history_line ON provisioning.provisioning_history (line_id) WHERE line_id IS NOT NULL;
CREATE INDEX idx_prov_history_created ON provisioning.provisioning_history (created_at);

ALTER TABLE provisioning.provisioning_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY provisioning_history_service_role ON provisioning.provisioning_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY provisioning_history_tenant_isolation ON provisioning.provisioning_history
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);


-- ============================================================================
-- 9. employee_provisions — What each employee currently has
-- ============================================================================
CREATE TABLE IF NOT EXISTS provisioning.employee_provisions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  last_event_id         text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,

  employee_id           text        NOT NULL,
  catalog_item_id       uuid        NOT NULL,
  asset_id              uuid,
  qty                   integer     NOT NULL DEFAULT 1,

  status                text        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'returned', 'expired', 'transferred')),

  issued_at             timestamptz NOT NULL DEFAULT now(),
  returned_at           timestamptz,
  provisioning_line_id  uuid        REFERENCES provisioning.provisioning_lines(id) ON DELETE SET NULL
);

CREATE INDEX idx_emp_provisions_tenant ON provisioning.employee_provisions (tenant_id);
CREATE INDEX idx_emp_provisions_employee ON provisioning.employee_provisions (tenant_id, employee_id);
CREATE INDEX idx_emp_provisions_status ON provisioning.employee_provisions (tenant_id, status);
CREATE INDEX idx_emp_provisions_item ON provisioning.employee_provisions (tenant_id, catalog_item_id);

ALTER TABLE provisioning.employee_provisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY employee_provisions_service_role ON provisioning.employee_provisions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY employee_provisions_tenant_isolation ON provisioning.employee_provisions
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);


-- ============================================================================
-- Updated-at trigger (reusable across all provisioning tables)
-- ============================================================================
CREATE OR REPLACE FUNCTION provisioning.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_providers_updated_at
  BEFORE UPDATE ON provisioning.providers
  FOR EACH ROW EXECUTE FUNCTION provisioning.set_updated_at();

CREATE TRIGGER trg_provider_item_mappings_updated_at
  BEFORE UPDATE ON provisioning.provider_item_mappings
  FOR EACH ROW EXECUTE FUNCTION provisioning.set_updated_at();

CREATE TRIGGER trg_kits_updated_at
  BEFORE UPDATE ON provisioning.kits
  FOR EACH ROW EXECUTE FUNCTION provisioning.set_updated_at();

CREATE TRIGGER trg_kit_lines_updated_at
  BEFORE UPDATE ON provisioning.kit_lines
  FOR EACH ROW EXECUTE FUNCTION provisioning.set_updated_at();

CREATE TRIGGER trg_policy_rules_updated_at
  BEFORE UPDATE ON provisioning.policy_rules
  FOR EACH ROW EXECUTE FUNCTION provisioning.set_updated_at();

CREATE TRIGGER trg_provisioning_requests_updated_at
  BEFORE UPDATE ON provisioning.provisioning_requests
  FOR EACH ROW EXECUTE FUNCTION provisioning.set_updated_at();

CREATE TRIGGER trg_provisioning_lines_updated_at
  BEFORE UPDATE ON provisioning.provisioning_lines
  FOR EACH ROW EXECUTE FUNCTION provisioning.set_updated_at();

CREATE TRIGGER trg_employee_provisions_updated_at
  BEFORE UPDATE ON provisioning.employee_provisions
  FOR EACH ROW EXECUTE FUNCTION provisioning.set_updated_at();
