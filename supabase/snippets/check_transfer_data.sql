-- Check if locations exist
SELECT 'Locations' as table_name, count(*) as count 
FROM inventory.locations 
WHERE tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48' AND active = true;

-- List all locations
SELECT id, name, active
FROM inventory.locations 
WHERE tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'
ORDER BY name;

-- Check if catalog items exist  
SELECT 'Catalog Items' as table_name, count(*) as count
FROM inventory.catalog_items 
WHERE tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48' AND deleted_at IS NULL;

-- List all catalog items
SELECT id, sku, name, unit_of_measure
FROM inventory.catalog_items 
WHERE tenant_id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48' AND deleted_at IS NULL
ORDER BY name;
