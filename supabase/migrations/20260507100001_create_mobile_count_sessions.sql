-- Mobile cycle count sessions
-- Stores temporary, revocable tokens that allow QR-code-based mobile access
-- to a specific in-progress cycle count without full user login.

CREATE TABLE inventory.mobile_count_sessions (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  token               TEXT NOT NULL UNIQUE,
  cycle_count_id      UUID NOT NULL REFERENCES inventory.cycle_counts(id),
  created_by_user_id  UUID NOT NULL,
  ttl_minutes         INTEGER NOT NULL DEFAULT 240,
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  last_used_at        TIMESTAMPTZ,
  device_info         JSONB,
  last_event_id       TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE inventory.mobile_count_sessions ENABLE ROW LEVEL SECURITY;

-- Service role: full access
CREATE POLICY "service_role_all"
  ON inventory.mobile_count_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users: tenant-scoped access
CREATE POLICY "authenticated_tenant_access"
  ON inventory.mobile_count_sessions
  FOR ALL
  TO authenticated
  USING (
    tenant_id = (
      SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    tenant_id = (
      SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    )
  );

-- Indexes
CREATE INDEX idx_mobile_count_sessions_tenant_id
  ON inventory.mobile_count_sessions (tenant_id);

CREATE INDEX idx_mobile_count_sessions_cycle_count_id
  ON inventory.mobile_count_sessions (cycle_count_id);

CREATE INDEX idx_mobile_count_sessions_active
  ON inventory.mobile_count_sessions (expires_at)
  WHERE revoked_at IS NULL;
