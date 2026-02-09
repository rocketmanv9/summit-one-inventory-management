-- Fix RLS: allow inserts/updates on supply_chain.vendors for tenant-scoped users

DROP POLICY IF EXISTS vendors_tenant_isolation_tenant_isolation ON supply_chain.vendors;
CREATE POLICY vendors_tenant_isolation_tenant_isolation
  ON supply_chain.vendors
  FOR ALL
  TO public
  USING (
    current_role = 'service_role'::text
    OR tenant_id = COALESCE(
      current_setting('app.tenant_id', true)::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    current_role = 'service_role'::text
    OR tenant_id = COALESCE(
      current_setting('app.tenant_id', true)::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );
