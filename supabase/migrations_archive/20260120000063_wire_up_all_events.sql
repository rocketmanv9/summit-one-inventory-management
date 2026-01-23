-- ============================================================================
-- WIRE UP ALL EVENTS - Create triggers to actually emit events
-- ============================================================================
-- This migration adds triggers to auto-emit events for all catalog entries
-- ============================================================================

-- ============================================================================
-- CATALOG ITEM EVENT TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory.emit_catalog_item_event()
RETURNS TRIGGER AS $$
DECLARE
    v_event_name TEXT;
    v_payload JSONB;
    v_changes JSONB;
BEGIN
    -- Determine event type
    IF TG_OP = 'INSERT' THEN
        v_event_name := 'inventory.item.created';
        v_payload := jsonb_build_object(
            'item_id', NEW.id,
            'sku', NEW.sku,
            'name', NEW.name,
            'category_id', NEW.category_id,
            'tracking_mode', NEW.tracking_mode,
            'uom', NEW.uom,
            'tenant_id', NEW.tenant_id,
            'created_at', NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        -- Check for deactivation
        IF OLD.active = TRUE AND NEW.active = FALSE THEN
            v_event_name := 'catalog_item.deactivated';
            v_payload := jsonb_build_object(
                'item_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'deactivated_at', NEW.updated_at
            );
        -- Check for reactivation
        ELSIF OLD.active = FALSE AND NEW.active = TRUE THEN
            v_event_name := 'catalog_item.reactivated';
            v_payload := jsonb_build_object(
                'item_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'reactivated_at', NEW.updated_at
            );
        ELSE
            -- Regular update
            v_event_name := 'catalog_item.updated';
            v_changes := jsonb_build_object();
            
            IF OLD.name != NEW.name THEN
                v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', OLD.name, 'new', NEW.name));
            END IF;
            IF OLD.sku != NEW.sku THEN
                v_changes := v_changes || jsonb_build_object('sku', jsonb_build_object('old', OLD.sku, 'new', NEW.sku));
            END IF;
            IF OLD.uom IS DISTINCT FROM NEW.uom THEN
                v_changes := v_changes || jsonb_build_object('uom', jsonb_build_object('old', OLD.uom, 'new', NEW.uom));
            END IF;
            IF OLD.category_id IS DISTINCT FROM NEW.category_id THEN
                v_changes := v_changes || jsonb_build_object('category_id', jsonb_build_object('old', OLD.category_id, 'new', NEW.category_id));
            END IF;
            
            v_payload := jsonb_build_object(
                'item_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'changes', v_changes,
                'updated_at', NEW.updated_at
            );
        END IF;
    END IF;
    
    -- Emit event
    PERFORM public.emit_event(
        v_event_name,
        v_payload,
        NEW.tenant_id
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_catalog_item_events ON inventory.catalog_items;
CREATE TRIGGER trigger_catalog_item_events
    AFTER INSERT OR UPDATE ON inventory.catalog_items
    FOR EACH ROW
    EXECUTE FUNCTION inventory.emit_catalog_item_event();

-- ============================================================================
-- LOCATION EVENT TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory.emit_location_event()
RETURNS TRIGGER AS $$
DECLARE
    v_event_name TEXT;
    v_payload JSONB;
    v_changes JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_name := 'location.created';
        v_payload := jsonb_build_object(
            'location_id', NEW.id,
            'location_type', NEW.location_type,
            'name', NEW.name,
            'parent_location_id', NEW.parent_location_id,
            'external_ref', NEW.external_ref,
            'tenant_id', NEW.tenant_id,
            'created_at', NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        -- Check for deactivation
        IF OLD.active = TRUE AND NEW.active = FALSE THEN
            v_event_name := 'location.deactivated';
            v_payload := jsonb_build_object(
                'location_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'deactivated_at', NEW.updated_at
            );
        ELSE
            -- Regular update
            v_event_name := 'location.updated';
            v_changes := jsonb_build_object();
            
            IF OLD.name != NEW.name THEN
                v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', OLD.name, 'new', NEW.name));
            END IF;
            IF OLD.location_type != NEW.location_type THEN
                v_changes := v_changes || jsonb_build_object('location_type', jsonb_build_object('old', OLD.location_type, 'new', NEW.location_type));
            END IF;
            
            v_payload := jsonb_build_object(
                'location_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'changes', v_changes,
                'updated_at', NEW.updated_at
            );
        END IF;
    END IF;
    
    PERFORM public.emit_event(
        v_event_name,
        v_payload,
        NEW.tenant_id
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_location_events ON inventory.locations;
CREATE TRIGGER trigger_location_events
    AFTER INSERT OR UPDATE ON inventory.locations
    FOR EACH ROW
    EXECUTE FUNCTION inventory.emit_location_event();

-- ============================================================================
-- PURCHASE ORDER EVENT TRIGGERS (enhanced)
-- ============================================================================

-- Drop and recreate the PO events trigger with more event types
DROP TRIGGER IF EXISTS trigger_po_status_events ON inventory.purchase_orders;

CREATE OR REPLACE FUNCTION inventory.emit_po_status_event()
RETURNS TRIGGER AS $$
DECLARE
    v_event_name TEXT;
    v_payload JSONB;
    v_line_count INTEGER;
    v_total_value NUMERIC;
BEGIN
    -- Get line count and total value
    SELECT COUNT(*), COALESCE(SUM(qty_ordered * COALESCE(unit_cost, 0)), 0)
    INTO v_line_count, v_total_value
    FROM inventory.purchase_order_lines
    WHERE po_id = NEW.id;

    IF TG_OP = 'INSERT' THEN
        v_event_name := 'purchase_order.created';
        v_payload := jsonb_build_object(
            'po_id', NEW.id,
            'po_number', NEW.po_number,
            'vendor_location_id', NEW.vendor_location_id,
            'order_date', NEW.order_date,
            'expected_delivery_date', NEW.expected_delivery_date,
            'line_items_count', v_line_count,
            'total_value', v_total_value,
            'tenant_id', NEW.tenant_id,
            'created_at', NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        -- Detect status changes
        IF OLD.status != NEW.status THEN
            CASE NEW.status
                WHEN 'submitted' THEN
                    v_event_name := 'purchase_order.submitted';
                    v_payload := jsonb_build_object(
                        'po_id', NEW.id,
                        'po_number', NEW.po_number,
                        'tenant_id', NEW.tenant_id,
                        'submitted_at', NEW.updated_at
                    );
                WHEN 'approved' THEN
                    v_event_name := 'purchase_order.approved';
                    v_payload := jsonb_build_object(
                        'po_id', NEW.id,
                        'po_number', NEW.po_number,
                        'approved_by_user_id', NEW.approved_by_user_id,
                        'tenant_id', NEW.tenant_id,
                        'approved_at', NEW.approved_at
                    );
                WHEN 'cancelled' THEN
                    v_event_name := 'purchase_order.cancelled';
                    v_payload := jsonb_build_object(
                        'po_id', NEW.id,
                        'po_number', NEW.po_number,
                        'tenant_id', NEW.tenant_id,
                        'cancelled_at', NEW.updated_at
                    );
                WHEN 'closed' THEN
                    v_event_name := 'purchase_order.closed';
                    v_payload := jsonb_build_object(
                        'po_id', NEW.id,
                        'po_number', NEW.po_number,
                        'total_lines', v_line_count,
                        'tenant_id', NEW.tenant_id,
                        'closed_at', NEW.updated_at
                    );
                WHEN 'in_transit' THEN
                    v_event_name := 'inventory.po.placed';
                    v_payload := jsonb_build_object(
                        'po_id', NEW.id,
                        'po_number', NEW.po_number,
                        'vendor_location_id', NEW.vendor_location_id,
                        'tenant_id', NEW.tenant_id,
                        'order_date', NEW.order_date
                    );
                WHEN 'received' THEN
                    v_event_name := 'inventory.po.received';
                    v_payload := jsonb_build_object(
                        'po_id', NEW.id,
                        'po_number', NEW.po_number,
                        'tenant_id', NEW.tenant_id
                    );
                ELSE
                    RETURN NEW; -- No event for other statuses
            END CASE;
        ELSE
            RETURN NEW; -- No status change
        END IF;
    END IF;
    
    -- Emit event
    PERFORM public.emit_event(
        v_event_name,
        v_payload,
        NEW.tenant_id
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_po_status_events
    AFTER INSERT OR UPDATE ON inventory.purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION inventory.emit_po_status_event();

-- ============================================================================
-- RECEIPT LINE EVENT TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory.emit_receipt_line_event()
RETURNS TRIGGER AS $$
DECLARE
    v_payload JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_payload := jsonb_build_object(
            'receipt_id', NEW.receipt_id,
            'line_id', NEW.id,
            'catalog_item_id', NEW.catalog_item_id,
            'qty_received', NEW.qty_received,
            'po_line_id', NEW.po_line_id,
            'tenant_id', NEW.tenant_id,
            'created_at', NEW.created_at
        );
        
        PERFORM public.emit_event(
            'receipt.line_added',
            v_payload,
            NEW.tenant_id
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_receipt_line_events ON inventory.receipt_lines;
CREATE TRIGGER trigger_receipt_line_events
    AFTER INSERT ON inventory.receipt_lines
    FOR EACH ROW
    EXECUTE FUNCTION inventory.emit_receipt_line_event();

-- ============================================================================
-- VENDOR EVENT TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory.emit_vendor_event()
RETURNS TRIGGER AS $$
DECLARE
    v_event_name TEXT;
    v_payload JSONB;
    v_changes JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_name := 'vendor.created';
        v_payload := jsonb_build_object(
            'vendor_id', NEW.id,
            'vendor_name', NEW.name,
            'vendor_code', NEW.code,
            'tenant_id', NEW.tenant_id,
            'created_at', NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        v_event_name := 'vendor.updated';
        v_changes := jsonb_build_object();
        
        IF OLD.name != NEW.name THEN
            v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', OLD.name, 'new', NEW.name));
        END IF;
        IF OLD.code IS DISTINCT FROM NEW.code THEN
            v_changes := v_changes || jsonb_build_object('vendor_code', jsonb_build_object('old', OLD.code, 'new', NEW.code));
        END IF;
        
        v_payload := jsonb_build_object(
            'vendor_id', NEW.id,
            'tenant_id', NEW.tenant_id,
            'changes', v_changes,
            'updated_at', NEW.updated_at
        );
    END IF;
    
    PERFORM public.emit_event(
        v_event_name,
        v_payload,
        NEW.tenant_id
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_vendor_events ON inventory.vendors;
CREATE TRIGGER trigger_vendor_events
    AFTER INSERT OR UPDATE ON inventory.vendors
    FOR EACH ROW
    EXECUTE FUNCTION inventory.emit_vendor_event();

-- ============================================================================
-- CATEGORY EVENT TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory.emit_category_event()
RETURNS TRIGGER AS $$
DECLARE
    v_event_name TEXT;
    v_payload JSONB;
    v_changes JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_name := 'category.created';
        v_payload := jsonb_build_object(
            'category_id', NEW.id,
            'name', NEW.name,
            'tenant_id', NEW.tenant_id,
            'created_at', NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        v_event_name := 'category.updated';
        v_changes := jsonb_build_object();
        
        IF OLD.name != NEW.name THEN
            v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', OLD.name, 'new', NEW.name));
        END IF;
        
        v_payload := jsonb_build_object(
            'category_id', NEW.id,
            'tenant_id', NEW.tenant_id,
            'changes', v_changes,
            'updated_at', NEW.updated_at
        );
    END IF;
    
    PERFORM public.emit_event(
        v_event_name,
        v_payload,
        NEW.tenant_id
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_category_events ON inventory.item_categories;
CREATE TRIGGER trigger_category_events
    AFTER INSERT OR UPDATE ON inventory.item_categories
    FOR EACH ROW
    EXECUTE FUNCTION inventory.emit_category_event();

-- ============================================================================
-- ASSET EVENT TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory.emit_asset_event()
RETURNS TRIGGER AS $$
DECLARE
    v_event_name TEXT;
    v_payload JSONB;
    v_changes JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_name := 'asset.created';
        v_payload := jsonb_build_object(
            'asset_id', NEW.id,
            'asset_tag', NEW.asset_tag,
            'serial_number', NEW.serial_number,
            'vin', NEW.vin,
            'catalog_item_id', NEW.catalog_item_id,
            'status', NEW.status,
            'home_location_id', NEW.home_location_id,
            'tenant_id', NEW.tenant_id,
            'created_at', NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        -- Check for retirement
        IF NEW.status = 'retired' AND OLD.status != 'retired' THEN
            v_event_name := 'asset.retired';
            v_payload := jsonb_build_object(
                'asset_id', NEW.id,
                'asset_tag', NEW.asset_tag,
                'tenant_id', NEW.tenant_id,
                'retired_at', NEW.updated_at
            );
        ELSE
            -- Regular update
            v_event_name := 'asset.updated';
            v_changes := jsonb_build_object();
            
            IF OLD.status != NEW.status THEN
                v_changes := v_changes || jsonb_build_object('status', jsonb_build_object('old', OLD.status, 'new', NEW.status));
            END IF;
            IF OLD.home_location_id IS DISTINCT FROM NEW.home_location_id THEN
                v_changes := v_changes || jsonb_build_object('home_location_id', jsonb_build_object('old', OLD.home_location_id, 'new', NEW.home_location_id));
            END IF;
            
            v_payload := jsonb_build_object(
                'asset_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'changes', v_changes,
                'updated_at', NEW.updated_at
            );
        END IF;
    END IF;
    
    PERFORM public.emit_event(
        v_event_name,
        v_payload,
        NEW.tenant_id
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_asset_events ON inventory.assets;
CREATE TRIGGER trigger_asset_events
    AFTER INSERT OR UPDATE ON inventory.assets
    FOR EACH ROW
    EXECUTE FUNCTION inventory.emit_asset_event();

-- ============================================================================
-- STOCK THRESHOLD EVENT TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory.emit_stock_threshold_event()
RETURNS TRIGGER AS $$
DECLARE
    v_par_level RECORD;
    v_payload JSONB;
BEGIN
    -- Only check on UPDATE when quantity decreases
    IF TG_OP = 'UPDATE' AND NEW.qty_on_hand < OLD.qty_on_hand THEN
        -- Check if there's a par level defined
        SELECT * INTO v_par_level
        FROM inventory.item_location_par_levels
        WHERE catalog_item_id = NEW.catalog_item_id
          AND location_id = NEW.location_id
          AND tenant_id = NEW.tenant_id;
        
        IF FOUND THEN
            -- Check if we just crossed the reorder point
            IF OLD.qty_on_hand >= v_par_level.reorder_point AND NEW.qty_on_hand < v_par_level.reorder_point THEN
                v_payload := jsonb_build_object(
                    'item_id', NEW.catalog_item_id,
                    'location_id', NEW.location_id,
                    'current_qty', NEW.qty_on_hand,
                    'reorder_point', v_par_level.reorder_point,
                    'reorder_qty', v_par_level.reorder_qty,
                    'tenant_id', NEW.tenant_id,
                    'detected_at', NOW()
                );
                
                PERFORM public.emit_event(
                    'stock.low_threshold_reached',
                    v_payload,
                    NEW.tenant_id
                );
            END IF;
            
            -- Check if we just went out of stock
            IF OLD.qty_on_hand > 0 AND NEW.qty_on_hand <= 0 THEN
                v_payload := jsonb_build_object(
                    'item_id', NEW.catalog_item_id,
                    'location_id', NEW.location_id,
                    'previous_qty', OLD.qty_on_hand,
                    'tenant_id', NEW.tenant_id,
                    'occurred_at', NOW()
                );
                
                PERFORM public.emit_event(
                    'stock.out_of_stock',
                    v_payload,
                    NEW.tenant_id
                );
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_stock_threshold_events ON inventory.stock_balances;
CREATE TRIGGER trigger_stock_threshold_events
    AFTER UPDATE ON inventory.stock_balances
    FOR EACH ROW
    EXECUTE FUNCTION inventory.emit_stock_threshold_event();

-- ============================================================================
-- ENHANCED STOCK MOVEMENT EVENTS
-- ============================================================================

-- Enhance existing stock movement trigger to emit more specific event types
DROP TRIGGER IF EXISTS trigger_stock_movement_events ON inventory.stock_movements;

CREATE OR REPLACE FUNCTION inventory.emit_stock_movement_event()
RETURNS TRIGGER AS $$
DECLARE
    v_event_name TEXT;
    v_payload JSONB;
BEGIN
    -- Determine specific event type based on movement type
    CASE NEW.movement_type
        WHEN 'received' THEN
            v_event_name := 'stock.replenished';
            v_payload := jsonb_build_object(
                'movement_id', NEW.id,
                'item_id', NEW.catalog_item_id,
                'location_id', NEW.location_id,
                'quantity_delta', NEW.quantity_delta,
                'source_ref_type', NEW.source_ref_type,
                'source_ref_id', NEW.source_ref_id,
                'tenant_id', NEW.tenant_id,
                'occurred_at', NEW.occurred_at
            );
        WHEN 'issued' THEN
            v_event_name := 'stock.issued';
            v_payload := jsonb_build_object(
                'movement_id', NEW.id,
                'item_id', NEW.catalog_item_id,
                'location_id', NEW.location_id,
                'quantity_delta', NEW.quantity_delta,
                'tenant_id', NEW.tenant_id,
                'occurred_at', NEW.occurred_at
            );
        WHEN 'returned' THEN
            v_event_name := 'stock.returned';
            v_payload := jsonb_build_object(
                'movement_id', NEW.id,
                'item_id', NEW.catalog_item_id,
                'location_id', NEW.location_id,
                'quantity_delta', NEW.quantity_delta,
                'tenant_id', NEW.tenant_id,
                'occurred_at', NEW.occurred_at
            );
        WHEN 'transferred_in', 'transferred_out' THEN
            v_event_name := 'stock.transferred';
            v_payload := jsonb_build_object(
                'movement_id', NEW.id,
                'item_id', NEW.catalog_item_id,
                'location_id', NEW.location_id,
                'quantity_delta', NEW.quantity_delta,
                'correlation_id', NEW.correlation_id,
                'tenant_id', NEW.tenant_id,
                'occurred_at', NEW.occurred_at
            );
        ELSE
            -- Default to generic stock.adjusted event
            v_event_name := 'stock.adjusted';
            v_payload := jsonb_build_object(
                'movement_id', NEW.id,
                'item_id', NEW.catalog_item_id,
                'location_id', NEW.location_id,
                'quantity_delta', NEW.quantity_delta,
                'movement_type', NEW.movement_type,
                'tenant_id', NEW.tenant_id,
                'occurred_at', NEW.occurred_at
            );
    END CASE;
    
    -- Emit the event
    PERFORM public.emit_event(
        v_event_name,
        v_payload,
        NEW.tenant_id
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_stock_movement_events
    AFTER INSERT ON inventory.stock_movements
    FOR EACH ROW
    EXECUTE FUNCTION inventory.emit_stock_movement_event();

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$ 
DECLARE
    trigger_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO trigger_count
    FROM information_schema.triggers
    WHERE event_object_schema = 'inventory'
      AND trigger_name LIKE '%event%';
    
    RAISE NOTICE '✅ Event emission triggers wired up! Total event triggers: %', trigger_count;
END $$;

-- Show all event-emitting triggers
SELECT 
    event_object_table as table_name,
    trigger_name,
    event_manipulation as on_action
FROM information_schema.triggers
WHERE event_object_schema = 'inventory'
  AND trigger_name LIKE '%event%'
ORDER BY event_object_table, trigger_name;
