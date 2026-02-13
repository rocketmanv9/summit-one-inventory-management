-- Add Missing RLS Policies for Tenant Isolation
-- Run this after verifying which tables are missing policies

-- Enable RLS on all tenant-scoped tables (if not already enabled)
ALTER TABLE IF EXISTS inventory.catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS inventory.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS inventory.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS inventory.stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS inventory.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS inventory.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS inventory.cycle_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS inventory.cycle_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS inventory.rfid_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS inventory.rfid_devices ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS supply_chain.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS supply_chain.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS supply_chain.purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS supply_chain.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS supply_chain.receipt_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tenant_memberships ENABLE ROW LEVEL SECURITY;

-- Create tenant isolation policies using JWT claims
-- These policies allow users to only access data for their tenant_id (from JWT app_metadata)

-- Inventory schema
DROP POLICY IF EXISTS "tenant_isolation" ON inventory.catalog_items;
CREATE POLICY "tenant_isolation" ON inventory.catalog_items
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS "tenant_isolation" ON inventory.assets;
CREATE POLICY "tenant_isolation" ON inventory.assets
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS "tenant_isolation" ON inventory.locations;
CREATE POLICY "tenant_isolation" ON inventory.locations
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS "tenant_isolation" ON inventory.stock_balances;
CREATE POLICY "tenant_isolation" ON inventory.stock_balances
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS "tenant_isolation" ON inventory.reservations;
CREATE POLICY "tenant_isolation" ON inventory.reservations
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS "tenant_isolation" ON inventory.transfers;
CREATE POLICY "tenant_isolation" ON inventory.transfers
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS "tenant_isolation" ON inventory.cycle_counts;
CREATE POLICY "tenant_isolation" ON inventory.cycle_counts
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS "tenant_isolation" ON inventory.cycle_count_lines;
CREATE POLICY "tenant_isolation" ON inventory.cycle_count_lines
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS "tenant_isolation" ON inventory.rfid_tags;
CREATE POLICY "tenant_isolation" ON inventory.rfid_tags
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS "tenant_isolation" ON inventory.rfid_devices;
CREATE POLICY "tenant_isolation" ON inventory.rfid_devices
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid);

-- Supply Chain schema
DROP POLICY IF EXISTS "tenant_isolation" ON supply_chain.vendors;
CREATE POLICY "tenant_isolation" ON supply_chain.vendors
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS "tenant_isolation" ON supply_chain.purchase_orders;
CREATE POLICY "tenant_isolation" ON supply_chain.purchase_orders
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS "tenant_isolation" ON supply_chain.purchase_order_lines;
CREATE POLICY "tenant_isolation" ON supply_chain.purchase_order_lines
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS "tenant_isolation" ON supply_chain.receipts;
CREATE POLICY "tenant_isolation" ON supply_chain.receipts
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS "tenant_isolation" ON supply_chain.receipt_lines;
CREATE POLICY "tenant_isolation" ON supply_chain.receipt_lines
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid);

-- Public schema
DROP POLICY IF EXISTS "tenant_isolation" ON public.tenants;
CREATE POLICY "tenant_isolation" ON public.tenants
  FOR ALL
  USING (id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS "user_tenant_access" ON public.tenant_memberships;
CREATE POLICY "user_tenant_access" ON public.tenant_memberships
  FOR ALL
  USING (
    user_id = (auth.jwt() ->> 'sub')::uuid
    OR tenant_id = (auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid
  );

-- Grant necessary permissions to authenticated users
GRANT USAGE ON SCHEMA inventory TO authenticated;
GRANT USAGE ON SCHEMA supply_chain TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inventory TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA supply_chain TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tenants TO authenticated;
GRANT SELECT ON public.tenant_memberships TO authenticated;

-- Verification query
-- This should show all tables with RLS enabled and tenant policies
SELECT 
  schemaname,
  tablename,
  COUNT(policyname) AS policy_count
FROM pg_policies
WHERE schemaname IN ('inventory', 'supply_chain', 'public')
  AND policyname LIKE '%tenant%'
GROUP BY schemaname, tablename
ORDER BY schemaname, tablename;
