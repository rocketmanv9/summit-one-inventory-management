-- ================================================================
-- Seed Event Catalog with Inventory Events
-- ================================================================

-- Stock Movement Events
INSERT INTO public.event_definitions (
    event_name,
    version,
    producer,
    description,
    payload_schema,
    example_payload,
    status
) VALUES 
(
    'inventory.stock.adjusted',
    1,
    'trigger_stock_movement_events',
    'Emitted when stock is adjusted (added, removed, transferred, or counted)',
    '{
        "type": "object",
        "required": ["movement_id", "catalog_item_id", "location_id", "adjustment_type", "quantity_change", "new_quantity"],
        "properties": {
            "movement_id": {"type": "string", "format": "uuid"},
            "catalog_item_id": {"type": "string", "format": "uuid"},
            "location_id": {"type": "string", "format": "uuid"},
            "adjustment_type": {"type": "string", "enum": ["added", "removed", "transferred", "counted"]},
            "quantity_change": {"type": "number"},
            "new_quantity": {"type": "number"},
            "reason": {"type": "string"},
            "notes": {"type": "string"}
        }
    }'::jsonb,
    '{
        "movement_id": "123e4567-e89b-12d3-a456-426614174000",
        "catalog_item_id": "456e7890-e89b-12d3-a456-426614174000",
        "location_id": "789e0123-e89b-12d3-a456-426614174000",
        "adjustment_type": "added",
        "quantity_change": 100,
        "new_quantity": 150,
        "reason": "Receiving",
        "notes": "Initial stock"
    }'::jsonb,
    'active'
),

-- Purchase Order Events
(
    'inventory.po.placed',
    1,
    'trigger_po_status_events',
    'Emitted when a purchase order status changes to placed',
    '{
        "type": "object",
        "required": ["po_id", "po_number", "vendor_location_id", "old_status", "new_status"],
        "properties": {
            "po_id": {"type": "string", "format": "uuid"},
            "po_number": {"type": "string"},
            "vendor_location_id": {"type": "string", "format": "uuid"},
            "old_status": {"type": "string"},
            "new_status": {"type": "string"},
            "total_amount": {"type": "number"},
            "expected_delivery_date": {"type": "string", "format": "date"}
        }
    }'::jsonb,
    '{
        "po_id": "123e4567-e89b-12d3-a456-426614174000",
        "po_number": "PO-2024-001",
        "vendor_location_id": "456e7890-e89b-12d3-a456-426614174000",
        "old_status": "draft",
        "new_status": "placed",
        "total_amount": 5000.00,
        "expected_delivery_date": "2024-02-01"
    }'::jsonb,
    'active'
),
(
    'inventory.po.received',
    1,
    'trigger_po_status_events',
    'Emitted when a purchase order status changes to received',
    '{
        "type": "object",
        "required": ["po_id", "po_number", "vendor_location_id", "old_status", "new_status"],
        "properties": {
            "po_id": {"type": "string", "format": "uuid"},
            "po_number": {"type": "string"},
            "vendor_location_id": {"type": "string", "format": "uuid"},
            "old_status": {"type": "string"},
            "new_status": {"type": "string"},
            "received_date": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "po_id": "123e4567-e89b-12d3-a456-426614174000",
        "po_number": "PO-2024-001",
        "vendor_location_id": "456e7890-e89b-12d3-a456-426614174000",
        "old_status": "placed",
        "new_status": "received",
        "received_date": "2024-02-01T14:30:00Z"
    }'::jsonb,
    'active'
),
(
    'inventory.po.cancelled',
    1,
    'trigger_po_status_events',
    'Emitted when a purchase order is cancelled',
    '{
        "type": "object",
        "required": ["po_id", "po_number", "vendor_location_id", "old_status", "new_status"],
        "properties": {
            "po_id": {"type": "string", "format": "uuid"},
            "po_number": {"type": "string"},
            "vendor_location_id": {"type": "string", "format": "uuid"},
            "old_status": {"type": "string"},
            "new_status": {"type": "string"},
            "cancellation_reason": {"type": "string"}
        }
    }'::jsonb,
    '{
        "po_id": "123e4567-e89b-12d3-a456-426614174000",
        "po_number": "PO-2024-001",
        "vendor_location_id": "456e7890-e89b-12d3-a456-426614174000",
        "old_status": "placed",
        "new_status": "cancelled",
        "cancellation_reason": "Vendor cannot fulfill"
    }'::jsonb,
    'active'
),

-- Receipt Events
(
    'inventory.receipt.created',
    1,
    'trigger_receipt_events',
    'Emitted when a new receipt is created',
    '{
        "type": "object",
        "required": ["receipt_id", "receipt_number", "purchase_order_id", "location_id"],
        "properties": {
            "receipt_id": {"type": "string", "format": "uuid"},
            "receipt_number": {"type": "string"},
            "purchase_order_id": {"type": "string", "format": "uuid"},
            "location_id": {"type": "string", "format": "uuid"},
            "received_date": {"type": "string", "format": "date-time"},
            "notes": {"type": "string"}
        }
    }'::jsonb,
    '{
        "receipt_id": "123e4567-e89b-12d3-a456-426614174000",
        "receipt_number": "RCV-2024-001",
        "purchase_order_id": "456e7890-e89b-12d3-a456-426614174000",
        "location_id": "789e0123-e89b-12d3-a456-426614174000",
        "received_date": "2024-02-01T14:30:00Z",
        "notes": "All items received in good condition"
    }'::jsonb,
    'active'
),

-- Cycle Count Events
(
    'inventory.cycle_count.discrepancy',
    1,
    'trigger_cycle_count_events',
    'Emitted when a cycle count reveals a discrepancy',
    '{
        "type": "object",
        "required": ["cycle_count_id", "catalog_item_id", "location_id", "expected_qty", "counted_qty", "variance"],
        "properties": {
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "catalog_item_id": {"type": "string", "format": "uuid"},
            "location_id": {"type": "string", "format": "uuid"},
            "expected_qty": {"type": "number"},
            "counted_qty": {"type": "number"},
            "variance": {"type": "number"},
            "variance_percentage": {"type": "number"}
        }
    }'::jsonb,
    '{
        "cycle_count_id": "123e4567-e89b-12d3-a456-426614174000",
        "catalog_item_id": "456e7890-e89b-12d3-a456-426614174000",
        "location_id": "789e0123-e89b-12d3-a456-426614174000",
        "expected_qty": 100,
        "counted_qty": 95,
        "variance": -5,
        "variance_percentage": -5.0
    }'::jsonb,
    'active'
);

-- ================================================================
-- Seed Event Consumers (Example - Core Service)
-- ================================================================

INSERT INTO public.event_consumers (
    event_name,
    consumer_name,
    consumer_type,
    endpoint_url,
    description,
    active
) VALUES 
(
    'inventory.stock.adjusted',
    'Core Analytics',
    'webhook',
    'https://dev.summit-one.app/api/webhooks/inventory',
    'Tracks inventory changes for analytics dashboard',
    false  -- Not active yet
),
(
    'inventory.po.placed',
    'Core Notifications',
    'webhook',
    'https://dev.summit-one.app/api/webhooks/inventory',
    'Sends notifications when POs are placed',
    false
);
