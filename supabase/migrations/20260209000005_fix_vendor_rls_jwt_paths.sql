-- Fix RLS: support both JWT tenant_id paths for supply_chain.vendors

DROP POLICY IF EXISTS vendors_tenant_isolation_tenant_isolation ON supply_chain.vendors;
CREATE POLICY vendors_tenant_isolation_tenant_isolation
  ON supply_chain.vendors
  FOR ALL
  TO public
  USING (
    current_role = 'service_role'::text
    OR tenant_id = COALESCE(
      NULLIF(current_setting('app.current_tenant_id', true), '')::uuid,
      NULLIF(current_setting('app.tenant_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    current_role = 'service_role'::text
    OR tenant_id = COALESCE(
      NULLIF(current_setting('app.current_tenant_id', true), '')::uuid,
      NULLIF(current_setting('app.tenant_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );
