/**
 * CRITICAL FIX: Correct JWT tenant_id extraction in RLS policies
 * 
 * PROBLEM: RLS policies are extracting tenant_id directly from JWT root
 * But Supabase stores custom claims in app_metadata
 * 
 * This causes RLS policies to always return NULL for tenant_id comparison
 * Making all SELECT/INSERT/UPDATE/DELETE operations fail with 500 errors
 * 
 * SOLUTION: Update all RLS policies and trigger to use correct JWT path:
 * (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
 */

-- Fix the auto_inject_tenant_id function
CREATE OR REPLACE FUNCTION inventory.auto_inject_tenant_id()
RETURNS TRIGGER AS $$
DECLARE
  jwt_tenant_id uuid;
BEGIN
  -- Extract tenant_id from JWT app_metadata (correct path)
  jwt_tenant_id := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;
  
  -- If no JWT (service role), require explicit tenant_id
  IF jwt_tenant_id IS NULL THEN
    IF NEW.tenant_id IS NULL THEN
      RAISE EXCEPTION 'tenant_id is required when using service role';
    END IF;
    -- Service role: use provided tenant_id
    RETURN NEW;
  END IF;
  
  -- User JWT exists: enforce JWT tenant_id, ignore any provided value
  IF NEW.tenant_id IS NOT NULL AND NEW.tenant_id != jwt_tenant_id THEN
    RAISE WARNING 'Attempted to insert with tenant_id=% but JWT has tenant_id=%. Using JWT value.', 
      NEW.tenant_id, jwt_tenant_id;
  END IF;
  
  -- Always use JWT tenant_id when JWT is present
  NEW.tenant_id := jwt_tenant_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix all RLS policies to use correct JWT path
-- catalog_items
DROP POLICY IF EXISTS catalog_items_tenant_isolation ON inventory.catalog_items;
CREATE POLICY catalog_items_tenant_isolation ON inventory.catalog_items
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- assets  
DROP POLICY IF EXISTS assets_tenant_isolation ON inventory.assets;
CREATE POLICY assets_tenant_isolation ON inventory.assets
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- stock_balances
DROP POLICY IF EXISTS stock_balances_tenant_isolation ON inventory.stock_balances;
CREATE POLICY stock_balances_tenant_isolation ON inventory.stock_balances
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- transfers
DROP POLICY IF EXISTS transfers_tenant_isolation ON inventory.transfers;
CREATE POLICY transfers_tenant_isolation ON inventory.transfers
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- reservations
DROP POLICY IF EXISTS reservations_tenant_isolation ON inventory.reservations;
CREATE POLICY reservations_tenant_isolation ON inventory.reservations
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- cycle_counts
DROP POLICY IF EXISTS cycle_counts_tenant_isolation ON inventory.cycle_counts;
CREATE POLICY cycle_counts_tenant_isolation ON inventory.cycle_counts
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- locations
DROP POLICY IF EXISTS locations_tenant_isolation ON inventory.locations;
CREATE POLICY locations_tenant_isolation ON inventory.locations
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- rfid_devices
DROP POLICY IF EXISTS rfid_devices_tenant_isolation ON inventory.rfid_devices;
CREATE POLICY rfid_devices_tenant_isolation ON inventory.rfid_devices
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- rfid_tags
DROP POLICY IF EXISTS rfid_tags_tenant_isolation ON inventory.rfid_tags;
CREATE POLICY rfid_tags_tenant_isolation ON inventory.rfid_tags
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- supply_chain schema tables (only if they exist)
-- vendors (actually vendor_items)
DO $$ BEGIN
  DROP POLICY IF EXISTS vendor_items_tenant_isolation ON supply_chain.vendor_items;
  CREATE POLICY vendor_items_tenant_isolation ON supply_chain.vendor_items
    USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
    WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
EXCEPTION WHEN undefined_table THEN
  -- Table doesn't exist, skip
END $$;

-- purchase_orders
DO $$ BEGIN
  DROP POLICY IF EXISTS purchase_orders_tenant_isolation ON supply_chain.purchase_orders;
  CREATE POLICY purchase_orders_tenant_isolation ON supply_chain.purchase_orders
    USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
    WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
EXCEPTION WHEN undefined_table THEN
  -- Table doesn't exist, skip
END $$;

-- purchase_order_lines
DO $$ BEGIN
  DROP POLICY IF EXISTS purchase_order_lines_tenant_isolation ON supply_chain.purchase_order_lines;
  CREATE POLICY purchase_order_lines_tenant_isolation ON supply_chain.purchase_order_lines
    USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
    WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
EXCEPTION WHEN undefined_table THEN
  -- Table doesn't exist, skip
END $$;

-- receiving_lines
DO $$ BEGIN
  DROP POLICY IF EXISTS receiving_lines_tenant_isolation ON supply_chain.receiving_lines;
  CREATE POLICY receiving_lines_tenant_isolation ON supply_chain.receiving_lines
    USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
    WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
EXCEPTION WHEN undefined_table THEN
  -- Table doesn't exist, skip
END $$;

COMMENT ON FUNCTION inventory.auto_inject_tenant_id() IS 
  'SECURITY: Auto-injects tenant_id from JWT app_metadata on INSERT. Prevents cross-tenant data insertion.';
