-- ============================================================================
-- Fix Stock Balances Read Model
-- ============================================================================
-- Date: 2026-01-20
-- Purpose: Create missing triggers to maintain stock_balances from stock_movements
-- Issue: stock_balances table exists but is never populated/updated
-- ============================================================================

-- ============================================================================
-- PART 1: Create Trigger to Update Stock Balances on Movement
-- ============================================================================

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

COMMENT ON FUNCTION inventory.maintain_stock_balances IS 
    'Automatically maintains stock_balances read model when stock_movements are inserted';

-- Create the trigger
DROP TRIGGER IF EXISTS trigger_maintain_stock_balances ON inventory.stock_movements;
CREATE TRIGGER trigger_maintain_stock_balances
    AFTER INSERT ON inventory.stock_movements
    FOR EACH ROW
    EXECUTE FUNCTION inventory.maintain_stock_balances();

-- ============================================================================
-- PART 2: Create Trigger to Update Reserved Quantity on Reservations
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory.maintain_stock_reserved()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
        -- Increase reserved quantity
        UPDATE inventory.stock_balances
        SET qty_reserved = qty_reserved + NEW.qty,
            updated_at = NOW()
        WHERE tenant_id = NEW.tenant_id
          AND catalog_item_id = NEW.catalog_item_id
          AND location_id = NEW.location_id;
          
        -- Create stock_balances record if it doesn't exist
        INSERT INTO inventory.stock_balances (
            tenant_id,
            catalog_item_id,
            location_id,
            qty_on_hand,
            qty_reserved
        ) VALUES (
            NEW.tenant_id,
            NEW.catalog_item_id,
            NEW.location_id,
            0,
            NEW.qty
        )
        ON CONFLICT (tenant_id, catalog_item_id, location_id) DO NOTHING;
        
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'active' AND NEW.status IN ('fulfilled', 'cancelled') THEN
            -- Decrease reserved quantity
            UPDATE inventory.stock_balances
            SET qty_reserved = GREATEST(0, qty_reserved - OLD.qty),
                updated_at = NOW()
            WHERE tenant_id = OLD.tenant_id
              AND catalog_item_id = OLD.catalog_item_id
              AND location_id = OLD.location_id;
        END IF;
        
    ELSIF TG_OP = 'DELETE' AND OLD.status = 'active' THEN
        -- Decrease reserved quantity on delete
        UPDATE inventory.stock_balances
        SET qty_reserved = GREATEST(0, qty_reserved - OLD.qty),
            updated_at = NOW()
        WHERE tenant_id = OLD.tenant_id
          AND catalog_item_id = OLD.catalog_item_id
          AND location_id = OLD.location_id;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION inventory.maintain_stock_reserved IS 
    'Automatically maintains stock_balances.qty_reserved when reservations change';

-- Create the trigger
DROP TRIGGER IF EXISTS trigger_maintain_stock_reserved ON inventory.reservations;
CREATE TRIGGER trigger_maintain_stock_reserved
    AFTER INSERT OR UPDATE OR DELETE ON inventory.reservations
    FOR EACH ROW
    EXECUTE FUNCTION inventory.maintain_stock_reserved();

-- ============================================================================
-- PART 3: Rebuild Stock Balances from Existing Data
-- ============================================================================

DO $$
DECLARE
    v_movements_count INTEGER;
    v_balances_before INTEGER;
    v_balances_after INTEGER;
    v_reservations_count INTEGER;
BEGIN
    -- Count existing data
    SELECT COUNT(*) INTO v_movements_count FROM inventory.stock_movements;
    SELECT COUNT(*) INTO v_balances_before FROM inventory.stock_balances;
    SELECT COUNT(*) INTO v_reservations_count FROM inventory.reservations WHERE status = 'active';
    
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Rebuilding stock_balances from stock_movements...';
    RAISE NOTICE '  Stock movements found: %', v_movements_count;
    RAISE NOTICE '  Stock balances before: %', v_balances_before;
    RAISE NOTICE '  Active reservations: %', v_reservations_count;
    RAISE NOTICE '============================================================================';
    
    -- Clear existing stock_balances (we'll rebuild from movements)
    DELETE FROM inventory.stock_balances;
    
    -- Rebuild qty_on_hand from stock_movements
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
        0 as qty_reserved  -- Will be updated next
    FROM inventory.stock_movements sm
    GROUP BY sm.tenant_id, sm.catalog_item_id, sm.location_id
    ON CONFLICT (tenant_id, catalog_item_id, location_id)
    DO UPDATE SET
        qty_on_hand = EXCLUDED.qty_on_hand,
        updated_at = NOW();
    
    -- Update qty_reserved from active reservations
    UPDATE inventory.stock_balances sb
    SET qty_reserved = COALESCE(res.total_reserved, 0),
        updated_at = NOW()
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
    
    SELECT COUNT(*) INTO v_balances_after FROM inventory.stock_balances;
    
    RAISE NOTICE '============================================================================';
    RAISE NOTICE '✅ Stock balances rebuilt successfully!';
    RAISE NOTICE '  Stock balances after: %', v_balances_after;
    RAISE NOTICE '  Triggers installed:';
    RAISE NOTICE '    - trigger_maintain_stock_balances (on stock_movements)';
    RAISE NOTICE '    - trigger_maintain_stock_reserved (on reservations)';
    RAISE NOTICE '============================================================================';
END $$;

-- ============================================================================
-- PART 4: Verification
-- ============================================================================

-- Verify the triggers were created
DO $$
DECLARE
    v_balance_trigger_count INTEGER;
    v_reserved_trigger_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_balance_trigger_count
    FROM information_schema.triggers
    WHERE trigger_name = 'trigger_maintain_stock_balances'
      AND event_object_schema = 'inventory'
      AND event_object_table = 'stock_movements';
    
    SELECT COUNT(*) INTO v_reserved_trigger_count
    FROM information_schema.triggers
    WHERE trigger_name = 'trigger_maintain_stock_reserved'
      AND event_object_schema = 'inventory'
      AND event_object_table = 'reservations';
    
    IF v_balance_trigger_count > 0 AND v_reserved_trigger_count > 0 THEN
        RAISE NOTICE '✅ All stock balance maintenance triggers verified';
    ELSE
        RAISE WARNING 'Trigger verification failed: balance_trigger=%, reserved_trigger=%', 
            v_balance_trigger_count, v_reserved_trigger_count;
    END IF;
END $$;

-- Display sample stock balances to verify data
DO $$
DECLARE
    v_sample RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Sample Stock Balances (first 5 records):';
    RAISE NOTICE '============================================================================';
    
    FOR v_sample IN (
        SELECT 
            sb.id,
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
        LIMIT 5
    )
    LOOP
        RAISE NOTICE '  % | % | On Hand: % | Reserved: % | Available: %',
            v_sample.sku,
            v_sample.location_name,
            v_sample.qty_on_hand,
            v_sample.qty_reserved,
            v_sample.qty_available;
    END LOOP;
    
    RAISE NOTICE '============================================================================';
END $$;
