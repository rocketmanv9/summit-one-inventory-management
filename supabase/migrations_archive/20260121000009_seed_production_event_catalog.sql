-- ================================================================
-- Seed Production Event Catalog - COMPLETE (46 Events)
-- ================================================================
-- Purpose: Seed production database with complete event catalog
-- Date: 2026-01-21  
-- Events: 46 active events across inventory and supply_chain contexts
-- Source: EVENT_CATALOG.md
-- ================================================================

-- Clean up existing test events
DELETE FROM public.event_definitions 
WHERE event_name LIKE 'inventory.test.%'
   OR event_name LIKE 'test.%';

-- Remove any duplicate/old events before fresh seed
DELETE FROM public.event_definitions 
WHERE event_name LIKE 'inventory.%'
   OR event_name LIKE 'supply_chain.%'
   OR event_name IN (SELECT event_name FROM public.event_definitions WHERE event_name SIMILAR TO '%(stock|asset|catalog_item|location|transfer|reservation|cycle_count|adjustment|category)\.%');

-- ================================================================
-- SUPPLY CHAIN EVENTS (12 events)
-- ================================================================

-- Vendor Events (2)
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
    'supply_chain.vendor.created',
    1,
    'supply_chain',
    'New vendor added to system',
    '{
        "type": "object",
        "required": ["vendor_id", "vendor_name", "tenant_id"],
        "properties": {
            "vendor_id": {"type": "string", "format": "uuid"},
            "vendor_name": {"type": "string"},
            "vendor_code": {"type": "string"},
            "contact_info": {"type": "object"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "created_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "vendor_id": "934e4567-e89b-12d3-a456-426614174000",
        "vendor_name": "Acme Supplies Inc",
        "vendor_code": "ACME001",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "created_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'supply_chain.vendor.updated',
    1,
    'supply_chain',
    'Vendor information updated',
    '{
        "type": "object",
        "required": ["vendor_id", "tenant_id"],
        "properties": {
            "vendor_id": {"type": "string", "format": "uuid"},
            "changes": {"type": "object"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "updated_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "vendor_id": "934e4567-e89b-12d3-a456-426614174000",
        "changes": {"contact_info": {"old": {"phone": "555-1234"}, "new": {"phone": "555-5678"}}},
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "updated_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),

-- Purchase Order Events (7)
(
    'supply_chain.purchase_order.created',
    1,
    'supply_chain',
    'New purchase order created',
    '{
        "type": "object",
        "required": ["po_id", "po_number", "vendor_id", "tenant_id"],
        "properties": {
            "po_id": {"type": "string", "format": "uuid"},
            "po_number": {"type": "string"},
            "vendor_id": {"type": "string", "format": "uuid"},
            "order_date": {"type": "string", "format": "date"},
            "expected_delivery_date": {"type": "string", "format": "date"},
            "line_items_count": {"type": "integer"},
            "total_value": {"type": "number"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "created_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "po_id": "567e4567-e89b-12d3-a456-426614174000",
        "po_number": "PO-2026-001",
        "vendor_id": "678e4567-e89b-12d3-a456-426614174000",
        "order_date": "2026-01-21",
        "total_value": 15000.00,
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "created_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'supply_chain.purchase_order.submitted',
    1,
    'supply_chain',
    'Purchase order submitted to vendor',
    '{
        "type": "object",
        "required": ["po_id", "po_number", "tenant_id"],
        "properties": {
            "po_id": {"type": "string", "format": "uuid"},
            "po_number": {"type": "string"},
            "submitted_by_user_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "submitted_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "po_id": "567e4567-e89b-12d3-a456-426614174000",
        "po_number": "PO-2026-001",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "submitted_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'supply_chain.purchase_order.approved',
    1,
    'supply_chain',
    'Purchase order approved for sending to vendor',
    '{
        "type": "object",
        "required": ["po_id", "po_number", "approved_by_user_id", "tenant_id"],
        "properties": {
            "po_id": {"type": "string", "format": "uuid"},
            "po_number": {"type": "string"},
            "approved_by_user_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "approved_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "po_id": "567e4567-e89b-12d3-a456-426614174000",
        "po_number": "PO-2026-001",
        "approved_by_user_id": "789e4567-e89b-12d3-a456-426614174000",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "approved_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'supply_chain.purchase_order.in_transit',
    1,
    'supply_chain',
    'Purchase order shipment is in transit from vendor',
    '{
        "type": "object",
        "required": ["po_id", "po_number", "tenant_id"],
        "properties": {
            "po_id": {"type": "string", "format": "uuid"},
            "po_number": {"type": "string"},
            "vendor_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "shipped_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "po_id": "567e4567-e89b-12d3-a456-426614174000",
        "po_number": "PO-2026-001",
        "vendor_id": "678e4567-e89b-12d3-a456-426614174000",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "shipped_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'supply_chain.purchase_order.cancelled',
    1,
    'supply_chain',
    'Purchase order cancelled before fulfillment',
    '{
        "type": "object",
        "required": ["po_id", "po_number", "tenant_id"],
        "properties": {
            "po_id": {"type": "string", "format": "uuid"},
            "po_number": {"type": "string"},
            "reason": {"type": "string"},
            "cancelled_by_user_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "cancelled_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "po_id": "567e4567-e89b-12d3-a456-426614174000",
        "po_number": "PO-2026-001",
        "reason": "Vendor unavailable",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "cancelled_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'supply_chain.purchase_order.received',
    1,
    'supply_chain',
    'All items on purchase order have been received',
    '{
        "type": "object",
        "required": ["po_id", "po_number", "tenant_id"],
        "properties": {
            "po_id": {"type": "string", "format": "uuid"},
            "po_number": {"type": "string"},
            "total_lines": {"type": "integer"},
            "total_received": {"type": "integer"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "received_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "po_id": "567e4567-e89b-12d3-a456-426614174000",
        "po_number": "PO-2026-001",
        "total_lines": 5,
        "total_received": 5,
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "received_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'supply_chain.purchase_order.closed',
    1,
    'supply_chain',
    'Purchase order administratively closed',
    '{
        "type": "object",
        "required": ["po_id", "po_number", "tenant_id"],
        "properties": {
            "po_id": {"type": "string", "format": "uuid"},
            "po_number": {"type": "string"},
            "total_lines": {"type": "integer"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "closed_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "po_id": "567e4567-e89b-12d3-a456-426614174000",
        "po_number": "PO-2026-001",
        "total_lines": 5,
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "closed_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),

-- Receipt Events (3)
(
    'supply_chain.receipt.created',
    1,
    'supply_chain',
    'New receipt document created (goods receiving)',
    '{
        "type": "object",
        "required": ["receipt_id", "receipt_number", "location_id", "tenant_id"],
        "properties": {
            "receipt_id": {"type": "string", "format": "uuid"},
            "receipt_number": {"type": "string"},
            "location_id": {"type": "string", "format": "uuid"},
            "po_id": {"type": "string", "format": "uuid"},
            "received_by_user_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "received_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "receipt_id": "345e4567-e89b-12d3-a456-426614174000",
        "receipt_number": "RCV-2026-001",
        "location_id": "456e4567-e89b-12d3-a456-426614174000",
        "po_id": "567e4567-e89b-12d3-a456-426614174000",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "received_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'supply_chain.receipt.line_added',
    1,
    'supply_chain',
    'Line item added to receipt',
    '{
        "type": "object",
        "required": ["receipt_id", "line_id", "catalog_item_id", "qty_received", "tenant_id"],
        "properties": {
            "receipt_id": {"type": "string", "format": "uuid"},
            "line_id": {"type": "string", "format": "uuid"},
            "catalog_item_id": {"type": "string", "format": "uuid"},
            "qty_received": {"type": "number"},
            "po_line_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "created_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "receipt_id": "345e4567-e89b-12d3-a456-426614174000",
        "line_id": "678e4567-e89b-12d3-a456-426614174000",
        "catalog_item_id": "123e4567-e89b-12d3-a456-426614174000",
        "qty_received": 50,
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "created_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'supply_chain.receipt.posted',
    1,
    'supply_chain',
    'Receipt posted to inventory (via atomic bridge)',
    '{
        "type": "object",
        "required": ["receipt_id", "receipt_number", "location_id", "tenant_id"],
        "properties": {
            "receipt_id": {"type": "string", "format": "uuid"},
            "receipt_number": {"type": "string"},
            "location_id": {"type": "string", "format": "uuid"},
            "total_lines": {"type": "integer"},
            "total_qty": {"type": "number"},
            "posted_by_user_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "posted_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "receipt_id": "345e4567-e89b-12d3-a456-426614174000",
        "receipt_number": "RCV-2026-001",
        "location_id": "456e4567-e89b-12d3-a456-426614174000",
        "total_lines": 5,
        "total_qty": 250,
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "posted_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),

-- ================================================================
-- INVENTORY EVENTS (34 events)
-- ================================================================

-- Catalog Item Events (4)
(
    'inventory.item.created',
    1,
    'inventory',
    'New catalog item (SKU) created',
    '{
        "type": "object",
        "required": ["item_id", "sku", "name", "tenant_id"],
        "properties": {
            "item_id": {"type": "string", "format": "uuid"},
            "sku": {"type": "string"},
            "name": {"type": "string"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "created_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "item_id": "123e4567-e89b-12d3-a456-426614174000",
        "sku": "ABC-123",
        "name": "Portland Cement Type I",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "created_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'catalog_item.updated',
    1,
    'inventory',
    'Catalog item details updated',
    '{
        "type": "object",
        "required": ["item_id", "tenant_id"],
        "properties": {
            "item_id": {"type": "string", "format": "uuid"},
            "changes": {"type": "object"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "updated_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "item_id": "123e4567-e89b-12d3-a456-426614174000",
        "changes": {"price": {"old": 12.50, "new": 13.00}},
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "updated_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'catalog_item.deactivated',
    1,
    'inventory',
    'Catalog item marked as inactive',
    '{
        "type": "object",
        "required": ["item_id", "tenant_id"],
        "properties": {
            "item_id": {"type": "string", "format": "uuid"},
            "reason": {"type": "string"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "deactivated_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "item_id": "123e4567-e89b-12d3-a456-426614174000",
        "reason": "discontinued",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "deactivated_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'catalog_item.reactivated',
    1,
    'inventory',
    'Catalog item marked as active again',
    '{
        "type": "object",
        "required": ["item_id", "tenant_id"],
        "properties": {
            "item_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "reactivated_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "item_id": "123e4567-e89b-12d3-a456-426614174000",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "reactivated_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),

-- Location Events (3)
(
    'location.created',
    1,
    'inventory',
    'New location created (yard, warehouse, truck, job, etc.)',
    '{
        "type": "object",
        "required": ["location_id", "location_name", "location_type", "tenant_id"],
        "properties": {
            "location_id": {"type": "string", "format": "uuid"},
            "location_name": {"type": "string"},
            "location_type": {"type": "string", "enum": ["warehouse", "yard", "truck", "job", "virtual"]},
            "tenant_id": {"type": "string", "format": "uuid"},
            "created_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "location_id": "456e4567-e89b-12d3-a456-426614174000",
        "location_name": "Main Warehouse",
        "location_type": "warehouse",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "created_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'location.updated',
    1,
    'inventory',
    'Location details updated',
    '{
        "type": "object",
        "required": ["location_id", "tenant_id"],
        "properties": {
            "location_id": {"type": "string", "format": "uuid"},
            "changes": {"type": "object"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "updated_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "location_id": "456e4567-e89b-12d3-a456-426614174000",
        "changes": {"name": {"old": "Main Warehouse", "new": "Central Warehouse"}},
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "updated_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'location.deactivated',
    1,
    'inventory',
    'Location marked as inactive',
    '{
        "type": "object",
        "required": ["location_id", "tenant_id"],
        "properties": {
            "location_id": {"type": "string", "format": "uuid"},
            "reason": {"type": "string"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "deactivated_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "location_id": "456e4567-e89b-12d3-a456-426614174000",
        "reason": "facility closed",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "deactivated_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),

-- Stock Movement Events (5)
(
    'stock.replenished',
    1,
    'inventory',
    'Stock replenishment from supplier or transfer',
    '{
        "type": "object",
        "required": ["item_id", "location_id", "quantity", "tenant_id"],
        "properties": {
            "movement_id": {"type": "string", "format": "uuid"},
            "item_id": {"type": "string", "format": "uuid"},
            "location_id": {"type": "string", "format": "uuid"},
            "quantity": {"type": "number"},
            "source": {"type": "string"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "occurred_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "movement_id": "789e4567-e89b-12d3-a456-426614174000",
        "item_id": "123e4567-e89b-12d3-a456-426614174000",
        "location_id": "456e4567-e89b-12d3-a456-426614174000",
        "quantity": 100,
        "source": "receipt",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "occurred_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'stock.issued',
    1,
    'inventory',
    'Stock issued to job, truck, or person',
    '{
        "type": "object",
        "required": ["movement_id", "item_id", "from_location_id", "quantity", "tenant_id"],
        "properties": {
            "movement_id": {"type": "string", "format": "uuid"},
            "item_id": {"type": "string", "format": "uuid"},
            "from_location_id": {"type": "string", "format": "uuid"},
            "to_location_id": {"type": "string", "format": "uuid"},
            "quantity": {"type": "number"},
            "issued_to": {"type": "string"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "occurred_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "movement_id": "789e4567-e89b-12d3-a456-426614174000",
        "item_id": "123e4567-e89b-12d3-a456-426614174000",
        "from_location_id": "456e4567-e89b-12d3-a456-426614174000",
        "quantity": 25,
        "issued_to": "Job #12345",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "occurred_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'stock.returned',
    1,
    'inventory',
    'Stock returned from job, truck, or person',
    '{
        "type": "object",
        "required": ["item_id", "location_id", "quantity", "tenant_id"],
        "properties": {
            "movement_id": {"type": "string", "format": "uuid"},
            "item_id": {"type": "string", "format": "uuid"},
            "location_id": {"type": "string", "format": "uuid"},
            "quantity": {"type": "number"},
            "returned_from": {"type": "string"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "occurred_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "movement_id": "789e4567-e89b-12d3-a456-426614174000",
        "item_id": "123e4567-e89b-12d3-a456-426614174000",
        "location_id": "456e4567-e89b-12d3-a456-426614174000",
        "quantity": 5,
        "returned_from": "Job #12345",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "occurred_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'stock.low_threshold_reached',
    1,
    'inventory',
    'Stock level dropped below reorder point',
    '{
        "type": "object",
        "required": ["item_id", "location_id", "current_qty", "reorder_point", "tenant_id"],
        "properties": {
            "item_id": {"type": "string", "format": "uuid"},
            "location_id": {"type": "string", "format": "uuid"},
            "current_qty": {"type": "number"},
            "reorder_point": {"type": "number"},
            "reorder_qty": {"type": "number"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "detected_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "item_id": "123e4567-e89b-12d3-a456-426614174000",
        "location_id": "456e4567-e89b-12d3-a456-426614174000",
        "current_qty": 15,
        "reorder_point": 20,
        "reorder_qty": 100,
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "detected_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'stock.out_of_stock',
    1,
    'inventory',
    'Item completely out of stock at location',
    '{
        "type": "object",
        "required": ["item_id", "location_id", "tenant_id"],
        "properties": {
            "item_id": {"type": "string", "format": "uuid"},
            "location_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "detected_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "item_id": "123e4567-e89b-12d3-a456-426614174000",
        "location_id": "456e4567-e89b-12d3-a456-426614174000",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "detected_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),

-- Transfer Events (3)
(
    'transfer.created',
    1,
    'inventory',
    'Inventory transfer created in draft status',
    '{
        "type": "object",
        "required": ["transfer_id", "from_location_id", "to_location_id", "tenant_id"],
        "properties": {
            "transfer_id": {"type": "string", "format": "uuid"},
            "transfer_number": {"type": "string"},
            "from_location_id": {"type": "string", "format": "uuid"},
            "to_location_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "created_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "transfer_id": "234e4567-e89b-12d3-a456-426614174000",
        "transfer_number": "TRF-2026-001",
        "from_location_id": "456e4567-e89b-12d3-a456-426614174000",
        "to_location_id": "567e4567-e89b-12d3-a456-426614174000",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "created_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'transfer.completed',
    1,
    'inventory',
    'Inventory transfer completed - goods moved',
    '{
        "type": "object",
        "required": ["transfer_id", "transfer_number", "from_location_id", "to_location_id", "tenant_id"],
        "properties": {
            "transfer_id": {"type": "string", "format": "uuid"},
            "transfer_number": {"type": "string"},
            "from_location_id": {"type": "string", "format": "uuid"},
            "to_location_id": {"type": "string", "format": "uuid"},
            "total_items": {"type": "integer"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "completed_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "transfer_id": "234e4567-e89b-12d3-a456-426614174000",
        "transfer_number": "TRF-2026-001",
        "from_location_id": "456e4567-e89b-12d3-a456-426614174000",
        "to_location_id": "567e4567-e89b-12d3-a456-426614174000",
        "total_items": 3,
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "completed_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'transfer.cancelled',
    1,
    'inventory',
    'Inventory transfer cancelled',
    '{
        "type": "object",
        "required": ["transfer_id", "tenant_id"],
        "properties": {
            "transfer_id": {"type": "string", "format": "uuid"},
            "transfer_number": {"type": "string"},
            "reason": {"type": "string"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "cancelled_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "transfer_id": "234e4567-e89b-12d3-a456-426614174000",
        "transfer_number": "TRF-2026-001",
        "reason": "location changed",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "cancelled_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),

-- Reservation Events (3)
(
    'reservation.created',
    1,
    'inventory',
    'Inventory reservation created',
    '{
        "type": "object",
        "required": ["reservation_id", "item_id", "location_id", "quantity", "tenant_id"],
        "properties": {
            "reservation_id": {"type": "string", "format": "uuid"},
            "item_id": {"type": "string", "format": "uuid"},
            "location_id": {"type": "string", "format": "uuid"},
            "quantity": {"type": "number"},
            "job_ref": {"type": "string"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "created_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "reservation_id": "890e4567-e89b-12d3-a456-426614174000",
        "item_id": "123e4567-e89b-12d3-a456-426614174000",
        "location_id": "456e4567-e89b-12d3-a456-426614174000",
        "quantity": 50,
        "job_ref": "Job #12345",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "created_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'reservation.fulfilled',
    1,
    'inventory',
    'Inventory reservation fulfilled (stock issued)',
    '{
        "type": "object",
        "required": ["reservation_id", "tenant_id"],
        "properties": {
            "reservation_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "fulfilled_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "reservation_id": "890e4567-e89b-12d3-a456-426614174000",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "fulfilled_at": "2026-01-21T14:00:00Z"
    }'::jsonb,
    'active'
),
(
    'reservation.cancelled',
    1,
    'inventory',
    'Inventory reservation cancelled',
    '{
        "type": "object",
        "required": ["reservation_id", "tenant_id"],
        "properties": {
            "reservation_id": {"type": "string", "format": "uuid"},
            "reason": {"type": "string"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "cancelled_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "reservation_id": "890e4567-e89b-12d3-a456-426614174000",
        "reason": "job cancelled",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "cancelled_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),

-- Asset Events (5)
(
    'asset.created',
    1,
    'inventory',
    'New asset created with serial/VIN',
    '{
        "type": "object",
        "required": ["asset_id", "catalog_item_id", "tenant_id"],
        "properties": {
            "asset_id": {"type": "string", "format": "uuid"},
            "asset_tag": {"type": "string"},
            "catalog_item_id": {"type": "string", "format": "uuid"},
            "serial_number": {"type": "string"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "created_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "asset_id": "901e4567-e89b-12d3-a456-426614174000",
        "asset_tag": "ASSET-001",
        "catalog_item_id": "123e4567-e89b-12d3-a456-426614174000",
        "serial_number": "SN123456",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "created_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'asset.assigned',
    1,
    'inventory',
    'Asset assigned to employee/vehicle/job',
    '{
        "type": "object",
        "required": ["asset_id", "assigned_to_type", "assigned_to_id", "tenant_id"],
        "properties": {
            "asset_id": {"type": "string", "format": "uuid"},
            "asset_tag": {"type": "string"},
            "assigned_to_type": {"type": "string", "enum": ["employee", "vehicle", "job"]},
            "assigned_to_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "assigned_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "asset_id": "901e4567-e89b-12d3-a456-426614174000",
        "asset_tag": "ASSET-001",
        "assigned_to_type": "employee",
        "assigned_to_id": "012e4567-e89b-12d3-a456-426614174000",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "assigned_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'asset.returned',
    1,
    'inventory',
    'Asset returned from assignment',
    '{
        "type": "object",
        "required": ["asset_id", "tenant_id"],
        "properties": {
            "asset_id": {"type": "string", "format": "uuid"},
            "asset_tag": {"type": "string"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "returned_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "asset_id": "901e4567-e89b-12d3-a456-426614174000",
        "asset_tag": "ASSET-001",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "returned_at": "2026-01-21T18:00:00Z"
    }'::jsonb,
    'active'
),
(
    'asset.updated',
    1,
    'inventory',
    'Asset details updated',
    '{
        "type": "object",
        "required": ["asset_id", "tenant_id"],
        "properties": {
            "asset_id": {"type": "string", "format": "uuid"},
            "changes": {"type": "object"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "updated_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "asset_id": "901e4567-e89b-12d3-a456-426614174000",
        "changes": {"status": {"old": "active", "new": "maintenance"}},
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "updated_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'asset.retired',
    1,
    'inventory',
    'Asset retired from service',
    '{
        "type": "object",
        "required": ["asset_id", "tenant_id"],
        "properties": {
            "asset_id": {"type": "string", "format": "uuid"},
            "asset_tag": {"type": "string"},
            "reason": {"type": "string"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "retired_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "asset_id": "901e4567-e89b-12d3-a456-426614174000",
        "asset_tag": "ASSET-001",
        "reason": "end of life",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "retired_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),

-- Cycle Count Events (5)
(
    'cycle_count.started',
    1,
    'inventory',
    'Cycle count initiated',
    '{
        "type": "object",
        "required": ["cycle_count_id", "location_id", "tenant_id"],
        "properties": {
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "count_number": {"type": "string"},
            "location_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "started_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "cycle_count_id": "345e4567-e89b-12d3-a456-426614174111",
        "count_number": "CC-2026-001",
        "location_id": "456e4567-e89b-12d3-a456-426614174000",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "started_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'cycle_count.line_counted',
    1,
    'inventory',
    'Individual line item counted in cycle count',
    '{
        "type": "object",
        "required": ["cycle_count_id", "line_id", "item_id", "location_id", "expected_qty", "actual_qty", "tenant_id"],
        "properties": {
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "line_id": {"type": "string", "format": "uuid"},
            "item_id": {"type": "string", "format": "uuid"},
            "location_id": {"type": "string", "format": "uuid"},
            "expected_qty": {"type": "number"},
            "actual_qty": {"type": "number"},
            "variance_qty": {"type": "number"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "counted_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "cycle_count_id": "345e4567-e89b-12d3-a456-426614174111",
        "line_id": "456e4567-e89b-12d3-a456-426614174222",
        "item_id": "123e4567-e89b-12d3-a456-426614174000",
        "location_id": "456e4567-e89b-12d3-a456-426614174000",
        "expected_qty": 100,
        "actual_qty": 98,
        "variance_qty": -2,
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "counted_at": "2026-01-21T13:00:00Z"
    }'::jsonb,
    'active'
),
(
    'cycle_count.approved',
    1,
    'inventory',
    'Cycle count approved for posting',
    '{
        "type": "object",
        "required": ["cycle_count_id", "approved_by_user_id", "tenant_id"],
        "properties": {
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "approved_by_user_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "approved_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "cycle_count_id": "345e4567-e89b-12d3-a456-426614174111",
        "approved_by_user_id": "789e4567-e89b-12d3-a456-426614174000",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "approved_at": "2026-01-21T14:00:00Z"
    }'::jsonb,
    'active'
),
(
    'cycle_count.posted',
    1,
    'inventory',
    'Cycle count adjustments posted to ledger',
    '{
        "type": "object",
        "required": ["cycle_count_id", "tenant_id"],
        "properties": {
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "total_adjustments": {"type": "integer"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "posted_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "cycle_count_id": "345e4567-e89b-12d3-a456-426614174111",
        "total_adjustments": 3,
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "posted_at": "2026-01-21T14:30:00Z"
    }'::jsonb,
    'active'
),
(
    'cycle_count.cancelled',
    1,
    'inventory',
    'Cycle count cancelled',
    '{
        "type": "object",
        "required": ["cycle_count_id", "tenant_id"],
        "properties": {
            "cycle_count_id": {"type": "string", "format": "uuid"},
            "reason": {"type": "string"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "cancelled_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "cycle_count_id": "345e4567-e89b-12d3-a456-426614174111",
        "reason": "incorrect location",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "cancelled_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),

-- Adjustment Events (2)
(
    'adjustment.created',
    1,
    'inventory',
    'Manual inventory adjustment initiated',
    '{
        "type": "object",
        "required": ["adjustment_id", "item_id", "location_id", "quantity_change", "reason", "tenant_id"],
        "properties": {
            "adjustment_id": {"type": "string", "format": "uuid"},
            "item_id": {"type": "string", "format": "uuid"},
            "location_id": {"type": "string", "format": "uuid"},
            "quantity_change": {"type": "number"},
            "reason": {"type": "string", "enum": ["damage", "loss", "found", "correction", "obsolete"]},
            "notes": {"type": "string"},
            "created_by_user_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "created_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "adjustment_id": "567e4567-e89b-12d3-a456-426614174333",
        "item_id": "123e4567-e89b-12d3-a456-426614174000",
        "location_id": "456e4567-e89b-12d3-a456-426614174000",
        "quantity_change": -10,
        "reason": "damage",
        "notes": "Water damaged in storage",
        "created_by_user_id": "789e4567-e89b-12d3-a456-426614174000",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "created_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'adjustment.approved',
    1,
    'inventory',
    'Inventory adjustment approved and posted',
    '{
        "type": "object",
        "required": ["adjustment_id", "approved_by_user_id", "tenant_id"],
        "properties": {
            "adjustment_id": {"type": "string", "format": "uuid"},
            "approved_by_user_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "approved_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "adjustment_id": "567e4567-e89b-12d3-a456-426614174333",
        "approved_by_user_id": "789e4567-e89b-12d3-a456-426614174000",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "approved_at": "2026-01-21T13:00:00Z"
    }'::jsonb,
    'active'
),

-- Category Events (2)
(
    'category.created',
    1,
    'inventory',
    'New item category created',
    '{
        "type": "object",
        "required": ["category_id", "category_name", "tenant_id"],
        "properties": {
            "category_id": {"type": "string", "format": "uuid"},
            "category_name": {"type": "string"},
            "parent_category_id": {"type": "string", "format": "uuid"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "created_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "category_id": "678e4567-e89b-12d3-a456-426614174444",
        "category_name": "Concrete Materials",
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "created_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),
(
    'category.updated',
    1,
    'inventory',
    'Item category name/details updated',
    '{
        "type": "object",
        "required": ["category_id", "tenant_id"],
        "properties": {
            "category_id": {"type": "string", "format": "uuid"},
            "changes": {"type": "object"},
            "tenant_id": {"type": "string", "format": "uuid"},
            "updated_at": {"type": "string", "format": "date-time"}
        }
    }'::jsonb,
    '{
        "category_id": "678e4567-e89b-12d3-a456-426614174444",
        "changes": {"category_name": {"old": "Concrete Materials", "new": "Cement & Concrete"}},
        "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
        "updated_at": "2026-01-21T12:00:00Z"
    }'::jsonb,
    'active'
),

-- System Events (2)
(
    'inventory.stock.adjusted',
    1,
    'inventory',
    'Stock levels changed (adjustment, sale, receipt) - LEGACY',
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
(
    'inventory.cycle_count.discrepancy',
    1,
    'inventory',
    'Cycle count reveals discrepancy - LEGACY',
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
-- VERIFICATION
-- ================================================================

DO $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Count all active events
    SELECT COUNT(*) INTO v_count
    FROM public.event_definitions
    WHERE status = 'active'
      AND (event_name LIKE 'inventory.%' 
           OR event_name LIKE 'supply_chain.%'
           OR event_name LIKE 'stock.%'
           OR event_name LIKE 'asset.%'
           OR event_name LIKE 'catalog_item.%'
           OR event_name LIKE 'location.%'
           OR event_name LIKE 'transfer.%'
           OR event_name LIKE 'reservation.%'
           OR event_name LIKE 'cycle_count.%'
           OR event_name LIKE 'adjustment.%'
           OR event_name LIKE 'category.%');
    
    RAISE NOTICE '';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '   EVENT CATALOG SEEDED SUCCESSFULLY';
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'Total Active Events: %', v_count;
    RAISE NOTICE '';
    RAISE NOTICE 'Supply Chain Events: 12';
    RAISE NOTICE '  - Vendor: 2';
    RAISE NOTICE '  - Purchase Order: 7';
    RAISE NOTICE '  - Receipt: 3';
    RAISE NOTICE '';
    RAISE NOTICE 'Inventory Events: 34';
    RAISE NOTICE '  - Catalog Item: 4';
    RAISE NOTICE '  - Location: 3';
    RAISE NOTICE '  - Stock Movement: 5';
    RAISE NOTICE '  - Transfer: 3';
    RAISE NOTICE '  - Reservation: 3';
    RAISE NOTICE '  - Asset: 5';
    RAISE NOTICE '  - Cycle Count: 5';
    RAISE NOTICE '  - Adjustment: 2';
    RAISE NOTICE '  - Category: 2';
    RAISE NOTICE '  - System (Legacy): 2';
    RAISE NOTICE '';
    
    IF v_count = 46 THEN
        RAISE NOTICE '✅ SUCCESS: All 46 events registered';
    ELSE
        RAISE WARNING '⚠️  Expected 46 events, found %', v_count;
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE 'View event catalog:';
    RAISE NOTICE '  SELECT * FROM public.event_catalog ORDER BY event_name;';
    RAISE NOTICE '';
    RAISE NOTICE '================================================================';
END $$;
