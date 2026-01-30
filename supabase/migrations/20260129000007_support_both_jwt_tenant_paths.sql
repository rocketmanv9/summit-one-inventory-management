/**
 * FIX: Support both JWT tenant_id paths for compatibility
 * 
 * PROBLEM: Previous migration assumed tenant_id is in app_metadata
 * But the original Supabase project might have tenant_id at JWT root
 * 
 * SOLUTION: Update RLS policies to check BOTH paths:
 * - First try app_metadata.tenant_id (new Supabase projects)
 * - Fall back to root tenant_id (existing projects)
 */

-- Fix the auto_inject_tenant_id function to handle both paths
CREATE OR REPLACE FUNCTION inventory.auto_inject_tenant_id()
RETURNS TRIGGER AS $$
DECLARE
  jwt_tenant_id uuid;
BEGIN
  -- Try app_metadata first (new Supabase projects)
  jwt_tenant_id := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;
  
  -- Fall back to root tenant_id (existing projects)
  IF jwt_tenant_id IS NULL THEN
    jwt_tenant_id := (auth.jwt() ->> 'tenant_id')::uuid;
  END IF;
  
  -- If still no JWT (service role), require explicit tenant_id
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

-- Update all RLS policies to support BOTH JWT paths
-- catalog_items
DROP POLICY IF EXISTS catalog_items_tenant_isolation ON inventory.catalog_items;
CREATE POLICY catalog_items_tenant_isolation ON inventory.catalog_items
  USING (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

-- assets  
DROP POLICY IF EXISTS assets_tenant_isolation ON inventory.assets;
CREATE POLICY assets_tenant_isolation ON inventory.assets
  USING (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

-- stock_balances
DROP POLICY IF EXISTS stock_balances_tenant_isolation ON inventory.stock_balances;
CREATE POLICY stock_balances_tenant_isolation ON inventory.stock_balances
  USING (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

-- transfers
DROP POLICY IF EXISTS transfers_tenant_isolation ON inventory.transfers;
CREATE POLICY transfers_tenant_isolation ON inventory.transfers
  USING (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

-- reservations
DROP POLICY IF EXISTS reservations_tenant_isolation ON inventory.reservations;
CREATE POLICY reservations_tenant_isolation ON inventory.reservations
  USING (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

-- cycle_counts
DROP POLICY IF EXISTS cycle_counts_tenant_isolation ON inventory.cycle_counts;
CREATE POLICY cycle_counts_tenant_isolation ON inventory.cycle_counts
  USING (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

-- locations
DROP POLICY IF EXISTS locations_tenant_isolation ON inventory.locations;
CREATE POLICY locations_tenant_isolation ON inventory.locations
  USING (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

-- rfid_devices
DROP POLICY IF EXISTS rfid_devices_tenant_isolation ON inventory.rfid_devices;
CREATE POLICY rfid_devices_tenant_isolation ON inventory.rfid_devices
  USING (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

-- rfid_tags
DROP POLICY IF EXISTS rfid_tags_tenant_isolation ON inventory.rfid_tags;
CREATE POLICY rfid_tags_tenant_isolation ON inventory.rfid_tags
  USING (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

COMMENT ON FUNCTION inventory.auto_inject_tenant_id() IS 
  'SECURITY: Auto-injects tenant_id from JWT on INSERT (supports both app_metadata and root paths). Prevents cross-tenant data insertion.';
