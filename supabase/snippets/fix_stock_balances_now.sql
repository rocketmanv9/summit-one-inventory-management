-- Quick fix for stock balances
-- Run this if the migration hasn't applied yet

-- 1. Check current state
SELECT 
    'stock_movements' as table_name, 
    COUNT(*) as count,
    SUM(quantity_delta) as total_delta
FROM inventory.stock_movements
UNION ALL
SELECT 
    'stock_balances' as table_name,
    COUNT(*) as count,
    SUM(qty_on_hand) as total_qty
FROM inventory.stock_balances;

-- 2. Create the trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION inventory.maintain_stock_balances()
RETURNS TRIGGER AS $$
BEGIN
    -- Upsert stock_balances for this item/location combination
    INSERT INTO inventory.stock_balances (
        tenant_id,
        catalog_item_id,
        location_id,
        qty_on_hand
    ) VALUES (
        NEW.tenant_id,
        NEW.catalog_item_id,
        NEW.location_id,
        NEW.quantity_delta
    )
    ON CONFLICT (tenant_id, catalog_item_id, location_id)
    DO UPDATE SET
        qty_on_hand = inventory.stock_balances.qty_on_hand + NEW.quantity_delta,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create the trigger
DROP TRIGGER IF EXISTS trigger_maintain_stock_balances ON inventory.stock_movements;
CREATE TRIGGER trigger_maintain_stock_balances
    AFTER INSERT ON inventory.stock_movements
    FOR EACH ROW
    EXECUTE FUNCTION inventory.maintain_stock_balances();

-- 4. Rebuild stock_balances from existing movements
TRUNCATE inventory.stock_balances;

INSERT INTO inventory.stock_balances (
    tenant_id,
    catalog_item_id,
    location_id,
    qty_on_hand,
    qty_reserved
)
SELECT
    sm.tenant_id,
    sm.catalog_item_id,
    sm.location_id,
    SUM(sm.quantity_delta) as qty_on_hand,
    0 as qty_reserved
FROM inventory.stock_movements sm
GROUP BY sm.tenant_id, sm.catalog_item_id, sm.location_id
HAVING SUM(sm.quantity_delta) != 0;

-- 5. Update reserved quantities from active reservations
UPDATE inventory.stock_balances sb
SET qty_reserved = COALESCE(res.total_reserved, 0)
FROM (
    SELECT
        tenant_id,
        catalog_item_id,
        location_id,
        SUM(qty) as total_reserved
    FROM inventory.reservations
    WHERE status = 'active'
    GROUP BY tenant_id, catalog_item_id, location_id
) res
WHERE sb.tenant_id = res.tenant_id
  AND sb.catalog_item_id = res.catalog_item_id
  AND sb.location_id = res.location_id;

-- 6. Verify the results
SELECT 
    ci.sku,
    ci.name as item_name,
    l.name as location_name,
    sb.qty_on_hand,
    sb.qty_reserved,
    sb.qty_available
FROM inventory.stock_balances sb
JOIN inventory.catalog_items ci ON sb.catalog_item_id = ci.id
JOIN inventory.locations l ON sb.location_id = l.id
ORDER BY sb.qty_on_hand DESC
LIMIT 10;
