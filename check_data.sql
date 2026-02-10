-- Quick check to see if we have data
SELECT 'vendors' as table_name, COUNT(*) as count FROM supply_chain.vendors WHERE active = true
UNION ALL
SELECT 'locations', COUNT(*) FROM inventory.locations WHERE active = true
UNION ALL
SELECT 'catalog_items', COUNT(*) FROM inventory.catalog_items WHERE active = true;
