-- Seed Initial Tenant and Sample Data for Development
-- Run this to set up your first tenant and sample inventory data

DO $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
BEGIN
  -- Check if we already have a tenant
  SELECT id INTO v_tenant_id FROM public.tenants LIMIT 1;
  
  IF v_tenant_id IS NULL THEN
    -- Create default tenant
    INSERT INTO public.tenants (
      id,
      name,
      slug,
      industry
    ) VALUES (
      gen_random_uuid(),
      'Summit One Demo',
      'summit-one-demo',
      'construction'
    ) RETURNING id INTO v_tenant_id;
    
    RAISE NOTICE '✓ Created tenant: % (ID: %)', 'Summit One Demo', v_tenant_id;
  ELSE
    RAISE NOTICE '✓ Tenant already exists (ID: %)', v_tenant_id;
  END IF;

  -- Check if we have any auth users
  SELECT id INTO v_user_id FROM auth.users LIMIT 1;
  
  IF v_user_id IS NULL THEN
    RAISE NOTICE '⚠ No auth users found. Please create a user via Supabase Auth.';
    RAISE NOTICE 'You can use the dev-login page or create one manually.';
  ELSE
    RAISE NOTICE '✓ Auth user exists (ID: %)', v_user_id;
  END IF;

  -- Create some sample locations if none exist
  IF NOT EXISTS (SELECT 1 FROM inventory.locations WHERE tenant_id = v_tenant_id) THEN
    INSERT INTO inventory.locations (tenant_id, name, location_type, active) VALUES
      (v_tenant_id, 'Main Warehouse', 'warehouse', true),
      (v_tenant_id, 'Yard A', 'yard', true),
      (v_tenant_id, 'Truck 101', 'truck', true);
    
    RAISE NOTICE '✓ Created 3 sample locations';
  END IF;

  -- Create some sample catalog items if none exist
  IF NOT EXISTS (SELECT 1 FROM inventory.catalog_items WHERE tenant_id = v_tenant_id) THEN
    INSERT INTO inventory.catalog_items (
      tenant_id, 
      name, 
      sku, 
      unit_of_measure, 
      tracking_mode, 
      reorder_point,
      active
    ) VALUES
      (v_tenant_id, 'Hot Mix Asphalt (HMA)', 'HMA-001', 'TON', 'stock', 50, true),
      (v_tenant_id, 'Ready-Mix Concrete 3000 PSI', 'RMC-3000', 'YD3', 'stock', 25, true),
      (v_tenant_id, 'Rebar #4', 'REB-4', 'EA', 'stock', 100, true),
      (v_tenant_id, 'Diesel Fuel', 'FUEL-DSL', 'GAL', 'stock', 500, true),
      (v_tenant_id, 'Excavator CAT 320', 'EXC-320-001', 'EA', 'serialized', 0, true);
    
    RAISE NOTICE '✓ Created 5 sample catalog items';
  END IF;

  -- Create a sample vendor if none exist
  IF NOT EXISTS (SELECT 1 FROM supply_chain.vendors WHERE tenant_id = v_tenant_id) THEN
    INSERT INTO supply_chain.vendors (
      tenant_id,
      name,
      code,
      active
    ) VALUES
      (v_tenant_id, 'ABC Materials Supply', 'ABC-MAT', true),
      (v_tenant_id, 'XYZ Equipment Rental', 'XYZ-EQP', true);
    
    RAISE NOTICE '✓ Created 2 sample vendors';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ SETUP COMPLETE!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Tenant ID: %', v_tenant_id;
  RAISE NOTICE 'User ID: %', v_user_id;
  RAISE NOTICE '';
  RAISE NOTICE 'You can now:';
  RAISE NOTICE '1. Login with email: admin@example.com';
  RAISE NOTICE '2. View catalog items at /inventory/items';
  RAISE NOTICE '3. Check stock at /inventory/stock';
  RAISE NOTICE '4. Create receipts at /operations/receive/create';
  RAISE NOTICE '';

END $$;

-- Verify setup
SELECT '========================================' as info;
SELECT '📊 DATABASE SETUP SUMMARY' as info;
SELECT '========================================' as info;

SELECT 
  'Tenants' as table_name,
  COUNT(*)::TEXT as count 
FROM public.tenants
UNION ALL
SELECT 'Auth Users', COUNT(*)::TEXT FROM auth.users
UNION ALL
SELECT 'Locations', COUNT(*)::TEXT FROM inventory.locations
UNION ALL
SELECT 'Catalog Items', COUNT(*)::TEXT FROM inventory.catalog_items
UNION ALL
SELECT 'Vendors', COUNT(*)::TEXT FROM supply_chain.vendors;

SELECT '' as info;
SELECT '✅ Setup complete! Tenant ID for JWT: ' || id::TEXT as info
FROM public.tenants LIMIT 1;
