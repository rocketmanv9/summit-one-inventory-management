-- ============================================================================
-- FIX: Allow service_role to bypass tenant isolation on supply_chain tables
-- ============================================================================
-- Date: 2026-01-23
-- Issue: RLS policies checking auth.jwt() fail for service_role API calls
-- Solution: Update policies to allow service_role or check current_setting
-- ============================================================================

-- Drop and recreate the tenant isolation policies to allow service_role
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
  );

DROP POLICY IF EXISTS vendor_items_tenant_isolation_tenant_isolation ON supply_chain.vendor_items;
CREATE POLICY vendor_items_tenant_isolation_tenant_isolation 
  ON supply_chain.vendor_items
  FOR ALL
  TO public
  USING (
    current_role = 'service_role'::text 
    OR tenant_id = COALESCE(
      current_setting('app.tenant_id', true)::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

DROP POLICY IF EXISTS purchase_orders_tenant_isolation_tenant_isolation ON supply_chain.purchase_orders;
CREATE POLICY purchase_orders_tenant_isolation_tenant_isolation 
  ON supply_chain.purchase_orders
  FOR ALL
  TO public
  USING (
    current_role = 'service_role'::text 
    OR tenant_id = COALESCE(
      current_setting('app.tenant_id', true)::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

DROP POLICY IF EXISTS purchase_order_lines_tenant_isolation_tenant_isolation ON supply_chain.purchase_order_lines;
CREATE POLICY purchase_order_lines_tenant_isolation_tenant_isolation 
  ON supply_chain.purchase_order_lines
  FOR ALL
  TO public
  USING (
    current_role = 'service_role'::text 
    OR tenant_id = COALESCE(
      current_setting('app.tenant_id', true)::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

DROP POLICY IF EXISTS receipts_tenant_isolation_tenant_isolation ON supply_chain.receipts;
CREATE POLICY receipts_tenant_isolation_tenant_isolation 
  ON supply_chain.receipts
  FOR ALL
  TO public
  USING (
    current_role = 'service_role'::text 
    OR tenant_id = COALESCE(
      current_setting('app.tenant_id', true)::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

DROP POLICY IF EXISTS receipt_lines_tenant_isolation_tenant_isolation ON supply_chain.receipt_lines;
CREATE POLICY receipt_lines_tenant_isolation_tenant_isolation 
  ON supply_chain.receipt_lines
  FOR ALL
  TO public
  USING (
    current_role = 'service_role'::text 
    OR tenant_id = COALESCE(
      current_setting('app.tenant_id', true)::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

DROP POLICY IF EXISTS accounting_expenses_tenant_isolation_tenant_isolation ON supply_chain.accounting_expenses;
CREATE POLICY accounting_expenses_tenant_isolation_tenant_isolation 
  ON supply_chain.accounting_expenses
  FOR ALL
  TO public
  USING (
    current_role = 'service_role'::text 
    OR tenant_id = COALESCE(
      current_setting('app.tenant_id', true)::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

DROP POLICY IF EXISTS procurement_events_tenant_isolation_tenant_isolation ON supply_chain.procurement_events;
CREATE POLICY procurement_events_tenant_isolation_tenant_isolation 
  ON supply_chain.procurement_events
  FOR ALL
  TO public
  USING (
    current_role = 'service_role'::text 
    OR tenant_id = COALESCE(
      current_setting('app.tenant_id', true)::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

DROP POLICY IF EXISTS vendor_performance_events_tenant_isolation_tenant_isolation ON supply_chain.vendor_performance_events;
CREATE POLICY vendor_performance_events_tenant_isolation_tenant_isolation 
  ON supply_chain.vendor_performance_events
  FOR ALL
  TO public
  USING (
    current_role = 'service_role'::text 
    OR tenant_id = COALESCE(
      current_setting('app.tenant_id', true)::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

DROP POLICY IF EXISTS vendor_performance_metrics_tenant_isolation_tenant_isolation ON supply_chain.vendor_performance_metrics;
CREATE POLICY vendor_performance_metrics_tenant_isolation_tenant_isolation 
  ON supply_chain.vendor_performance_metrics
  FOR ALL
  TO public
  USING (
    current_role = 'service_role'::text 
    OR tenant_id = COALESCE(
      current_setting('app.tenant_id', true)::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );
