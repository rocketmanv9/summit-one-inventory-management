-- Create Tenant and Sample Data
-- This script creates everything needed for development

-- 1. Create Tenant
INSERT INTO public.tenants (id, name, slug, industry)
VALUES (
  'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd',
  'Summit One Demo',
  'summit-one-demo',
  'construction'
)
ON CONFLICT (id) DO NOTHING;

-- 2. Create Locations
INSERT INTO inventory.locations (tenant_id, name, location_type, active)
VALUES
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Main Warehouse', 'warehouse', true),
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Yard A', 'yard', true),
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Truck 101', 'truck', true)
ON CONFLICT DO NOTHING;

-- 3. Create Catalog Items
INSERT INTO inventory.catalog_items (tenant_id, name, sku, uom, tracking_mode, reorder_point, active)
VALUES
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Hot Mix Asphalt (HMA)', 'HMA-001', 'TON', 'stock', 50, true),
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Ready-Mix Concrete 3000 PSI', 'RMC-3000', 'YD3', 'stock', 25, true),
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Rebar #4', 'REB-4', 'EA', 'stock', 100, true),
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Diesel Fuel', 'FUEL-DSL', 'GAL', 'stock', 500, true),
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Excavator CAT 320', 'EXC-320-001', 'EA', 'serialized', 0, true)
ON CONFLICT DO NOTHING;

-- 4. Create Vendors
INSERT INTO supply_chain.vendors (tenant_id, name, code, active)
VALUES
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'ABC Materials Supply', 'ABC-MAT', true),
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'XYZ Equipment Rental', 'XYZ-EQP', true)
ON CONFLICT DO NOTHING;

-- Show results
SELECT '✅ SETUP COMPLETE!' as status;
SELECT '' as spacer;
SELECT 'Tenant:' as type, name, id::TEXT FROM public.tenants LIMIT 1;
SELECT 'Locations:' as type, COUNT(*)::TEXT as count, '' as id FROM inventory.locations WHERE tenant_id = 'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd';
SELECT 'Items:' as type, COUNT(*)::TEXT as count, '' as id FROM inventory.catalog_items WHERE tenant_id = 'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd';
SELECT 'Vendors:' as type, COUNT(*)::TEXT as count, '' as id FROM supply_chain.vendors WHERE tenant_id = 'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd';

SELECT '' as spacer;
SELECT '🔑 NEXT STEP: Go to http://localhost:3000/dev-login and use tenant_id:' as instruction;
SELECT 'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd' as tenant_id;
