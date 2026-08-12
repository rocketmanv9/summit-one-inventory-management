-- Cycle count scheduling: templates, qualified counters, and calendar entries.
--
-- Templates define a recurring audit ("count this location N times per year,
-- these items, blind or not"). Schedule entries are the concrete dated
-- occurrences laid out on the calendar — created manually or by the AI
-- auto-scheduler — and carry the person assigned. When an entry's date
-- arrives it is materialized into a real inventory.cycle_counts row.

-- ── Templates ───────────────────────────────────────────────────────────

CREATE TABLE inventory.cycle_count_templates (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  location_id         UUID NOT NULL REFERENCES inventory.locations(id),
  count_type          TEXT NOT NULL DEFAULT 'partial'
                        CHECK (count_type IN ('full', 'partial', 'spot_check')),
  is_blind            BOOLEAN NOT NULL DEFAULT false,
  -- NULL = count everything at the location
  catalog_item_ids    UUID[],
  frequency_per_year  INTEGER NOT NULL DEFAULT 4
                        CHECK (frequency_per_year BETWEEN 1 AND 365),
  active              BOOLEAN NOT NULL DEFAULT true,
  notes               TEXT,
  last_event_id       TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE inventory.cycle_count_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON inventory.cycle_count_templates
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_tenant_access"
  ON inventory.cycle_count_templates
  FOR ALL TO authenticated
  USING (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));

CREATE INDEX idx_cycle_count_templates_tenant_id
  ON inventory.cycle_count_templates (tenant_id);

CREATE INDEX idx_cycle_count_templates_active
  ON inventory.cycle_count_templates (tenant_id, location_id)
  WHERE active;

-- ── Qualified counters (admin-managed) ──────────────────────────────────

CREATE TABLE inventory.cycle_count_qualified_users (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  user_id        UUID NOT NULL,
  active         BOOLEAN NOT NULL DEFAULT true,
  notes          TEXT,
  last_event_id  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

ALTER TABLE inventory.cycle_count_qualified_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON inventory.cycle_count_qualified_users
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_tenant_access"
  ON inventory.cycle_count_qualified_users
  FOR ALL TO authenticated
  USING (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));

CREATE INDEX idx_cycle_count_qualified_users_tenant_id
  ON inventory.cycle_count_qualified_users (tenant_id);

-- ── Schedule entries (calendar) ─────────────────────────────────────────

CREATE TABLE inventory.cycle_count_schedule (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id            UUID NOT NULL,
  template_id          UUID NOT NULL REFERENCES inventory.cycle_count_templates(id) ON DELETE CASCADE,
  scheduled_date       DATE NOT NULL,
  assigned_to_user_id  UUID,
  status               TEXT NOT NULL DEFAULT 'planned'
                         CHECK (status IN ('planned', 'generated', 'completed', 'skipped')),
  -- Set once the entry is materialized into a real count
  cycle_count_id       UUID REFERENCES inventory.cycle_counts(id),
  -- Why the AI picked this date/person (shown in the calendar UI)
  ai_rationale         TEXT,
  last_event_id        TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One occurrence of a template per day; makes auto-scheduling idempotent
  UNIQUE (tenant_id, template_id, scheduled_date)
);

ALTER TABLE inventory.cycle_count_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON inventory.cycle_count_schedule
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_tenant_access"
  ON inventory.cycle_count_schedule
  FOR ALL TO authenticated
  USING (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));

CREATE INDEX idx_cycle_count_schedule_tenant_id
  ON inventory.cycle_count_schedule (tenant_id);

CREATE INDEX idx_cycle_count_schedule_date
  ON inventory.cycle_count_schedule (tenant_id, scheduled_date);

CREATE INDEX idx_cycle_count_schedule_open
  ON inventory.cycle_count_schedule (tenant_id, scheduled_date)
  WHERE status = 'planned';
