-- ============================================================================
-- EXPAND EVENT CATALOG - Comprehensive Inventory Events
-- ============================================================================
-- Adds extensive event coverage for all inventory operations
-- ============================================================================

-- ============================================================================
-- CATALOG ITEM EVENTS
-- ============================================================================

SELECT public.register_event(
    'catalog_item.updated',
    1,
    'inventory',
    'Catalog item details updated (name, SKU, category, etc)',
    '{"type":"object","required":["item_id","tenant_id"],"properties":{"item_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"changes":{"type":"object"},"updated_by_user_id":{"type":"string","format":"uuid"},"updated_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"item_id":"123e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","changes":{"name":{"old":"Widget A","new":"Widget A Pro"},"uom":{"old":"EA","new":"BOX"}},"updated_by_user_id":"789e4567-e89b-12d3-a456-426614174000","updated_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'catalog_item.deactivated',
    1,
    'inventory',
    'Catalog item marked as inactive',
    '{"type":"object","required":["item_id","tenant_id"],"properties":{"item_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"reason":{"type":"string"},"deactivated_by_user_id":{"type":"string","format":"uuid"},"deactivated_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"item_id":"123e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","reason":"Discontinued product","deactivated_by_user_id":"789e4567-e89b-12d3-a456-426614174000","deactivated_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'catalog_item.reactivated',
    1,
    'inventory',
    'Catalog item marked as active again',
    '{"type":"object","required":["item_id","tenant_id"],"properties":{"item_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"reactivated_by_user_id":{"type":"string","format":"uuid"},"reactivated_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"item_id":"123e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","reactivated_by_user_id":"789e4567-e89b-12d3-a456-426614174000","reactivated_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

-- ============================================================================
-- LOCATION EVENTS
-- ============================================================================

SELECT public.register_event(
    'location.created',
    1,
    'inventory',
    'New location created (yard, warehouse, truck, job, etc)',
    '{"type":"object","required":["location_id","location_type","name","tenant_id"],"properties":{"location_id":{"type":"string","format":"uuid"},"location_type":{"type":"string","enum":["yard","warehouse","truck","job","person","vendor","other"]},"name":{"type":"string"},"parent_location_id":{"type":"string","format":"uuid"},"external_ref":{"type":"object"},"tenant_id":{"type":"string","format":"uuid"},"created_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"location_id":"456e4567-e89b-12d3-a456-426614174000","location_type":"warehouse","name":"Main Warehouse - Bay 3","parent_location_id":"456e4567-e89b-12d3-a456-426614174001","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","created_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'location.updated',
    1,
    'inventory',
    'Location details updated',
    '{"type":"object","required":["location_id","tenant_id"],"properties":{"location_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"changes":{"type":"object"},"updated_by_user_id":{"type":"string","format":"uuid"},"updated_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"location_id":"456e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","changes":{"name":{"old":"Warehouse A","new":"Main Warehouse"}},"updated_by_user_id":"789e4567-e89b-12d3-a456-426614174000","updated_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'location.deactivated',
    1,
    'inventory',
    'Location marked as inactive',
    '{"type":"object","required":["location_id","tenant_id"],"properties":{"location_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"reason":{"type":"string"},"deactivated_by_user_id":{"type":"string","format":"uuid"},"deactivated_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"location_id":"456e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","reason":"Location closed","deactivated_by_user_id":"789e4567-e89b-12d3-a456-426614174000","deactivated_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

-- ============================================================================
-- PURCHASE ORDER EVENTS
-- ============================================================================

SELECT public.register_event(
    'purchase_order.created',
    1,
    'inventory',
    'New purchase order created',
    '{"type":"object","required":["po_id","po_number","vendor_location_id","tenant_id"],"properties":{"po_id":{"type":"string","format":"uuid"},"po_number":{"type":"string"},"vendor_location_id":{"type":"string","format":"uuid"},"order_date":{"type":"string","format":"date"},"expected_delivery_date":{"type":"string","format":"date"},"line_items_count":{"type":"integer"},"total_value":{"type":"number"},"tenant_id":{"type":"string","format":"uuid"},"created_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"po_id":"567e4567-e89b-12d3-a456-426614174000","po_number":"PO-2026-001","vendor_location_id":"678e4567-e89b-12d3-a456-426614174000","order_date":"2026-01-20","expected_delivery_date":"2026-01-27","line_items_count":5,"total_value":15000.00,"tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","created_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'purchase_order.submitted',
    1,
    'inventory',
    'Purchase order submitted to vendor',
    '{"type":"object","required":["po_id","po_number","tenant_id"],"properties":{"po_id":{"type":"string","format":"uuid"},"po_number":{"type":"string"},"submitted_by_user_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"submitted_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"po_id":"567e4567-e89b-12d3-a456-426614174000","po_number":"PO-2026-001","submitted_by_user_id":"789e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","submitted_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'purchase_order.approved',
    1,
    'inventory',
    'Purchase order approved',
    '{"type":"object","required":["po_id","po_number","approved_by_user_id","tenant_id"],"properties":{"po_id":{"type":"string","format":"uuid"},"po_number":{"type":"string"},"approved_by_user_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"approved_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"po_id":"567e4567-e89b-12d3-a456-426614174000","po_number":"PO-2026-001","approved_by_user_id":"789e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","approved_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'purchase_order.cancelled',
    1,
    'inventory',
    'Purchase order cancelled',
    '{"type":"object","required":["po_id","po_number","tenant_id"],"properties":{"po_id":{"type":"string","format":"uuid"},"po_number":{"type":"string"},"reason":{"type":"string"},"cancelled_by_user_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"cancelled_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"po_id":"567e4567-e89b-12d3-a456-426614174000","po_number":"PO-2026-001","reason":"Vendor unavailable","cancelled_by_user_id":"789e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","cancelled_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'purchase_order.closed',
    1,
    'inventory',
    'Purchase order closed (all items received)',
    '{"type":"object","required":["po_id","po_number","tenant_id"],"properties":{"po_id":{"type":"string","format":"uuid"},"po_number":{"type":"string"},"total_lines":{"type":"integer"},"total_received":{"type":"integer"},"tenant_id":{"type":"string","format":"uuid"},"closed_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"po_id":"567e4567-e89b-12d3-a456-426614174000","po_number":"PO-2026-001","total_lines":5,"total_received":5,"tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","closed_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

-- ============================================================================
-- RECEIPT EVENTS (additional)
-- ============================================================================

SELECT public.register_event(
    'receipt.line_added',
    1,
    'inventory',
    'Line item added to receipt',
    '{"type":"object","required":["receipt_id","line_id","catalog_item_id","qty_received","tenant_id"],"properties":{"receipt_id":{"type":"string","format":"uuid"},"line_id":{"type":"string","format":"uuid"},"catalog_item_id":{"type":"string","format":"uuid"},"qty_received":{"type":"number"},"po_line_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"created_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"receipt_id":"345e4567-e89b-12d3-a456-426614174000","line_id":"678e4567-e89b-12d3-a456-426614174000","catalog_item_id":"123e4567-e89b-12d3-a456-426614174000","qty_received":50,"po_line_id":"789e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","created_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'receipt.completed',
    1,
    'inventory',
    'Receipt finalized and posted to inventory',
    '{"type":"object","required":["receipt_id","receipt_number","location_id","tenant_id"],"properties":{"receipt_id":{"type":"string","format":"uuid"},"receipt_number":{"type":"string"},"location_id":{"type":"string","format":"uuid"},"total_lines":{"type":"integer"},"total_qty":{"type":"number"},"tenant_id":{"type":"string","format":"uuid"},"completed_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"receipt_id":"345e4567-e89b-12d3-a456-426614174000","receipt_number":"RCV-2026-001","location_id":"456e4567-e89b-12d3-a456-426614174000","total_lines":5,"total_qty":250,"tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","completed_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

-- ============================================================================
-- ASSET EVENTS (additional)
-- ============================================================================

SELECT public.register_event(
    'asset.created',
    1,
    'inventory',
    'New asset created with serial/VIN',
    '{"type":"object","required":["asset_id","asset_tag","catalog_item_id","tenant_id"],"properties":{"asset_id":{"type":"string","format":"uuid"},"asset_tag":{"type":"string"},"serial_number":{"type":"string"},"vin":{"type":"string"},"catalog_item_id":{"type":"string","format":"uuid"},"status":{"type":"string","enum":["available","assigned","in_repair","out_of_service","retired"]},"home_location_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"created_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"asset_id":"890e4567-e89b-12d3-a456-426614174000","asset_tag":"TRUCK-001","serial_number":"SN12345","vin":"1HGCM82633A004352","catalog_item_id":"123e4567-e89b-12d3-a456-426614174000","status":"available","home_location_id":"456e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","created_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'asset.updated',
    1,
    'inventory',
    'Asset details updated',
    '{"type":"object","required":["asset_id","tenant_id"],"properties":{"asset_id":{"type":"string","format":"uuid"},"changes":{"type":"object"},"tenant_id":{"type":"string","format":"uuid"},"updated_by_user_id":{"type":"string","format":"uuid"},"updated_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"asset_id":"890e4567-e89b-12d3-a456-426614174000","changes":{"status":{"old":"available","new":"in_repair"}},"tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","updated_by_user_id":"789e4567-e89b-12d3-a456-426614174000","updated_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'asset.retired',
    1,
    'inventory',
    'Asset retired from service',
    '{"type":"object","required":["asset_id","asset_tag","tenant_id"],"properties":{"asset_id":{"type":"string","format":"uuid"},"asset_tag":{"type":"string"},"reason":{"type":"string"},"retired_by_user_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"retired_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"asset_id":"890e4567-e89b-12d3-a456-426614174000","asset_tag":"TRUCK-001","reason":"End of useful life","retired_by_user_id":"789e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","retired_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

-- ============================================================================
-- STOCK MOVEMENT EVENTS (additional)
-- ============================================================================

SELECT public.register_event(
    'stock.replenished',
    1,
    'inventory',
    'Stock replenishment from supplier or transfer',
    '{"type":"object","required":["movement_id","item_id","location_id","quantity","tenant_id"],"properties":{"movement_id":{"type":"string","format":"uuid"},"item_id":{"type":"string","format":"uuid"},"location_id":{"type":"string","format":"uuid"},"quantity":{"type":"number"},"source":{"type":"string","enum":["receipt","transfer","adjustment"]},"reference_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"occurred_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"movement_id":"901e4567-e89b-12d3-a456-426614174000","item_id":"123e4567-e89b-12d3-a456-426614174000","location_id":"456e4567-e89b-12d3-a456-426614174000","quantity":100,"source":"receipt","reference_id":"345e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","occurred_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'stock.issued',
    1,
    'inventory',
    'Stock issued to job, truck, or person',
    '{"type":"object","required":["movement_id","item_id","from_location_id","to_location_id","quantity","tenant_id"],"properties":{"movement_id":{"type":"string","format":"uuid"},"item_id":{"type":"string","format":"uuid"},"from_location_id":{"type":"string","format":"uuid"},"to_location_id":{"type":"string","format":"uuid"},"quantity":{"type":"number"},"issued_to":{"type":"string"},"reference_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"occurred_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"movement_id":"912e4567-e89b-12d3-a456-426614174000","item_id":"123e4567-e89b-12d3-a456-426614174000","from_location_id":"456e4567-e89b-12d3-a456-426614174000","to_location_id":"456e4567-e89b-12d3-a456-426614174001","quantity":25,"issued_to":"Job #12345","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","occurred_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'stock.returned',
    1,
    'inventory',
    'Stock returned from job, truck, or person',
    '{"type":"object","required":["movement_id","item_id","from_location_id","to_location_id","quantity","tenant_id"],"properties":{"movement_id":{"type":"string","format":"uuid"},"item_id":{"type":"string","format":"uuid"},"from_location_id":{"type":"string","format":"uuid"},"to_location_id":{"type":"string","format":"uuid"},"quantity":{"type":"number"},"condition":{"type":"string","enum":["good","damaged","defective"]},"tenant_id":{"type":"string","format":"uuid"},"occurred_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"movement_id":"923e4567-e89b-12d3-a456-426614174000","item_id":"123e4567-e89b-12d3-a456-426614174000","from_location_id":"456e4567-e89b-12d3-a456-426614174001","to_location_id":"456e4567-e89b-12d3-a456-426614174000","quantity":5,"condition":"good","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","occurred_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'stock.low_threshold_reached',
    1,
    'inventory',
    'Stock level dropped below reorder point',
    '{"type":"object","required":["item_id","location_id","current_qty","reorder_point","tenant_id"],"properties":{"item_id":{"type":"string","format":"uuid"},"location_id":{"type":"string","format":"uuid"},"current_qty":{"type":"number"},"reorder_point":{"type":"number"},"reorder_qty":{"type":"number"},"tenant_id":{"type":"string","format":"uuid"},"detected_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"item_id":"123e4567-e89b-12d3-a456-426614174000","location_id":"456e4567-e89b-12d3-a456-426614174000","current_qty":15,"reorder_point":25,"reorder_qty":100,"tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","detected_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'stock.out_of_stock',
    1,
    'inventory',
    'Item completely out of stock at location',
    '{"type":"object","required":["item_id","location_id","tenant_id"],"properties":{"item_id":{"type":"string","format":"uuid"},"location_id":{"type":"string","format":"uuid"},"previous_qty":{"type":"number"},"tenant_id":{"type":"string","format":"uuid"},"occurred_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"item_id":"123e4567-e89b-12d3-a456-426614174000","location_id":"456e4567-e89b-12d3-a456-426614174000","previous_qty":5,"tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","occurred_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

-- ============================================================================
-- VENDOR EVENTS
-- ============================================================================

SELECT public.register_event(
    'vendor.created',
    1,
    'inventory',
    'New vendor added to system',
    '{"type":"object","required":["vendor_id","vendor_name","tenant_id"],"properties":{"vendor_id":{"type":"string","format":"uuid"},"vendor_name":{"type":"string"},"vendor_code":{"type":"string"},"contact_info":{"type":"object"},"tenant_id":{"type":"string","format":"uuid"},"created_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"vendor_id":"934e4567-e89b-12d3-a456-426614174000","vendor_name":"Acme Supplies Inc","vendor_code":"ACME001","contact_info":{"email":"orders@acme.com","phone":"555-1234"},"tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","created_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'vendor.updated',
    1,
    'inventory',
    'Vendor information updated',
    '{"type":"object","required":["vendor_id","tenant_id"],"properties":{"vendor_id":{"type":"string","format":"uuid"},"changes":{"type":"object"},"tenant_id":{"type":"string","format":"uuid"},"updated_by_user_id":{"type":"string","format":"uuid"},"updated_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"vendor_id":"934e4567-e89b-12d3-a456-426614174000","changes":{"contact_info":{"old":{"phone":"555-1234"},"new":{"phone":"555-5678"}}},"tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","updated_by_user_id":"789e4567-e89b-12d3-a456-426614174000","updated_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

-- ============================================================================
-- CATEGORY EVENTS
-- ============================================================================

SELECT public.register_event(
    'category.created',
    1,
    'inventory',
    'New item category created',
    '{"type":"object","required":["category_id","name","tenant_id"],"properties":{"category_id":{"type":"string","format":"uuid"},"name":{"type":"string"},"tenant_id":{"type":"string","format":"uuid"},"created_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"category_id":"945e4567-e89b-12d3-a456-426614174000","name":"Power Tools","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","created_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'category.updated',
    1,
    'inventory',
    'Item category name/details updated',
    '{"type":"object","required":["category_id","tenant_id"],"properties":{"category_id":{"type":"string","format":"uuid"},"changes":{"type":"object"},"tenant_id":{"type":"string","format":"uuid"},"updated_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"category_id":"945e4567-e89b-12d3-a456-426614174000","changes":{"name":{"old":"Power Tools","new":"Electric Power Tools"}},"tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","updated_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

-- ============================================================================
-- CYCLE COUNT EVENTS (additional)
-- ============================================================================

SELECT public.register_event(
    'cycle_count.line_counted',
    1,
    'inventory',
    'Individual line item counted in cycle count',
    '{"type":"object","required":["cycle_count_id","line_id","item_id","location_id","expected_qty","actual_qty","tenant_id"],"properties":{"cycle_count_id":{"type":"string","format":"uuid"},"line_id":{"type":"string","format":"uuid"},"item_id":{"type":"string","format":"uuid"},"location_id":{"type":"string","format":"uuid"},"expected_qty":{"type":"number"},"actual_qty":{"type":"number"},"variance_qty":{"type":"number"},"tenant_id":{"type":"string","format":"uuid"},"counted_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"cycle_count_id":"956e4567-e89b-12d3-a456-426614174000","line_id":"967e4567-e89b-12d3-a456-426614174000","item_id":"123e4567-e89b-12d3-a456-426614174000","location_id":"456e4567-e89b-12d3-a456-426614174000","expected_qty":100,"actual_qty":98,"variance_qty":-2,"tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","counted_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'cycle_count.cancelled',
    1,
    'inventory',
    'Cycle count cancelled',
    '{"type":"object","required":["cycle_count_id","tenant_id"],"properties":{"cycle_count_id":{"type":"string","format":"uuid"},"reason":{"type":"string"},"cancelled_by_user_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"cancelled_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"cycle_count_id":"956e4567-e89b-12d3-a456-426614174000","reason":"Incorrect location selected","cancelled_by_user_id":"789e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","cancelled_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

-- ============================================================================
-- ADJUSTMENT EVENTS
-- ============================================================================

SELECT public.register_event(
    'adjustment.created',
    1,
    'inventory',
    'Manual inventory adjustment initiated',
    '{"type":"object","required":["adjustment_id","item_id","location_id","quantity_change","tenant_id"],"properties":{"adjustment_id":{"type":"string","format":"uuid"},"item_id":{"type":"string","format":"uuid"},"location_id":{"type":"string","format":"uuid"},"quantity_change":{"type":"number"},"reason":{"type":"string","enum":["damage","loss","found","correction","obsolete"]},"notes":{"type":"string"},"created_by_user_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"created_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"adjustment_id":"978e4567-e89b-12d3-a456-426614174000","item_id":"123e4567-e89b-12d3-a456-426614174000","location_id":"456e4567-e89b-12d3-a456-426614174000","quantity_change":-10,"reason":"damage","notes":"Water damage during storm","created_by_user_id":"789e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","created_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'adjustment.approved',
    1,
    'inventory',
    'Inventory adjustment approved and posted',
    '{"type":"object","required":["adjustment_id","item_id","location_id","quantity_change","tenant_id"],"properties":{"adjustment_id":{"type":"string","format":"uuid"},"item_id":{"type":"string","format":"uuid"},"location_id":{"type":"string","format":"uuid"},"quantity_change":{"type":"number"},"approved_by_user_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"approved_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"adjustment_id":"978e4567-e89b-12d3-a456-426614174000","item_id":"123e4567-e89b-12d3-a456-426614174000","location_id":"456e4567-e89b-12d3-a456-426614174000","quantity_change":-10,"approved_by_user_id":"789e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","approved_at":"2026-01-20T12:00:00Z"}'::jsonb,
    'active'
);

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$ 
DECLARE
    event_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO event_count FROM public.event_definitions;
    RAISE NOTICE '✅ Event catalog expanded! Total events: %', event_count;
END $$;

-- Display all registered events
SELECT 
    event_name,
    version,
    producer,
    status,
    LEFT(description, 60) as description
FROM public.event_definitions
ORDER BY event_name;
