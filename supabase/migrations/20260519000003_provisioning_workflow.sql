-- Migration: provisioning_workflow
-- Adds dry-run mode, blocking-state detection, employee sizing,
-- notifications, and extended request/line status tracking.

-- ============================================================
-- 1. Expand request statuses for blocking + tracking states
-- ============================================================
ALTER TABLE provisioning.provisioning_requests
  DROP CONSTRAINT IF EXISTS provisioning_requests_status_check;
ALTER TABLE provisioning.provisioning_requests
  ADD CONSTRAINT provisioning_requests_status_check
  CHECK (status IN (
    -- Existing
    'pending', 'evaluating', 'awaiting_approval', 'approved',
    'provisioning', 'partially_fulfilled', 'fulfilled', 'cancelled', 'failed',
    -- New: blocking states
    'draft', 'needs_mapping', 'needs_address', 'needs_sizing', 'needs_approval',
    -- New: ready + Printify tracking
    'ready_to_order', 'submitted', 'in_production', 'shipped', 'delivered'
  ));

-- ============================================================
-- 2. Add dry-run + blocking metadata to requests
-- ============================================================
ALTER TABLE provisioning.provisioning_requests
  ADD COLUMN IF NOT EXISTS is_dry_run BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocking_reasons JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- ============================================================
-- 3. Expand line statuses + add dry-run payload column
-- ============================================================
ALTER TABLE provisioning.provisioning_lines
  DROP CONSTRAINT IF EXISTS provisioning_lines_status_check;
ALTER TABLE provisioning.provisioning_lines
  ADD CONSTRAINT provisioning_lines_status_check
  CHECK (status IN (
    'pending', 'reserved', 'ordered', 'in_production', 'shipped', 'delivered',
    'issued', 'cancelled', 'failed', 'substituted', 'backordered',
    'dry_run_complete', 'needs_mapping'
  ));

ALTER TABLE provisioning.provisioning_lines
  ADD COLUMN IF NOT EXISTS dry_run_payload JSONB;

-- ============================================================
-- 4. Employee sizing table
-- ============================================================
CREATE TABLE IF NOT EXISTS provisioning.employee_sizing (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_event_id   text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,

  employee_id     text        NOT NULL,
  shirt_size      text,
  hoodie_size     text,
  jacket_size     text,
  pants_size      text,
  boot_size       text,
  preferred_fit   text        CHECK (preferred_fit IN ('slim', 'regular', 'relaxed')),

  UNIQUE (tenant_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_sizing_tenant
  ON provisioning.employee_sizing (tenant_id);
CREATE INDEX IF NOT EXISTS idx_employee_sizing_employee
  ON provisioning.employee_sizing (tenant_id, employee_id);

ALTER TABLE provisioning.employee_sizing ENABLE ROW LEVEL SECURITY;

CREATE POLICY employee_sizing_service_role ON provisioning.employee_sizing
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY employee_sizing_tenant_isolation ON provisioning.employee_sizing
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

-- Updated-at trigger (reuse existing provisioning trigger function)
CREATE TRIGGER set_employee_sizing_updated_at
  BEFORE UPDATE ON provisioning.employee_sizing
  FOR EACH ROW EXECUTE FUNCTION provisioning.set_updated_at();

-- ============================================================
-- 5. Notifications table
-- ============================================================
CREATE TABLE IF NOT EXISTS provisioning.notifications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_event_id   text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,

  recipient_role  text        NOT NULL DEFAULT 'manager'
                  CHECK (recipient_role IN ('manager', 'admin', 'hr', 'all')),
  notification_type text      NOT NULL,
  title           text        NOT NULL,
  body            text,
  severity        text        NOT NULL DEFAULT 'info'
                  CHECK (severity IN ('info', 'warning', 'error', 'success')),

  -- Link to source entity
  request_id      uuid        REFERENCES provisioning.provisioning_requests(id) ON DELETE CASCADE,
  employee_id     text,

  -- Read tracking
  is_read         boolean     NOT NULL DEFAULT false,
  read_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant
  ON provisioning.notifications (tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON provisioning.notifications (tenant_id, is_read) WHERE is_read = false;

ALTER TABLE provisioning.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_service_role ON provisioning.notifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY notifications_tenant_isolation ON provisioning.notifications
  FOR ALL TO authenticated
  USING  (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

-- ============================================================
-- 6. Add size_dimension to kit_lines
-- ============================================================
ALTER TABLE provisioning.kit_lines
  ADD COLUMN IF NOT EXISTS size_dimension text
    CHECK (size_dimension IN ('shirt_size', 'hoodie_size', 'jacket_size', 'pants_size', 'boot_size'));

-- ============================================================
-- 7. Indexes for failure queue (blocked / failed requests)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_prov_requests_blocking
  ON provisioning.provisioning_requests (tenant_id, status)
  WHERE status IN ('needs_mapping', 'needs_address', 'needs_sizing', 'failed');
