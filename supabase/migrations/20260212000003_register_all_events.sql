-- =====================================================================
-- REGISTER ALL INVENTORY MICROSERVICE EVENTS
-- =====================================================================
-- Populates event_catalog with all events emitted by the inventory
-- microservice using the Summit Publisher Protocol v1.2
-- =====================================================================

-- =====================================================================
-- INVENTORY DOMAIN - Asset Management
-- =====================================================================

SELECT register_event(
  p_key := 'asset.created',
  p_name := 'Asset Created',
  p_desc := 'A new asset has been added to inventory',
  p_agg_type := 'asset',
  p_example := '{
    "asset_id": "123e4567-e89b-12d3-a456-426614174000",
    "asset_tag": "ASSET-001",
    "catalog_item_id": "987e6543-e21b-12d3-a456-426614174000",
    "status": "available",
    "home_location_id": "456e7890-e12b-12d3-a456-426614174000",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "created_at": "2026-02-12T10:30:00Z"
  }'::jsonb,
  p_schema := '{
    "type": "object",
    "required": ["asset_id", "asset_tag", "catalog_item_id", "status", "tenant_id"],
    "properties": {
      "asset_id": {"type": "string", "format": "uuid"},
      "asset_tag": {"type": "string"},
      "catalog_item_id": {"type": "string", "format": "uuid"},
      "status": {"type": "string", "enum": ["available", "in_use", "maintenance", "retired"]},
      "home_location_id": {"type": "string", "format": "uuid"},
      "tenant_id": {"type": "string", "format": "uuid"},
      "created_at": {"type": "string", "format": "date-time"}
    }
  }'::jsonb
);

SELECT register_event(
  p_key := 'asset.updated',
  p_name := 'Asset Updated',
  p_desc := 'An existing asset''s properties have been modified',
  p_agg_type := 'asset',
  p_example := '{
    "asset_id": "123e4567-e89b-12d3-a456-426614174000",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "changes": {
      "status": {"old": "available", "new": "in_use"},
      "home_location_id": {"old": "456e7890-e12b-12d3-a456-426614174000", "new": "789e0123-e45b-12d3-a456-426614174000"}
    },
    "updated_at": "2026-02-12T11:00:00Z"
  }'::jsonb,
  p_schema := '{
    "type": "object",
    "required": ["asset_id", "tenant_id", "changes", "updated_at"],
    "properties": {
      "asset_id": {"type": "string", "format": "uuid"},
      "tenant_id": {"type": "string", "format": "uuid"},
      "changes": {"type": "object"},
      "updated_at": {"type": "string", "format": "date-time"}
    }
  }'::jsonb
);

SELECT register_event(
  p_key := 'asset.retired',
  p_name := 'Asset Retired',
  p_desc := 'An asset has been permanently retired from service',
  p_agg_type := 'asset',
  p_example := '{
    "asset_id": "123e4567-e89b-12d3-a456-426614174000",
    "asset_tag": "ASSET-001",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "retired_at": "2026-02-12T12:00:00Z"
  }'::jsonb,
  p_schema := '{
    "type": "object",
    "required": ["asset_id", "asset_tag", "tenant_id", "retired_at"],
    "properties": {
      "asset_id": {"type": "string", "format": "uuid"},
      "asset_tag": {"type": "string"},
      "tenant_id": {"type": "string", "format": "uuid"},
      "retired_at": {"type": "string", "format": "date-time"}
    }
  }'::jsonb
);

-- =====================================================================
-- INVENTORY DOMAIN - Catalog Items
-- =====================================================================

SELECT register_event(
  p_key := 'inventory.item.created',
  p_name := 'Inventory Item Created',
  p_desc := 'A new catalog item has been added to the inventory',
  p_agg_type := 'catalog_item',
  p_example := '{
    "item_id": "987e6543-e21b-12d3-a456-426614174000",
    "sku": "SKU-12345",
    "name": "Asphalt Mix Type A",
    "category_id": "cat-123",
    "tracking_mode": "bulk",
    "unit_of_measure": "ton",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "created_at": "2026-02-12T09:00:00Z"
  }'::jsonb,
  p_schema := '{
    "type": "object",
    "required": ["item_id", "sku", "name", "tracking_mode", "tenant_id"],
    "properties": {
      "item_id": {"type": "string", "format": "uuid"},
      "sku": {"type": "string"},
      "name": {"type": "string"},
      "category_id": {"type": "string"},
      "tracking_mode": {"type": "string", "enum": ["serialized", "bulk"]},
      "unit_of_measure": {"type": "string"},
      "tenant_id": {"type": "string", "format": "uuid"},
      "created_at": {"type": "string", "format": "date-time"}
    }
  }'::jsonb
);

