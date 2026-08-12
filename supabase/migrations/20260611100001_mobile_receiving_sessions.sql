-- Mobile receiving sessions
-- Tokenized, revocable phone access for receiving deliveries against open POs,
-- mirroring inventory.mobile_count_sessions. A session is tenant-wide (not tied
-- to one PO) so the yard phone can receive whichever truck shows up.

CREATE TABLE supply_chain.mobile_receiving_sessions (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  token               TEXT NOT NULL UNIQUE,
  created_by_user_id  UUID NOT NULL,
  ttl_minutes         INTEGER NOT NULL DEFAULT 720,
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  last_used_at        TIMESTAMPTZ,
  device_info         JSONB,
  last_event_id       TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE supply_chain.mobile_receiving_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON supply_chain.mobile_receiving_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_tenant_access"
  ON supply_chain.mobile_receiving_sessions
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

CREATE INDEX idx_mobile_receiving_sessions_tenant_id
  ON supply_chain.mobile_receiving_sessions (tenant_id);

CREATE INDEX idx_mobile_receiving_sessions_active
  ON supply_chain.mobile_receiving_sessions (expires_at)
  WHERE revoked_at IS NULL;
