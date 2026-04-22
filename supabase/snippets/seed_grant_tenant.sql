-- Seed data for Grant's tenant (ae837809-1a24-4ab5-ba06-34fd98c05f48)
-- Run this to populate local development database

-- Variables
\set tenant_id 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
\set user_id 'ee14467b-409d-4648-af5e-3d16a9dd5541'

-- =====================================================
-- 1. LOCATION TYPES
-- =====================================================
INSERT INTO inventory.location_types (tenant_id, type_name, icon, created_by, updated_by)
VALUES 
    (:'tenant_id', 'Warehouse', 'warehouse', :'user_id', :'user_id'),
    (:'tenant_id', 'Retail Store', 'store', :'user_id', :'user_id'),
    (:'tenant_id', 'Service Vehicle', 'truck', :'user_id', :'user_id'),
    (:'tenant_id', 'Office', 'building', :'user_id', :'user_id')
ON CONFLICT (tenant_id, type_name) DO NOTHING;

-- =====================================================
-- 2. LOCATIONS
-- =====================================================
WITH location_type_ids AS (
    SELECT id, type_name FROM inventory.location_types WHERE tenant_id = :'tenant_id'
)
INSERT INTO inventory.locations (tenant_id, name, location_type_id, address, active, created_by, updated_by)
SELECT 
    :'tenant_id',
    v.name,
    lt.id,
    v.address,
    true,
    :'user_id',
    :'user_id'
FROM (VALUES
    ('Main Warehouse', 'Warehouse', '123 Industrial Pkwy, City, ST 12345'),
    ('Downtown Store', 'Retail Store', '456 Main St, City, ST 12345'),
    ('Truck #1', 'Service Vehicle', NULL),
    ('West Office', 'Office', '789 Business Blvd, City, ST 12345')
) AS v(name, type_name, address)
JOIN location_type_ids lt ON lt.type_name = v.type_name
ON CONFLICT DO NOTHING;

-- =====================================================
-- 3. ITEM CATEGORIES
-- =====================================================
INSERT INTO inventory.item_categories (tenant_id, category_name, created_by, updated_by)
VALUES 
    (:'tenant_id', 'Asphalt Materials', :'user_id', :'user_id'),
    (:'tenant_id', 'Concrete Materials', :'user_id', :'user_id'),
    (:'tenant_id', 'Aggregates', :'user_id', :'user_id'),
    (:'tenant_id', 'Tools & Equipment', :'user_id', :'user_id'),
    (:'tenant_id', 'Safety Gear', :'user_id', :'user_id')
ON CONFLICT (tenant_id, category_name) DO NOTHING;

-- =====================================================
-- 4. CATALOG ITEMS
-- =====================================================
WITH categories AS (
    SELECT id, category_name FROM inventory.item_categories WHERE tenant_id = :'tenant_id'
)
INSERT INTO inventory.catalog_items (
    tenant_id, sku, item_name, category_id, 
    unit_of_measure, unit_cost, reorder_point, reorder_quantity,
    created_by, updated_by
)
SELECT 
    :'tenant_id',
    v.sku,
    v.name,
    cat.id,
    v.uom,
    v.cost::numeric,
    v.reorder_point,
    v.reorder_qty,
    :'user_id',
    :'user_id'
FROM (VALUES
    ('ASPH-HOT-001', 'Hot Mix Asphalt Type I', 'Asphalt Materials', 'TON', 85.00, 50, 200),
    ('ASPH-COLD-001', 'Cold Patch Asphalt', 'Asphalt Materials', 'BAG', 12.50, 20, 100),
    ('CONC-RDY-001', 'Ready Mix Concrete 3000PSI', 'Concrete Materials', 'YD3', 125.00, 10, 50),
    ('AGG-SAND-001', 'Masonry Sand', 'Aggregates', 'TON', 25.00, 30, 100),
    ('AGG-GRVL-001', 'Pea Gravel', 'Aggregates', 'TON', 30.00, 20, 80),
    ('TOOL-RAKE-001', 'Asphalt Rake', 'Tools & Equipment', 'EA', 45.00, 5, 10),
    ('SAFE-VEST-001', 'Safety Vest Class 2', 'Safety Gear', 'EA', 8.50, 20, 50),
    ('SAFE-HELM-001', 'Hard Hat White', 'Safety Gear', 'EA', 12.00, 15, 30)
) AS v(sku, name, category, uom, cost, reorder_point, reorder_qty)
JOIN categories cat ON cat.category_name = v.category
ON CONFLICT (tenant_id, sku) DO NOTHING;