SELECT register_event(
  p_key := 'catalog_item.updated',
  p_name := 'Catalog Item Updated',
  p_desc := 'A catalog item''s properties have been modified',
  p_agg_type := 'catalog_item',
  p_example := '{
    "item_id": "987e6543-e21b-12d3-a456-426614174000",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "changes": {
      "name": {"old": "Asphalt Mix Type A", "new": "Asphalt Mix Type A (Premium)"},
      "unit_of_measure": {"old": "ton", "new": "metric ton"}
    },
    "updated_at": "2026-02-12T10:00:00Z"
  }'::jsonb
);

SELECT register_event(
  p_key := 'catalog_item.deactivated',
  p_name := 'Catalog Item Deactivated',
  p_desc := 'A catalog item has been deactivated and is no longer available for use',
  p_agg_type := 'catalog_item',
  p_example := '{
    "item_id": "987e6543-e21b-12d3-a456-426614174000",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "deactivated_at": "2026-02-12T13:00:00Z"
  }'::jsonb
);

SELECT register_event(
  p_key := 'catalog_item.reactivated',
  p_name := 'Catalog Item Reactivated',
  p_desc := 'A previously deactivated catalog item has been reactivated',
  p_agg_type := 'catalog_item',
  p_example := '{
    "item_id": "987e6543-e21b-12d3-a456-426614174000",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "reactivated_at": "2026-02-12T14:00:00Z"
  }'::jsonb
);

-- =====================================================================
-- INVENTORY DOMAIN - Locations
-- =====================================================================

SELECT register_event(
  p_key := 'location.created',
  p_name := 'Location Created',
  p_desc := 'A new location has been added to the system',
  p_agg_type := 'location',
  p_example := '{
    "location_id": "456e7890-e12b-12d3-a456-426614174000",
    "location_type_id": "warehouse",
    "name": "Main Warehouse - Bay 3",
    "parent_location_id": "parent-123",
    "address": "123 Industrial Pkwy, City, ST 12345",
    "external_ref": "WH-003",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "created_at": "2026-02-12T08:00:00Z",
    "created_by": "user-123"
  }'::jsonb,
  p_schema := '{
    "type": "object",
    "required": ["location_id", "location_type_id", "name", "tenant_id"],
    "properties": {
      "location_id": {"type": "string", "format": "uuid"},
      "location_type_id": {"type": "string"},
      "name": {"type": "string"},
      "parent_location_id": {"type": "string"},
      "address": {"type": "string"},
      "external_ref": {"type": "string"},
      "tenant_id": {"type": "string", "format": "uuid"},
      "created_at": {"type": "string", "format": "date-time"},
      "created_by": {"type": "string"}
    }
  }'::jsonb
);

SELECT register_event(
  p_key := 'location.updated',
  p_name := 'Location Updated',
  p_desc := 'A location''s properties have been modified',
  p_agg_type := 'location',
  p_example := '{
    "location_id": "456e7890-e12b-12d3-a456-426614174000",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "changes": {
      "name": {"old": "Main Warehouse - Bay 3", "new": "Main Warehouse - Bay 3A"},
      "address": {"old": "123 Industrial Pkwy", "new": "123 Industrial Pkwy, Suite 100"}
    },
    "updated_at": "2026-02-12T09:30:00Z",
    "updated_by": "user-456"
  }'::jsonb
);

SELECT register_event(
  p_key := 'location.deactivated',
  p_name := 'Location Deactivated',
  p_desc := 'A location has been deactivated and is no longer in use',
  p_agg_type := 'location',
  p_example := '{
    "location_id": "456e7890-e12b-12d3-a456-426614174000",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "deactivated_at": "2026-02-12T15:00:00Z",
    "deactivated_by": "user-789"
  }'::jsonb
);

-- =====================================================================
-- SUPPLY CHAIN DOMAIN - Vendors
-- =====================================================================

SELECT register_event(
  p_key := 'supply_chain.vendor.created',
  p_name := 'Vendor Created',
  p_desc := 'A new vendor has been added to the supply chain',
  p_agg_type := 'vendor',
  p_example := '{
    "vendor_id": "vendor-123",
    "vendor_code": "VEND-001",
    "vendor_name": "ACME Materials Supply Co.",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "created_at": "2026-02-12T07:00:00Z"
  }'::jsonb,
  p_schema := '{
    "type": "object",
    "required": ["vendor_id", "vendor_code", "vendor_name", "tenant_id"],
    "properties": {
      "vendor_id": {"type": "string"},
      "vendor_code": {"type": "string"},
      "vendor_name": {"type": "string"},
      "tenant_id": {"type": "string", "format": "uuid"},
      "created_at": {"type": "string", "format": "date-time"}
    }
  }'::jsonb
);

