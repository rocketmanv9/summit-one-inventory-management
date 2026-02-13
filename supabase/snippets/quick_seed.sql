-- Simple Initial Data Setup
-- Creates tenant and sample data

DO $$
DECLARE
  v_tenant_id UUID := 'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd'; -- Use existing tenant
BEGIN
  
  -- Create sample catalog items if needed
  IF (SELECT COUNT(*) FROM inventory.catalog_items WHERE tenant_id = v_tenant_id) < 5 THEN
    DELETE FROM inventory.catalog_items WHERE tenant_id = v_tenant_id;
    
    INSERT INTO inventory.catalog_items (
      tenant_id,
      name,
      sku,
      uom,
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

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ SETUP COMPLETE!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Tenant ID: %', v_tenant_id;
  RAISE NOTICE '';
  RAISE NOTICE '🔑 IMPORTANT: Set this in your JWT or dev login:';
  RAISE NOTICE '   tenant_id: %', v_tenant_id;
  RAISE NOTICE '';

END $$;

-- Show summary
SELECT
  '✓ ' || COUNT(*)::TEXT || ' catalog items' as status
FROM inventory.catalog_items;

SELECT
  '✓ ' || COUNT(*)::TEXT || ' locations' as status
FROM inventory.locations;

SELECT
  '✓ ' || COUNT(*)::TEXT || ' vendors' as status
FROM supply_chain.vendors;
