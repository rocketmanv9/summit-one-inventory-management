-- =====================================================
-- FIX SUPPLY CHAIN EVENT NAMING & PRODUCER ALIGNMENT
-- =====================================================
-- Problem: After bounded context separation, supply_chain
-- events still have old naming/producer assignments
--
-- Fix:
-- 1. Update producer for all supply_chain events
-- 2. Standardize naming: supply_chain.* prefix
-- 3. Deprecate old inventory.po.* events
-- 4. Update triggers to emit correct event names
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '=== FIXING SUPPLY CHAIN EVENT NAMING ===';
END $$;

-- =====================================================
-- STEP 1: REGISTER NEW supply_chain.* EVENTS
-- =====================================================

-- VENDOR EVENTS
SELECT public.register_event(
    'supply_chain.vendor.created',
    1,
    'supply_chain',
    'New vendor added to system',
    '{"type":"object","required":["vendor_id","vendor_name","tenant_id"],"properties":{"vendor_id":{"type":"string","format":"uuid"},"vendor_name":{"type":"string"},"vendor_code":{"type":"string"},"contact_info":{"type":"object"},"tenant_id":{"type":"string","format":"uuid"},"created_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"vendor_id":"934e4567-e89b-12d3-a456-426614174000","vendor_name":"Acme Supplies Inc","vendor_code":"ACME001","contact_info":{"email":"orders@acme.com","phone":"555-1234"},"tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","created_at":"2026-01-21T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'supply_chain.vendor.updated',
    1,
    'supply_chain',
    'Vendor information updated',
    '{"type":"object","required":["vendor_id","tenant_id"],"properties":{"vendor_id":{"type":"string","format":"uuid"},"changes":{"type":"object"},"tenant_id":{"type":"string","format":"uuid"},"updated_by_user_id":{"type":"string","format":"uuid"},"updated_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"vendor_id":"934e4567-e89b-12d3-a456-426614174000","changes":{"contact_info":{"old":{"phone":"555-1234"},"new":{"phone":"555-5678"}}},"tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","updated_by_user_id":"789e4567-e89b-12d3-a456-426614174000","updated_at":"2026-01-21T12:00:00Z"}'::jsonb,
    'active'
);