-- =====================================================
-- 5. STOCK BALANCES (Initial Inventory)
-- =====================================================
WITH items AS (
    SELECT id, sku FROM inventory.catalog_items WHERE tenant_id = :'tenant_id'
),
locs AS (
    SELECT id, name FROM inventory.locations WHERE tenant_id = :'tenant_id'
)
INSERT INTO inventory.stock_balances (
    tenant_id, catalog_item_id, location_id,
    quantity_on_hand, quantity_available, quantity_reserved,
    last_counted_at, created_by, updated_by
)
SELECT 
    :'tenant_id',
    items.id,
    locs.id,
    v.qty::numeric,
    v.qty::numeric,
    0,
    NOW(),
    :'user_id',
    :'user_id'
FROM (VALUES
    ('ASPH-HOT-001', 'Main Warehouse', 150),
    ('ASPH-COLD-001', 'Main Warehouse', 75),
    ('ASPH-COLD-001', 'Downtown Store', 25),
    ('CONC-RDY-001', 'Main Warehouse', 30),
    ('AGG-SAND-001', 'Main Warehouse', 80),
    ('AGG-GRVL-001', 'Main Warehouse', 60),
    ('TOOL-RAKE-001', 'Main Warehouse', 8),
    ('TOOL-RAKE-001', 'Truck #1', 2),
    ('SAFE-VEST-001', 'Main Warehouse', 45),
    ('SAFE-VEST-001', 'Downtown Store', 10),
    ('SAFE-HELM-001', 'Main Warehouse', 30),
    ('SAFE-HELM-001', 'Downtown Store', 5)
) AS v(sku, location_name, qty)
JOIN items ON items.sku = v.sku
JOIN locs ON locs.name = v.location_name
ON CONFLICT (tenant_id, catalog_item_id, location_id) DO UPDATE
SET 
    quantity_on_hand = EXCLUDED.quantity_on_hand,
    quantity_available = EXCLUDED.quantity_available,
    updated_at = NOW();

-- =====================================================
-- 6. ASSIGNMENT TYPES
-- =====================================================
INSERT INTO inventory.assignment_types (tenant_id, type_name, requires_return, sort_order, created_by, updated_by)
VALUES 
    (:'tenant_id', 'Job Site', true, 10, :'user_id', :'user_id'),
    (:'tenant_id', 'Employee', true, 20, :'user_id', :'user_id'),
    (:'tenant_id', 'Vehicle', true, 30, :'user_id', :'user_id'),
    (:'tenant_id', 'Consumed', false, 40, :'user_id', :'user_id'),
    (:'tenant_id', 'Customer Sale', false, 50, :'user_id', :'user_id')
ON CONFLICT (tenant_id, type_name) DO NOTHING;

-- =====================================================
-- 7. DEFAULT DASHBOARD
-- =====================================================
INSERT INTO public.dashboards (tenant_id, name, description, is_default, created_by, scope)
VALUES (
    :'tenant_id',
    'Inventory Overview',
    'Main inventory dashboard with key metrics',
    true,
    :'user_id',
    'user'
)
ON CONFLICT DO NOTHING;

-- =====================================================
-- SUMMARY
-- =====================================================
SELECT '✓ Seed data created for tenant: ' || :'tenant_id' as status;
SELECT 'Location Types: ' || COUNT(*)::text FROM inventory.location_types WHERE tenant_id = :'tenant_id';
SELECT 'Locations: ' || COUNT(*)::text FROM inventory.locations WHERE tenant_id = :'tenant_id';
SELECT 'Categories: ' || COUNT(*)::text FROM inventory.item_categories WHERE tenant_id = :'tenant_id';
SELECT 'Catalog Items: ' || COUNT(*)::text FROM inventory.catalog_items WHERE tenant_id = :'tenant_id';
SELECT 'Stock Balances: ' || COUNT(*)::text FROM inventory.stock_balances WHERE tenant_id = :'tenant_id';
SELECT 'Assignment Types: ' || COUNT(*)::text FROM inventory.assignment_types WHERE tenant_id = :'tenant_id';
SELECT 'Dashboards: ' || COUNT(*)::text FROM public.dashboards WHERE tenant_id = :'tenant_id';