SELECT register_event(
  p_key := 'supply_chain.vendor.deactivated',
  p_name := 'Vendor Deactivated',
  p_desc := 'A vendor has been deactivated and is no longer available for new orders',
  p_agg_type := 'vendor',
  p_example := '{
    "vendor_id": "vendor-123",
    "vendor_code": "VEND-001",
    "vendor_name": "ACME Materials Supply Co.",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "deactivated_at": "2026-02-12T16:00:00Z"
  }'::jsonb
);

SELECT register_event(
  p_key := 'supply_chain.vendor.reactivated',
  p_name := 'Vendor Reactivated',
  p_desc := 'A previously deactivated vendor has been reactivated',
  p_agg_type := 'vendor',
  p_example := '{
    "vendor_id": "vendor-123",
    "vendor_code": "VEND-001",
    "vendor_name": "ACME Materials Supply Co.",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "reactivated_at": "2026-02-12T17:00:00Z"
  }'::jsonb
);

-- =====================================================================
-- SUPPLY CHAIN DOMAIN - Purchase Orders
-- =====================================================================

SELECT register_event(
  p_key := 'supply_chain.purchase_order.created',
  p_name := 'Purchase Order Created',
  p_desc := 'A new purchase order has been created',
  p_agg_type := 'purchase_order',
  p_example := '{
    "po_id": "po-123",
    "po_number": "PO-2026-001",
    "vendor_id": "vendor-123",
    "vendor_name": "ACME Materials Supply Co.",
    "vendor_code": "VEND-001",
    "total_lines": 5,
    "delivery_location_id": "loc-456",
    "expected_delivery_date": "2026-02-20",
    "status": "draft",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "created_at": "2026-02-12T08:30:00Z"
  }'::jsonb,
  p_schema := '{
    "type": "object",
    "required": ["po_id", "po_number", "vendor_id", "status", "tenant_id"],
    "properties": {
      "po_id": {"type": "string"},
      "po_number": {"type": "string"},
      "vendor_id": {"type": "string"},
      "vendor_name": {"type": "string"},
      "vendor_code": {"type": "string"},
      "total_lines": {"type": "integer"},
      "delivery_location_id": {"type": "string"},
      "expected_delivery_date": {"type": "string", "format": "date"},
      "status": {"type": "string"},
      "tenant_id": {"type": "string", "format": "uuid"},
      "created_at": {"type": "string", "format": "date-time"}
    }
  }'::jsonb
);

SELECT register_event(
  p_key := 'supply_chain.purchase_order.submitted',
  p_name := 'Purchase Order Submitted',
  p_desc := 'A purchase order has been submitted for approval',
  p_agg_type := 'purchase_order',
  p_example := '{
    "po_id": "po-123",
    "po_number": "PO-2026-001",
    "vendor_id": "vendor-123",
    "vendor_name": "ACME Materials Supply Co.",
    "vendor_code": "VEND-001",
    "total_lines": 5,
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "submitted_at": "2026-02-12T09:00:00Z"
  }'::jsonb
);

SELECT register_event(
  p_key := 'supply_chain.purchase_order.approved',
  p_name := 'Purchase Order Approved',
  p_desc := 'A purchase order has been approved and sent to the vendor',
  p_agg_type := 'purchase_order',
  p_example := '{
    "po_id": "po-123",
    "po_number": "PO-2026-001",
    "vendor_id": "vendor-123",
    "vendor_name": "ACME Materials Supply Co.",
    "vendor_code": "VEND-001",
    "total_lines": 5,
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "approved_at": "2026-02-12T10:00:00Z"
  }'::jsonb
);

SELECT register_event(
  p_key := 'supply_chain.purchase_order.rejected',
  p_name := 'Purchase Order Rejected',
  p_desc := 'A purchase order has been rejected during approval',
  p_agg_type := 'purchase_order',
  p_example := '{
    "po_id": "po-123",
    "po_number": "PO-2026-001",
    "vendor_id": "vendor-123",
    "vendor_name": "ACME Materials Supply Co.",
    "vendor_code": "VEND-001",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "rejected_at": "2026-02-12T10:15:00Z"
  }'::jsonb
);

SELECT register_event(
  p_key := 'supply_chain.purchase_order.cancelled',
  p_name := 'Purchase Order Cancelled',
  p_desc := 'A purchase order has been cancelled',
  p_agg_type := 'purchase_order',
  p_example := '{
    "po_id": "po-123",
    "po_number": "PO-2026-001",
    "vendor_id": "vendor-123",
    "vendor_name": "ACME Materials Supply Co.",
    "vendor_code": "VEND-001",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "cancelled_at": "2026-02-12T11:00:00Z"
  }'::jsonb
);

