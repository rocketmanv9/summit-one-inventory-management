-- Enable RLS on 4 tables that were missing it.
-- inventory.location_types and supply_chain.tenant_settings are tenant-scoped.
-- public.event_definitions and public.event_consumers are platform-level catalogs
-- (no tenant_id) — authenticated gets read-only, service_role gets full access.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. inventory.location_types  (tenant-scoped)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE inventory.location_types ENABLE ROW LEVEL SECURITY;

-- service_role: unrestricted
CREATE POLICY location_types_service_role
  ON inventory.location_types
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated: tenant isolation via JWT claim
CREATE POLICY location_types_tenant_isolation
  ON inventory.location_types
  FOR ALL
  TO authenticated
  USING (
    tenant_id = COALESCE(
      ((auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    tenant_id = COALESCE(
      ((auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 2. supply_chain.tenant_settings  (tenant-scoped)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE supply_chain.tenant_settings ENABLE ROW LEVEL SECURITY;

-- service_role: unrestricted
CREATE POLICY tenant_settings_service_role
  ON supply_chain.tenant_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated: tenant isolation via JWT claim
CREATE POLICY tenant_settings_tenant_isolation
  ON supply_chain.tenant_settings
  FOR ALL
  TO authenticated
  USING (
    tenant_id = COALESCE(
      ((auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    tenant_id = COALESCE(
      ((auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 3. public.event_definitions  (platform catalog — no tenant_id)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.event_definitions ENABLE ROW LEVEL SECURITY;

-- service_role: unrestricted
CREATE POLICY event_definitions_service_role
  ON public.event_definitions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated: read-only
CREATE POLICY event_definitions_authenticated_read
  ON public.event_definitions
  FOR SELECT
  TO authenticated
  USING (true);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. public.event_consumers  (platform catalog — no tenant_id)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.event_consumers ENABLE ROW LEVEL SECURITY;

-- service_role: unrestricted
CREATE POLICY event_consumers_service_role
  ON public.event_consumers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated: read-only
CREATE POLICY event_consumers_authenticated_read
  ON public.event_consumers
  FOR SELECT
  TO authenticated
  USING (true);
