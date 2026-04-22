-- Test event emission - verify triggers work
-- Run this to see events being created in real-time

-- Clear existing test events
TRUNCATE inventory.events_outbox;

-- Test 1: Create a catalog item (should emit inventory.item.created)
INSERT INTO inventory.catalog_items (tenant_id, sku, name, tracking_mode, uom, category_id)
VALUES (
    'ae837809-1a24-4ab5-ba06-34fd98c05f48',
    'TEST-001',
    'Test Widget',
    'stock',
    'EA',
    (SELECT id FROM inventory.item_categories LIMIT 1)
);

-- Test 2: Create a location (should emit location.created)
INSERT INTO inventory.locations (tenant_id, location_type, name)
VALUES (
    'ae837809-1a24-4ab5-ba06-34fd98c05f48',
    'warehouse',
    'Test Warehouse'
);

-- Test 3: Create a vendor (should emit vendor.created)
INSERT INTO inventory.vendors (tenant_id, name, vendor_code)
VALUES (
    'ae837809-1a24-4ab5-ba06-34fd98c05f48',
    'Test Vendor Inc',
    'TV001'
);

-- Test 4: Update catalog item (should emit catalog_item.updated)
UPDATE inventory.catalog_items
SET name = 'Test Widget Pro'
WHERE sku = 'TEST-001';

-- Test 5: Deactivate catalog item (should emit catalog_item.deactivated)
UPDATE inventory.catalog_items
SET active = FALSE
WHERE sku = 'TEST-001';

-- View all events created
SELECT 
    event_type,
    payload->>'item_id' as item_id,
    payload->>'location_id' as location_id,
    payload->>'vendor_id' as vendor_id,
    LEFT(payload::text, 100) as payload_preview,
    status,
    created_at
FROM inventory.events_outbox
ORDER BY created_at DESC;

-- Count events by type
SELECT 
    event_type,
    COUNT(*) as count,
    status
FROM inventory.events_outbox
GROUP BY event_type, status
ORDER BY event_type;