SELECT register_event(
  p_key := 'supply_chain.purchase_order.in_transit',
  p_name := 'Purchase Order In Transit',
  p_desc := 'A purchase order has been shipped and is in transit',
  p_agg_type := 'purchase_order',
  p_example := '{
    "po_id": "po-123",
    "po_number": "PO-2026-001",
    "vendor_id": "vendor-123",
    "vendor_name": "ACME Materials Supply Co.",
    "vendor_code": "VEND-001",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "shipped_at": "2026-02-15T08:00:00Z"
  }'::jsonb
);

SELECT register_event(
  p_key := 'supply_chain.purchase_order.received',
  p_name := 'Purchase Order Received',
  p_desc := 'A purchase order has been fully received',
  p_agg_type := 'purchase_order',
  p_example := '{
    "po_id": "po-123",
    "po_number": "PO-2026-001",
    "vendor_id": "vendor-123",
    "vendor_name": "ACME Materials Supply Co.",
    "vendor_code": "VEND-001",
    "total_lines": 5,
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "received_at": "2026-02-20T14:30:00Z"
  }'::jsonb
);

SELECT register_event(
  p_key := 'supply_chain.purchase_order.closed',
  p_name := 'Purchase Order Closed',
  p_desc := 'A purchase order has been closed and finalized',
  p_agg_type := 'purchase_order',
  p_example := '{
    "po_id": "po-123",
    "po_number": "PO-2026-001",
    "vendor_id": "vendor-123",
    "vendor_name": "ACME Materials Supply Co.",
    "vendor_code": "VEND-001",
    "total_lines": 5,
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "closed_at": "2026-02-21T10:00:00Z"
  }'::jsonb
);

-- =====================================================================
-- SUPPLY CHAIN DOMAIN - Receipts
-- =====================================================================

SELECT register_event(
  p_key := 'supply_chain.receipt.created',
  p_name := 'Receipt Created',
  p_desc := 'A new receipt has been created for received goods',
  p_agg_type := 'receipt',
  p_example := '{
    "receipt_id": "rcpt-123",
    "receipt_number": "RCV-2026-001",
    "location_id": "loc-456",
    "po_id": "po-123",
    "vendor_id": "vendor-123",
    "vendor_name": "ACME Materials Supply Co.",
    "vendor_code": "VEND-001",
    "received_by_user_id": "user-789",
    "tenant_id": "111e1111-e11b-11d1-a111-111111111111",
    "received_at": "2026-02-20T14:30:00Z"
  }'::jsonb,
  p_schema := '{
    "type": "object",
    "required": ["receipt_id", "receipt_number", "location_id", "tenant_id"],
    "properties": {
      "receipt_id": {"type": "string"},
      "receipt_number": {"type": "string"},
      "location_id": {"type": "string"},
      "po_id": {"type": "string"},
      "vendor_id": {"type": "string"},
      "vendor_name": {"type": "string"},
      "vendor_code": {"type": "string"},
      "received_by_user_id": {"type": "string"},
      "tenant_id": {"type": "string", "format": "uuid"},
      "received_at": {"type": "string", "format": "date-time"}
    }
  }'::jsonb
);

-- =====================================================================
-- UPDATE summit_config
-- =====================================================================

-- Update publisher_id to reflect this specific service
INSERT INTO public.summit_config (key, value) VALUES
  ('publisher_id', 'inventory-summit-dev')
ON CONFLICT (key) DO UPDATE 
SET value = EXCLUDED.value;

-- =====================================================================
-- VERIFICATION
-- =====================================================================

DO $$
DECLARE
  v_event_count INT;
BEGIN
  SELECT COUNT(*) INTO v_event_count FROM public.event_catalog;
  
  RAISE NOTICE '========================================';
  RAISE NOTICE 'EVENT CATALOG POPULATED';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Total Events Registered: %', v_event_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Event Breakdown:';
  RAISE NOTICE '  • Asset Events: 3';
  RAISE NOTICE '  • Catalog Item Events: 4';
  RAISE NOTICE '  • Location Events: 3';
  RAISE NOTICE '  • Vendor Events: 3';
  RAISE NOTICE '  • Purchase Order Events: 8';
  RAISE NOTICE '  • Receipt Events: 1';
  RAISE NOTICE '';
  RAISE NOTICE 'Publisher: inventory-summit-dev';
  RAISE NOTICE 'Protocol Version: 1.2';
  RAISE NOTICE '========================================';
END
$$;
