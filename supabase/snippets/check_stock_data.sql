-- Quick diagnostic query
-- Copy and paste this into Supabase SQL Editor

-- Check what's in stock_balances
SELECT 
    'Records in stock_balances' as check_name,
    COUNT(*) as count
FROM inventory.stock_balances
UNION ALL
SELECT 
    'Records with qty > 0',
    COUNT(*)
FROM inventory.stock_balances
WHERE qty_on_hand > 0
UNION ALL
SELECT 
    'Records in stock_movements',
    COUNT(*)
FROM inventory.stock_movements;

-- Sample of actual data
SELECT 
    sb.id,
    sb.qty_on_hand,
    sb.qty_reserved,
    sb.qty_available,
    ci.sku,
    ci.name,
    l.name as location
FROM inventory.stock_balances sb
LEFT JOIN inventory.catalog_items ci ON sb.catalog_item_id = ci.id
LEFT JOIN inventory.locations l ON sb.location_id = l.id
LIMIT 10;