-- PURCHASE ORDER EVENTS
SELECT public.register_event(
    'supply_chain.purchase_order.created',
    1,
    'supply_chain',
    'New purchase order created',
    '{"type":"object","required":["po_id","po_number","vendor_id","tenant_id"],"properties":{"po_id":{"type":"string","format":"uuid"},"po_number":{"type":"string"},"vendor_id":{"type":"string","format":"uuid"},"order_date":{"type":"string","format":"date"},"expected_delivery_date":{"type":"string","format":"date"},"line_items_count":{"type":"integer"},"total_value":{"type":"number"},"tenant_id":{"type":"string","format":"uuid"},"created_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"po_id":"567e4567-e89b-12d3-a456-426614174000","po_number":"PO-2026-001","vendor_id":"678e4567-e89b-12d3-a456-426614174000","order_date":"2026-01-21","expected_delivery_date":"2026-01-28","line_items_count":5,"total_value":15000.00,"tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","created_at":"2026-01-21T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'supply_chain.purchase_order.submitted',
    1,
    'supply_chain',
    'Purchase order submitted to vendor',
    '{"type":"object","required":["po_id","po_number","tenant_id"],"properties":{"po_id":{"type":"string","format":"uuid"},"po_number":{"type":"string"},"submitted_by_user_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"submitted_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"po_id":"567e4567-e89b-12d3-a456-426614174000","po_number":"PO-2026-001","submitted_by_user_id":"789e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","submitted_at":"2026-01-21T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'supply_chain.purchase_order.approved',
    1,
    'supply_chain',
    'Purchase order approved for sending to vendor',
    '{"type":"object","required":["po_id","po_number","approved_by_user_id","tenant_id"],"properties":{"po_id":{"type":"string","format":"uuid"},"po_number":{"type":"string"},"approved_by_user_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"approved_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"po_id":"567e4567-e89b-12d3-a456-426614174000","po_number":"PO-2026-001","approved_by_user_id":"789e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","approved_at":"2026-01-21T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'supply_chain.purchase_order.in_transit',
    1,
    'supply_chain',
    'Purchase order shipment is in transit from vendor',
    '{"type":"object","required":["po_id","po_number","tenant_id"],"properties":{"po_id":{"type":"string","format":"uuid"},"po_number":{"type":"string"},"vendor_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"shipped_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"po_id":"567e4567-e89b-12d3-a456-426614174000","po_number":"PO-2026-001","vendor_id":"678e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","shipped_at":"2026-01-21T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'supply_chain.purchase_order.cancelled',
    1,
    'supply_chain',
    'Purchase order cancelled before fulfillment',
    '{"type":"object","required":["po_id","po_number","tenant_id"],"properties":{"po_id":{"type":"string","format":"uuid"},"po_number":{"type":"string"},"reason":{"type":"string"},"cancelled_by_user_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"cancelled_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"po_id":"567e4567-e89b-12d3-a456-426614174000","po_number":"PO-2026-001","reason":"Vendor unavailable","cancelled_by_user_id":"789e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","cancelled_at":"2026-01-21T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'supply_chain.purchase_order.received',
    1,
    'supply_chain',
    'All items on purchase order have been received',
    '{"type":"object","required":["po_id","po_number","tenant_id"],"properties":{"po_id":{"type":"string","format":"uuid"},"po_number":{"type":"string"},"total_lines":{"type":"integer"},"total_received":{"type":"integer"},"tenant_id":{"type":"string","format":"uuid"},"received_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"po_id":"567e4567-e89b-12d3-a456-426614174000","po_number":"PO-2026-001","total_lines":5,"total_received":5,"tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","received_at":"2026-01-21T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'supply_chain.purchase_order.closed',
    1,
    'supply_chain',
    'Purchase order administratively closed',
    '{"type":"object","required":["po_id","po_number","tenant_id"],"properties":{"po_id":{"type":"string","format":"uuid"},"po_number":{"type":"string"},"total_lines":{"type":"integer"},"tenant_id":{"type":"string","format":"uuid"},"closed_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"po_id":"567e4567-e89b-12d3-a456-426614174000","po_number":"PO-2026-001","total_lines":5,"tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","closed_at":"2026-01-21T12:00:00Z"}'::jsonb,
    'active'
);

-- RECEIPT EVENTS
SELECT public.register_event(
    'supply_chain.receipt.created',
    1,
    'supply_chain',
    'New receipt document created (goods receiving)',
    '{"type":"object","required":["receipt_id","receipt_number","location_id","tenant_id"],"properties":{"receipt_id":{"type":"string","format":"uuid"},"receipt_number":{"type":"string"},"location_id":{"type":"string","format":"uuid"},"po_id":{"type":"string","format":"uuid"},"received_by_user_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"received_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"receipt_id":"345e4567-e89b-12d3-a456-426614174000","receipt_number":"RCV-2026-001","location_id":"456e4567-e89b-12d3-a456-426614174000","po_id":"567e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","received_at":"2026-01-21T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'supply_chain.receipt.line_added',
    1,
    'supply_chain',
    'Line item added to receipt',
    '{"type":"object","required":["receipt_id","line_id","catalog_item_id","qty_received","tenant_id"],"properties":{"receipt_id":{"type":"string","format":"uuid"},"line_id":{"type":"string","format":"uuid"},"catalog_item_id":{"type":"string","format":"uuid"},"qty_received":{"type":"number"},"po_line_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"created_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"receipt_id":"345e4567-e89b-12d3-a456-426614174000","line_id":"678e4567-e89b-12d3-a456-426614174000","catalog_item_id":"123e4567-e89b-12d3-a456-426614174000","qty_received":50,"po_line_id":"789e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","created_at":"2026-01-21T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'supply_chain.receipt.posted',
    1,
    'supply_chain',
    'Receipt posted to inventory (via atomic bridge)',
    '{"type":"object","required":["receipt_id","receipt_number","location_id","tenant_id"],"properties":{"receipt_id":{"type":"string","format":"uuid"},"receipt_number":{"type":"string"},"location_id":{"type":"string","format":"uuid"},"total_lines":{"type":"integer"},"total_qty":{"type":"number"},"posted_by_user_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"posted_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"receipt_id":"345e4567-e89b-12d3-a456-426614174000","receipt_number":"RCV-2026-001","location_id":"456e4567-e89b-12d3-a456-426614174000","total_lines":5,"total_qty":250,"tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","posted_at":"2026-01-21T12:00:00Z"}'::jsonb,
    'active'
);

-- =====================================================
-- STEP 2: DEPRECATE OLD EVENTS
-- =====================================================

UPDATE public.event_definitions
SET 
    status = 'deprecated',
    deprecation_reason = 'Replaced by supply_chain.* prefixed events after bounded context separation',
    deprecated_at = NOW()
WHERE event_name IN (
    'vendor.created',
    'vendor.updated',
    'purchase_order.created',
    'purchase_order.submitted',
    'purchase_order.approved',
    'purchase_order.cancelled',
    'purchase_order.closed',
    'receipt.line_added',
    'receipt.completed',
    'inventory.po.placed',
    'inventory.po.cancelled',
    'inventory.po.received',
    'inventory.receipt.created'
);

-- =====================================================
-- STEP 3: UPDATE TRIGGERS TO EMIT NEW EVENT NAMES
-- =====================================================

-- 3.1 Update vendor events trigger
CREATE OR REPLACE FUNCTION supply_chain.emit_vendor_event()
RETURNS TRIGGER AS $$
DECLARE
    v_event_name TEXT;
    v_payload JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_name := 'supply_chain.vendor.created';
        v_payload := jsonb_build_object(
            'vendor_id', NEW.id,
            'vendor_name', NEW.name,
            'vendor_code', NEW.code,
            'tenant_id', NEW.tenant_id,
            'created_at', NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        v_event_name := 'supply_chain.vendor.updated';
        v_payload := jsonb_build_object(
            'vendor_id', NEW.id,
            'changes', jsonb_build_object(
                'old', to_jsonb(OLD),
                'new', to_jsonb(NEW)
            ),
            'tenant_id', NEW.tenant_id,
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

-- Drop and recreate trigger on correct schema
DROP TRIGGER IF EXISTS trigger_vendor_events ON supply_chain.vendors;
CREATE TRIGGER trigger_vendor_events
    AFTER INSERT OR UPDATE ON supply_chain.vendors
    FOR EACH ROW
    EXECUTE FUNCTION supply_chain.emit_vendor_event();

-- 3.2 Update purchase order events trigger
CREATE OR REPLACE FUNCTION supply_chain.emit_po_status_event()
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
    FROM supply_chain.purchase_order_lines
    WHERE po_id = NEW.id;

    IF TG_OP = 'INSERT' THEN
        v_event_name := 'supply_chain.purchase_order.created';
        v_payload := jsonb_build_object(
            'po_id', NEW.id,
            'po_number', NEW.po_number,
            'vendor_id', NEW.vendor_location_id,
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
                    v_event_name := 'supply_chain.purchase_order.submitted';
                    v_payload := jsonb_build_object(
                        'po_id', NEW.id,
                        'po_number', NEW.po_number,
                        'tenant_id', NEW.tenant_id,
                        'submitted_at', NEW.updated_at
                    );
                WHEN 'approved' THEN
                    v_event_name := 'supply_chain.purchase_order.approved';
                    v_payload := jsonb_build_object(
                        'po_id', NEW.id,
                        'po_number', NEW.po_number,
                        'approved_by_user_id', NEW.approved_by_user_id,
                        'tenant_id', NEW.tenant_id,
                        'approved_at', NEW.approved_at
                    );
                WHEN 'cancelled' THEN
                    v_event_name := 'supply_chain.purchase_order.cancelled';
                    v_payload := jsonb_build_object(
                        'po_id', NEW.id,
                        'po_number', NEW.po_number,
                        'tenant_id', NEW.tenant_id,
                        'cancelled_at', NEW.updated_at
                    );
                WHEN 'closed' THEN
                    v_event_name := 'supply_chain.purchase_order.closed';
                    v_payload := jsonb_build_object(
                        'po_id', NEW.id,
                        'po_number', NEW.po_number,
                        'total_lines', v_line_count,
                        'tenant_id', NEW.tenant_id,
                        'closed_at', NEW.updated_at
                    );
                WHEN 'in_transit' THEN
                    v_event_name := 'supply_chain.purchase_order.in_transit';
                    v_payload := jsonb_build_object(
                        'po_id', NEW.id,
                        'po_number', NEW.po_number,
                        'vendor_id', NEW.vendor_location_id,
                        'tenant_id', NEW.tenant_id,
                        'shipped_at', NEW.updated_at
                    );
                WHEN 'received' THEN
                    v_event_name := 'supply_chain.purchase_order.received';
                    v_payload := jsonb_build_object(
                        'po_id', NEW.id,
                        'po_number', NEW.po_number,
                        'total_lines', v_line_count,
                        'tenant_id', NEW.tenant_id,
                        'received_at', NEW.updated_at
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

-- Drop and recreate trigger on correct schema
DROP TRIGGER IF EXISTS trigger_po_status_events ON supply_chain.purchase_orders;
CREATE TRIGGER trigger_po_status_events
    AFTER INSERT OR UPDATE ON supply_chain.purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION supply_chain.emit_po_status_event();

-- 3.3 Update receipt events trigger
CREATE OR REPLACE FUNCTION supply_chain.emit_receipt_event()
RETURNS TRIGGER AS $$
DECLARE
    v_payload JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_payload := jsonb_build_object(
            'receipt_id', NEW.id,
            'receipt_number', NEW.receipt_number,
            'location_id', NEW.location_id,
            'po_id', NEW.po_id,
            'received_by_user_id', NEW.received_by_user_id,
            'tenant_id', NEW.tenant_id,
            'received_at', NEW.received_at
        );
        
        PERFORM public.emit_event(
            'supply_chain.receipt.created',
            v_payload,
            NEW.tenant_id
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and recreate trigger on correct schema
DROP TRIGGER IF EXISTS trigger_receipt_events ON supply_chain.receipts;
CREATE TRIGGER trigger_receipt_events
    AFTER INSERT ON supply_chain.receipts
    FOR EACH ROW
    EXECUTE FUNCTION supply_chain.emit_receipt_event();

-- 3.4 Update receipt line events trigger
CREATE OR REPLACE FUNCTION supply_chain.emit_receipt_line_event()
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
            'supply_chain.receipt.line_added',
            v_payload,
            NEW.tenant_id
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and recreate trigger on correct schema
DROP TRIGGER IF EXISTS trigger_receipt_line_events ON supply_chain.receipt_lines;
CREATE TRIGGER trigger_receipt_line_events
    AFTER INSERT ON supply_chain.receipt_lines
    FOR EACH ROW
    EXECUTE FUNCTION supply_chain.emit_receipt_line_event();

-- =====================================================
-- STEP 4: UPDATE RPC FUNCTIONS TO EMIT NEW EVENTS
-- =====================================================

-- Note: The atomic bridge RPC (rpc_post_receipt_to_inventory) should emit
-- supply_chain.receipt.posted when it successfully posts to inventory

-- =====================================================
-- VERIFICATION
-- =====================================================

DO $$ 
DECLARE
    event_count INTEGER;
    supply_chain_count INTEGER;
    deprecated_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO event_count FROM public.event_definitions WHERE status = 'active';
    SELECT COUNT(*) INTO supply_chain_count FROM public.event_definitions WHERE event_name LIKE 'supply_chain.%' AND status = 'active';
    SELECT COUNT(*) INTO deprecated_count FROM public.event_definitions WHERE status = 'deprecated';
    
    RAISE NOTICE '✅ Event Audit Complete!';
    RAISE NOTICE '   Total active events: %', event_count;
    RAISE NOTICE '   Supply chain events: %', supply_chain_count;
    RAISE NOTICE '   Deprecated events: %', deprecated_count;
END $$;

-- Display all supply_chain events
SELECT 
    event_name,
    version,
    producer,
    status,
    LEFT(description, 80) as description
FROM public.event_definitions
WHERE event_name LIKE 'supply_chain.%'
ORDER BY event_name;

-- Display deprecated events
SELECT 
    event_name,
    deprecation_reason
FROM public.event_definitions
WHERE status = 'deprecated'
ORDER BY event_name;
