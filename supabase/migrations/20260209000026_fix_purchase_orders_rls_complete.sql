/**
 * Fix: Update purchase_orders RLS policies to match vendors pattern
 * 
 * Includes:
 * - Service role bypass
 * - Runtime tenant_id settings
 * - Both JWT tenant_id paths (app_metadata and root)
 */

-- Drop existing policies if they exist
DROP POLICY IF EXISTS purchase_orders_tenant_isolation ON supply_chain.purchase_orders;
DROP POLICY IF EXISTS purchase_orders_tenant_isolation_tenant_isolation ON supply_chain.purchase_orders;
DROP POLICY IF EXISTS purchase_orders_update_admin_or_draft ON supply_chain.purchase_orders;
DROP POLICY IF EXISTS tenant_isolation ON supply_chain.purchase_orders;

-- Create new policy that checks both JWT paths (matching vendors pattern)
CREATE POLICY purchase_orders_tenant_isolation ON supply_chain.purchase_orders
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

-- Drop existing policies for purchase_order_lines
DROP POLICY IF EXISTS purchase_order_lines_tenant_isolation ON supply_chain.purchase_order_lines;
DROP POLICY IF EXISTS tenant_isolation ON supply_chain.purchase_order_lines;

-- Create new policy for purchase_order_lines (matching vendors pattern)
CREATE POLICY purchase_order_lines_tenant_isolation ON supply_chain.purchase_order_lines
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
