-- Seed Production Database with Test Tenant
-- Run this once to create a test tenant in production

BEGIN;

-- 1. Create test tenant
INSERT INTO public.tenants (id, name, slug, industry, metadata)
VALUES (
    'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd'::uuid,
    'Summit One Demo',
    'summit-one-demo',
    'construction',
    '{}'::jsonb
)
ON CONFLICT (id) DO UPDATE
SET 
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    updated_at = NOW();

-- 2. Create sample locations
INSERT INTO inventory.locations (tenant_id, name, location_type, is_active)
VALUES
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Main Warehouse', 'warehouse', true),
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Yard A', 'yard', true),
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Field Office', 'office', true)
ON CONFLICT DO NOTHING;

-- 3. Create sample catalog items  
INSERT INTO inventory.catalog_items (tenant_id, name, sku, uom, tracking_mode, reorder_point, is_active)
VALUES
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Hot Mix Asphalt (HMA)', 'HMA-001', 'TON', 'stock', 50, true),
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Ready-Mix Concrete 3000 PSI', 'RMC-3000', 'YD3', 'stock', 25, true),
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Rebar #4', 'REB-4', 'EA', 'stock', 100, true),
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Diesel Fuel', 'FUEL-DSL', 'GAL', 'stock', 500, true)
ON CONFLICT DO NOTHING;

-- 4. Create initial stock balances
INSERT INTO inventory.stock_balances (tenant_id, catalog_item_id, location_id, qty_on_hand, qty_reserved, qty_available)
SELECT 
    ci.tenant_id,
    ci.id,
    l.id,
    0, -- starting with zero, user can receive inventory
    0,
    0
FROM inventory.catalog_items ci
CROSS JOIN inventory.locations l
WHERE ci.tenant_id = 'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd'
  AND l.tenant_id = 'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd'
ON CONFLICT DO NOTHING;

COMMIT;

-- Verify
SELECT 'Tenant created:' as status, COUNT(*) as count FROM public.tenants WHERE id = 'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd';
SELECT 'Locations created:' as status, COUNT(*) as count FROM inventory.locations WHERE tenant_id = 'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd';
SELECT 'Items created:' as status, COUNT(*) as count FROM inventory.catalog_items WHERE tenant_id = 'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd';
SELECT 'Stock balances created:' as status, COUNT(*) as count FROM inventory.stock_balances WHERE tenant_id = 'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd';
