-- Quick seed for Grant's tenant
-- Run: Get-Content seed_grant_quick.sql | docker exec -i supabase_db_summit-one-inventory-management psql -U postgres -d postgres

\set tenant_id 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
\set user_id 'ee14467b-409d-4648-af5e-3d16a9dd5541'

-- Location types (using existing schema)
INSERT INTO inventory.location_types (tenant_id, code, name, created_by_user_id, updated_by_user_id)
VALUES 
    (:'tenant_id', 'warehouse', 'Warehouse', :'user_id', :'user_id'),
    (:'tenant_id', 'store', 'Retail Store', :'user_id', :'user_id'),
    (:'tenant_id', 'truck', 'Service Vehicle', :'user_id', :'user_id')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Locations
WITH lt AS (SELECT id, code FROM inventory.location_types WHERE tenant_id = :'tenant_id')
INSERT INTO inventory.locations (tenant_id, name, location_type_id, address, created_by, updated_by)
SELECT :'tenant_id', v.name, lt.id, v.address, :'user_id', :'user_id'
FROM (VALUES
    ('Main Warehouse', 'warehouse', '123 Industrial Pkwy'),
    ('Downtown Store', 'store', '456 Main St'),
    ('Truck #1', 'truck', NULL)
) AS v(name, code, address)
JOIN lt ON lt.code = v.code
ON CONFLICT DO NOTHING;

-- Categories
INSERT INTO inventory.item_categories (tenant_id, name, created_by, updated_by)
VALUES 
    (:'tenant_id', 'Asphalt', :'user_id', :'user_id'),
    (:'tenant_id', 'Concrete', :'user_id', :'user_id'),
    (:'tenant_id', 'Aggregates', :'user_id', :'user_id'),
    (:'tenant_id', 'Tools', :'user_id', :'user_id'),
    (:'tenant_id', 'Safety', :'user_id', :'user_id')
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Catalog items (minimal - just SKU and name)
WITH cat AS (SELECT id, name FROM inventory.item_categories WHERE tenant_id = :'tenant_id')
INSERT INTO inventory.catalog_items (tenant_id, sku, name, category_id, unit_of_measure, tracking_mode, created_by, updated_by)
SELECT :'tenant_id', v.sku, v.name, cat.id, v.uom, 'stock', :'user_id', :'user_id'
FROM (VALUES
    ('ASPH-001', 'Hot Mix Asphalt', 'Asphalt', 'TON'),
    ('CONC-001', 'Ready Mix 3000PSI', 'Concrete', 'YD3'),
    ('AGG-001', 'Masonry Sand', 'Aggregates', 'TON'),
    ('TOOL-001', 'Asphalt Rake', 'Tools', 'EA'),
    ('SAFE-001', 'Safety Vest', 'Safety', 'EA')
) AS v(sku, name, cat_name, uom)
JOIN cat ON cat.name = v.cat_name
ON CONFLICT (tenant_id, sku) DO NOTHING;

-- Stock balances (no created_by/updated_by)
WITH items AS (SELECT id, sku FROM inventory.catalog_items WHERE tenant_id = :'tenant_id'),
     locs AS (SELECT id, name FROM inventory.locations WHERE tenant_id = :'tenant_id')
INSERT INTO inventory.stock_balances (tenant_id, catalog_item_id, location_id, qty_on_hand, qty_reserved)
SELECT :'tenant_id', items.id, locs.id, v.qty::numeric, 0
FROM (VALUES
    ('ASPH-001', 'Main Warehouse', 150),
    ('CONC-001', 'Main Warehouse', 30),
    ('AGG-001', 'Main Warehouse', 80),
    ('TOOL-001', 'Main Warehouse', 8),
    ('SAFE-001', 'Main Warehouse', 45)
) AS v(sku, loc_name, qty)
JOIN items ON items.sku = v.sku
JOIN locs ON locs.name = v.loc_name
ON CONFLICT (tenant_id, catalog_item_id, location_id) DO UPDATE
SET qty_on_hand = EXCLUDED.qty_on_hand;

-- Assignment types
INSERT INTO inventory.assignment_types (tenant_id, type_key, display_name, requires_id, sort_order)
VALUES 
    (:'tenant_id', 'job_site', 'Job Site', true, 10),
    (:'tenant_id', 'employee', 'Employee', true, 20),
    (:'tenant_id', 'consumed', 'Consumed', false, 30)
ON CONFLICT (tenant_id, type_key) DO NOTHING;

-- Dashboard (tenant scope - visible to all in tenant)
INSERT INTO public.dashboards (tenant_id, name, description, is_default, created_by, scope)
VALUES (:'tenant_id', 'Inventory Overview', 'Main dashboard', true, :'user_id', 'tenant')
ON CONFLICT DO NOTHING;

SELECT '✅ Data seeded for tenant: ae837809' as result;
