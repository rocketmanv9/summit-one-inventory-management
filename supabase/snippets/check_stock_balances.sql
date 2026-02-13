-- Check stock balances data
SELECT 
    COUNT(*) as total_records,
    COUNT(DISTINCT catalog_item_id) as unique_items,
    COUNT(DISTINCT location_id) as unique_locations,
    SUM(CASE WHEN qty_on_hand > 0 THEN 1 ELSE 0 END) as records_with_qty,
    SUM(CASE WHEN qty_on_hand = 0 THEN 1 ELSE 0 END) as records_with_zero_qty
FROM inventory.stock_balances;

-- Check sample records
SELECT 
    sb.id,
    sb.catalog_item_id,
    sb.location_id,
    sb.qty_on_hand,
    sb.qty_reserved,
    sb.qty_available,
    ci.name as item_name,
    ci.sku as item_sku,
    l.name as location_name
FROM inventory.stock_balances sb
LEFT JOIN inventory.catalog_items ci ON sb.catalog_item_id = ci.id
LEFT JOIN inventory.locations l ON sb.location_id = l.id
LIMIT 20;

-- Check for NULL join issues
SELECT 
    COUNT(*) as records_with_missing_item
FROM inventory.stock_balances sb
LEFT JOIN inventory.catalog_items ci ON sb.catalog_item_id = ci.id
WHERE ci.id IS NULL;

SELECT 
    COUNT(*) as records_with_missing_location
FROM inventory.stock_balances sb
LEFT JOIN inventory.locations l ON sb.location_id = l.id
WHERE l.id IS NULL;

-- Check catalog_items table
SELECT COUNT(*), MIN(name), MAX(name) FROM inventory.catalog_items;

-- Check locations table  
SELECT COUNT(*), MIN(name), MAX(name) FROM inventory.locations;
