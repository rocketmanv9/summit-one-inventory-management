-- Fix stock_balances trigger to handle negative quantity_deltas correctly
-- Issue: When a stock_balances row doesn't exist and we try to deduct stock,
-- the INSERT tries to set qty_on_hand = negative value, violating check constraint

CREATE OR REPLACE FUNCTION inventory.maintain_stock_balances()
RETURNS TRIGGER AS $$
BEGIN
    -- Upsert stock_balances for this item/location combination
    -- On INSERT: Initialize with 0 and add delta
    -- On UPDATE: Add delta to existing qty_on_hand
    INSERT INTO inventory.stock_balances (
        tenant_id,
        catalog_item_id,
        location_id,
        qty_on_hand
    ) VALUES (
        NEW.tenant_id,
        NEW.catalog_item_id,
        NEW.location_id,
        GREATEST(0, NEW.quantity_delta) -- Initialize to 0 if delta is negative
    )
    ON CONFLICT (tenant_id, catalog_item_id, location_id)
    DO UPDATE SET
        qty_on_hand = inventory.stock_balances.qty_on_hand + NEW.quantity_delta,
        updated_at = NOW();
    
    -- If this would result in negative qty_on_hand after the upsert, raise error
    IF (SELECT qty_on_hand FROM inventory.stock_balances 
        WHERE tenant_id = NEW.tenant_id 
        AND catalog_item_id = NEW.catalog_item_id 
        AND location_id = NEW.location_id) < 0 THEN
        RAISE EXCEPTION 'Insufficient stock: Cannot deduct % units from location. This would result in negative inventory.', 
            ABS(NEW.quantity_delta);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION inventory.maintain_stock_balances IS 
    'Automatically maintains stock_balances read model when stock_movements are inserted. Prevents negative inventory.';
