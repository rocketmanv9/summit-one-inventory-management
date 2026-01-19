-- ============================================================================
-- Wire Up Real Inventory Domain Events
-- ============================================================================
-- This migration ensures key inventory events use emit_event() properly
-- ============================================================================

-- Register key inventory events in catalog
SELECT public.register_event(
    'inventory.item.created',
    1,
    'inventory',
    'Emitted when a new catalog item is created',
    '{"type":"object","required":["item_id","sku","name","tenant_id"],"properties":{"item_id":{"type":"string","format":"uuid"},"sku":{"type":"string"},"name":{"type":"string"},"category_id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"created_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"item_id":"123e4567-e89b-12d3-a456-426614174000","sku":"WIDGET-001","name":"Blue Widget","category_id":"789e4567-e89b-12d3-a456-426614174000","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","created_at":"2026-01-16T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'inventory.stock.adjusted',
    1,
    'inventory',
    'Emitted when stock levels change (adjustment, sale, receipt, etc)',
    '{"type":"object","required":["movement_id","item_id","location_id","quantity_change","new_balance","tenant_id"],"properties":{"movement_id":{"type":"string","format":"uuid"},"item_id":{"type":"string","format":"uuid"},"location_id":{"type":"string","format":"uuid"},"quantity_change":{"type":"integer"},"new_balance":{"type":"integer"},"movement_type":{"type":"string","enum":["adjustment","receipt","issue","transfer","count"]},"tenant_id":{"type":"string","format":"uuid"},"occurred_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"movement_id":"234e4567-e89b-12d3-a456-426614174000","item_id":"123e4567-e89b-12d3-a456-426614174000","location_id":"456e4567-e89b-12d3-a456-426614174000","quantity_change":-5,"new_balance":45,"movement_type":"issue","tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","occurred_at":"2026-01-16T12:00:00Z"}'::jsonb,
    'active'
);

SELECT public.register_event(
    'inventory.receipt.created',
    1,
    'inventory',
    'Emitted when goods are received against a PO',
    '{"type":"object","required":["receipt_id","po_id","vendor_location_id","tenant_id"],"properties":{"receipt_id":{"type":"string","format":"uuid"},"po_id":{"type":"string","format":"uuid"},"vendor_location_id":{"type":"string","format":"uuid"},"receipt_number":{"type":"string"},"received_date":{"type":"string","format":"date"},"line_items":{"type":"array","items":{"type":"object"}},"tenant_id":{"type":"string","format":"uuid"},"created_at":{"type":"string","format":"date-time"}}}'::jsonb,
    '{"receipt_id":"345e4567-e89b-12d3-a456-426614174000","po_id":"456e4567-e89b-12d3-a456-426614174000","vendor_location_id":"567e4567-e89b-12d3-a456-426614174000","receipt_number":"RCV-2026-001","received_date":"2026-01-16","line_items":[{"item_id":"123e4567-e89b-12d3-a456-426614174000","quantity_received":100}],"tenant_id":"ae837809-1a24-4ab5-ba06-34fd98c05f48","created_at":"2026-01-16T12:00:00Z"}'::jsonb,
    'active'
);

-- Verify registration
SELECT 
    event_name,
    event_version,
    status,
    producer
FROM public.event_catalog
WHERE event_name LIKE 'inventory.%'
ORDER BY event_name;

COMMENT ON FUNCTION public.register_event IS 'Registers inventory events in catalog - migration 20260116000012';
