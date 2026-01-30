-- Seed basic test data for transfers testing
DO $$
DECLARE
  v_tenant_id UUID := 'ae837809-1a24-4ab5-ba06-34fd98c05f48';
  v_warehouse_type_id UUID;
  v_store_type_id UUID;
  v_asphalt_id UUID;
  v_concrete_id UUID;
  v_sand_id UUID;
BEGIN
  -- Get or create location types
  SELECT id INTO v_warehouse_type_id 
  FROM inventory.location_types 
  WHERE tenant_id = v_tenant_id AND name = 'Warehouse' LIMIT 1;
  
  IF v_warehouse_type_id IS NULL THEN
    INSERT INTO inventory.location_types (tenant_id, name, code, description)
    VALUES (v_tenant_id, 'Warehouse', 'warehouse', 'Warehouse location')
    RETURNING id INTO v_warehouse_type_id;
  END IF;
  
  SELECT id INTO v_store_type_id 
  FROM inventory.location_types 
  WHERE tenant_id = v_tenant_id AND name = 'Store' LIMIT 1;
  
  IF v_store_type_id IS NULL THEN
    INSERT INTO inventory.location_types (tenant_id, name, code, description)
    VALUES (v_tenant_id, 'Store', 'store', 'Store location')
    RETURNING id INTO v_store_type_id;
  END IF;
  
  -- Create locations if they don't exist
  INSERT INTO inventory.locations (tenant_id, name, location_type_id, active)
  VALUES 
    (v_tenant_id, 'Main Warehouse', v_warehouse_type_id, true),
    (v_tenant_id, 'Downtown Store', v_store_type_id, true),
    (v_tenant_id, 'North Yard', v_warehouse_type_id, true)
  ON CONFLICT (tenant_id, name) DO NOTHING;
  
  -- Create catalog items if they don't exist
  INSERT INTO inventory.catalog_items (tenant_id, sku, name, unit_of_measure, tracking_mode)
  VALUES 
    (v_tenant_id, 'ASPH-001', 'Asphalt Mix', 'TON', 'stock'),
    (v_tenant_id, 'CONC-001', 'Concrete Mix', 'TON', 'stock'),
    (v_tenant_id, 'AGG-001', 'Crushed Stone', 'TON', 'stock'),
    (v_tenant_id, 'TOOL-001', 'Rake', 'EA', 'stock'),
    (v_tenant_id, 'SAFE-001', 'Safety Vest', 'EA', 'stock')
  ON CONFLICT (tenant_id, sku) DO NOTHING;
  
  RAISE NOTICE 'Test data seeded successfully!';
END $$;
