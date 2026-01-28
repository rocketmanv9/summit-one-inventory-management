-- =====================================================================
-- Receiving Workflow Test & Seed Data
-- Date: 2026-01-28
-- Description: Complete test scenarios with seed data
-- =====================================================================

-- =====================================================================
-- SETUP: Test Data (Run this first)
-- =====================================================================

-- Note: Replace 'YOUR-TENANT-ID' with actual tenant ID from auth.users or tenants table

-- 1. Create test vendor
INSERT INTO supply_chain.vendors (tenant_id, name, code, status, last_event_id)
VALUES ('YOUR-TENANT-ID', 'ACME Concrete Supply', 'ACME', 'active', 'seed-vendor-acme-1')
ON CONFLICT (tenant_id, last_event_id) DO NOTHING
RETURNING id;
-- Save as: @vendor_id

-- 2. Create test locations
INSERT INTO inventory.locations (tenant_id, name, code, location_type, status, last_event_id)
VALUES 
  ('YOUR-TENANT-ID', 'Main Yard', 'YARD-01', 'yard', 'active', 'seed-loc-yard-1'),
  ('YOUR-TENANT-ID', 'Satellite Yard', 'YARD-02', 'yard', 'active', 'seed-loc-yard-2')
ON CONFLICT (tenant_id, last_event_id) DO NOTHING
RETURNING id, name;
-- Save: @main_yard_id, @satellite_yard_id

-- 3. Create test catalog items
INSERT INTO inventory.catalog_items (tenant_id, name, sku, description, unit_of_measure, item_type, status, last_event_id)
VALUES 
  ('YOUR-TENANT-ID', 'Asphalt Mix - Type A', 'ASP-A', 'Hot mix asphalt for paving', 'ton', 'fungible', 'active', 'seed-item-asp-1'),
  ('YOUR-TENANT-ID', 'Concrete - 3000 PSI', 'CONC-3000', 'Ready-mix concrete', 'cubic yard', 'fungible', 'active', 'seed-item-conc-1'),
  ('YOUR-TENANT-ID', 'Gravel - 3/4 inch', 'GRAV-34', 'Crushed gravel aggregate', 'ton', 'fungible', 'active', 'seed-item-grav-1')
ON CONFLICT (tenant_id, last_event_id) DO NOTHING
RETURNING id, name;
-- Save: @asphalt_id, @concrete_id, @gravel_id

-- 4. Create test purchase order
INSERT INTO supply_chain.purchase_orders (
  tenant_id, po_number, vendor_id, order_date, expected_delivery_date, 
  delivery_location_id, delivery_method, status, last_event_id
)
VALUES (
  'YOUR-TENANT-ID', 
  'PO-TEST-2026-001', 
  '@vendor_id', 
  CURRENT_DATE - INTERVAL '5 days',
  CURRENT_DATE + INTERVAL '2 days',
  '@main_yard_id',
  'delivery',
  'placed',
  'seed-po-test-1'
)
ON CONFLICT (tenant_id, last_event_id) DO NOTHING
RETURNING id;
-- Save: @po_id

-- 5. Create PO lines
INSERT INTO supply_chain.purchase_order_lines (
  tenant_id, po_id, line_number, catalog_item_id, qty_ordered, 
  unit_cost, unit_of_measure, allow_over_delivery, status, last_event_id
)
VALUES 
  ('YOUR-TENANT-ID', '@po_id', 1, '@asphalt_id', 100, 75.00, 'ton', true, 'open', 'seed-pol-1'),
  ('YOUR-TENANT-ID', '@po_id', 2, '@concrete_id', 50, 120.00, 'cubic yard', false, 'open', 'seed-pol-2'),
  ('YOUR-TENANT-ID', '@po_id', 3, '@gravel_id', 200, 25.00, 'ton', true, 'open', 'seed-pol-3')
ON CONFLICT (tenant_id, last_event_id) DO NOTHING
RETURNING id, line_number;
-- Save: @po_line_1, @po_line_2, @po_line_3

-- =====================================================================
-- TEST 1: Full Delivery (100% received, all accepted)
-- =====================================================================

SELECT supply_chain.rpc_create_receipt_v2(
  p_receipt_number := 'RCV-TEST-001',
  p_location_id := '@main_yard_id',
  p_po_id := '@po_id',
  p_vendor_id := '@vendor_id',
  p_received_at := now(),
  p_packing_slip_no := 'PS-12345',
  p_source_type := 'delivery',
  p_status := 'confirmed',
  p_auto_post := true,
  p_lines := jsonb_build_array(
    jsonb_build_object(
      'catalog_item_id', '@asphalt_id',
      'qty_received', 100,
      'po_line_id', '@po_line_1',
      'condition_status', 'accepted',
      'unit_cost_actual', 75.00,
      'uom', 'ton'
    )
  )
);

-- Verify:
SELECT 
  pol.qty_ordered, 
  pol.qty_received, 
  pol.status,
  pol.qty_ordered - pol.qty_received AS qty_remaining
FROM supply_chain.purchase_order_lines pol
WHERE pol.id = '@po_line_1';
-- Expected: qty_received=100, status='fully_received', remaining=0

SELECT qty_on_hand, qty_available
FROM inventory.stock_balances
WHERE tenant_id = 'YOUR-TENANT-ID'
  AND catalog_item_id = '@asphalt_id'
  AND location_id = '@main_yard_id';
-- Expected: qty_on_hand=100

-- =====================================================================
-- TEST 2: Partial Delivery (50 out of 50, then 30 more)
-- =====================================================================

-- First partial delivery
SELECT supply_chain.rpc_create_receipt_v2(
  p_receipt_number := 'RCV-TEST-002A',
  p_location_id := '@main_yard_id',
  p_po_id := '@po_id',
  p_lines := jsonb_build_array(
    jsonb_build_object(
      'catalog_item_id', '@concrete_id',
      'qty_received', 30,
      'po_line_id', '@po_line_2',
      'condition_status', 'accepted'
    )
  )
);

-- Verify partial status
SELECT qty_ordered, qty_received, status
FROM supply_chain.purchase_order_lines
WHERE id = '@po_line_2';
-- Expected: qty_received=30, status='partially_received'

-- Second partial delivery
SELECT supply_chain.rpc_create_receipt_v2(
  p_receipt_number := 'RCV-TEST-002B',
  p_location_id := '@main_yard_id',
  p_po_id := '@po_id',
  p_lines := jsonb_build_array(
    jsonb_build_object(
      'catalog_item_id', '@concrete_id',
      'qty_received', 20,
      'po_line_id', '@po_line_2',
      'condition_status', 'accepted'
    )
  )
);

-- Verify fully received
SELECT qty_ordered, qty_received, status
FROM supply_chain.purchase_order_lines
WHERE id = '@po_line_2';
-- Expected: qty_received=50, status='fully_received'

-- =====================================================================
-- TEST 3: Over-Delivery (210 received vs 200 ordered)
-- =====================================================================

SELECT supply_chain.rpc_create_receipt_v2(
  p_receipt_number := 'RCV-TEST-003',
  p_location_id := '@main_yard_id',
  p_po_id := '@po_id',
  p_notes := 'Vendor sent extra - full truckload',
  p_lines := jsonb_build_array(
    jsonb_build_object(
      'catalog_item_id', '@gravel_id',
      'qty_received', 210,  -- More than ordered (200)
      'po_line_id', '@po_line_3',
      'condition_status', 'accepted'
    )
  )
);

-- Verify over-delivery accepted
SELECT 
  qty_ordered, 
  qty_received, 
  qty_received - qty_ordered AS over_qty,
  allow_over_delivery,
  status
FROM supply_chain.purchase_order_lines
WHERE id = '@po_line_3';
-- Expected: qty_received=210, over_qty=10, allow_over_delivery=true, status='fully_received'

-- =====================================================================
-- TEST 4: Damaged Items (90 accepted, 10 damaged)
-- =====================================================================

-- Create new PO for this test
INSERT INTO supply_chain.purchase_orders (
  tenant_id, po_number, vendor_id, order_date, delivery_location_id, status, last_event_id
)
VALUES ('YOUR-TENANT-ID', 'PO-TEST-004', '@vendor_id', CURRENT_DATE, '@main_yard_id', 'placed', 'seed-po-4')
ON CONFLICT (tenant_id, last_event_id) DO NOTHING
RETURNING id;
-- Save: @po_id_4

INSERT INTO supply_chain.purchase_order_lines (
  tenant_id, po_id, line_number, catalog_item_id, qty_ordered, unit_cost, status, last_event_id
)
VALUES ('YOUR-TENANT-ID', '@po_id_4', 1, '@asphalt_id', 100, 75.00, 'open', 'seed-pol-4-1')
ON CONFLICT (tenant_id, last_event_id) DO NOTHING
RETURNING id;
-- Save: @po_line_4

-- Receipt with damaged items
SELECT supply_chain.rpc_create_receipt_v2(
  p_receipt_number := 'RCV-TEST-004',
  p_location_id := '@main_yard_id',
  p_po_id := '@po_id_4',
  p_notes := 'Some bags torn during delivery',
  p_lines := jsonb_build_array(
    jsonb_build_object(
      'catalog_item_id', '@asphalt_id',
      'qty_received', 90,
      'po_line_id', '@po_line_4',
      'condition_status', 'accepted'
    ),
    jsonb_build_object(
      'catalog_item_id', '@asphalt_id',
      'qty_received', 10,
      'po_line_id', '@po_line_4',
      'condition_status', 'damaged',
      'notes', 'Torn bags - still usable but flagged'
    )
  )
);

-- Verify both lines posted
SELECT 
  movement_type,
  quantity_delta,
  notes
FROM inventory.stock_movements
WHERE tenant_id = 'YOUR-TENANT-ID'
  AND source_ref_type = 'receipt'
  AND catalog_item_id = '@asphalt_id'
ORDER BY occurred_at DESC
LIMIT 2;
-- Expected: 1 'received' (90), 1 'damaged' (10)

-- =====================================================================
-- TEST 5: Rejected Items (80 accepted, 20 rejected)
-- =====================================================================

INSERT INTO supply_chain.purchase_orders (
  tenant_id, po_number, vendor_id, order_date, delivery_location_id, status, last_event_id
)
VALUES ('YOUR-TENANT-ID', 'PO-TEST-005', '@vendor_id', CURRENT_DATE, '@main_yard_id', 'placed', 'seed-po-5')
ON CONFLICT (tenant_id, last_event_id) DO NOTHING
RETURNING id;
-- Save: @po_id_5

INSERT INTO supply_chain.purchase_order_lines (
  tenant_id, po_id, line_number, catalog_item_id, qty_ordered, unit_cost, status, last_event_id
)
VALUES ('YOUR-TENANT-ID', '@po_id_5', 1, '@concrete_id', 100, 120.00, 'open', 'seed-pol-5-1')
ON CONFLICT (tenant_id, last_event_id) DO NOTHING
RETURNING id;
-- Save: @po_line_5

-- Receipt with rejected items
SELECT supply_chain.rpc_create_receipt_v2(
  p_receipt_number := 'RCV-TEST-005',
  p_location_id := '@main_yard_id',
  p_po_id := '@po_id_5',
  p_notes := 'Wrong mix specification',
  p_lines := jsonb_build_array(
    jsonb_build_object(
      'catalog_item_id', '@concrete_id',
      'qty_received', 80,
      'po_line_id', '@po_line_5',
      'condition_status', 'accepted'
    ),
    jsonb_build_object(
      'catalog_item_id', '@concrete_id',
      'qty_received', 20,
      'po_line_id', '@po_line_5',
      'condition_status', 'rejected',
      'notes', 'Wrong PSI - returning to vendor'
    )
  )
);

-- Verify only 80 added to inventory
SELECT SUM(quantity_delta) AS total_received
FROM inventory.stock_movements
WHERE tenant_id = 'YOUR-TENANT-ID'
  AND source_ref_type = 'receipt'
  AND catalog_item_id = '@concrete_id'
  AND movement_type = 'received';
-- Expected: 80 (rejected items not included)

-- Check PO line status
SELECT qty_ordered, qty_received, status
FROM supply_chain.purchase_order_lines
WHERE id = '@po_line_5';
-- Expected: qty_received=80 (not 100), status='partially_received'

-- =====================================================================
-- TEST 6: Quick Receive (No PO)
-- =====================================================================

SELECT supply_chain.rpc_create_receipt_v2(
  p_receipt_number := 'RCV-QUICK-001',
  p_location_id := '@main_yard_id',
  p_po_id := NULL,  -- No PO
  p_vendor_id := '@vendor_id',
  p_source_type := 'pickup',
  p_notes := 'Emergency purchase - no PO created',
  p_lines := jsonb_build_array(
    jsonb_build_object(
      'catalog_item_id', '@asphalt_id',
      'qty_received', 5,
      'po_line_id', NULL,  -- No PO line
      'condition_status', 'accepted',
      'unit_cost_actual', 80.00,
      'uom', 'ton',
      'notes', 'Cash purchase for urgent job'
    )
  )
);

-- Verify inventory updated
SELECT qty_on_hand
FROM inventory.stock_balances
WHERE tenant_id = 'YOUR-TENANT-ID'
  AND catalog_item_id = '@asphalt_id'
  AND location_id = '@main_yard_id';
-- Expected: qty_on_hand increased by 5

-- =====================================================================
-- TEST 7: Line-Level Location Splitting
-- =====================================================================

SELECT supply_chain.rpc_create_receipt_v2(
  p_receipt_number := 'RCV-SPLIT-001',
  p_location_id := '@main_yard_id',  -- Default location
  p_po_id := '@po_id',
  p_notes := 'Delivery split between yards',
  p_lines := jsonb_build_array(
    jsonb_build_object(
      'catalog_item_id', '@gravel_id',
      'qty_received', 100,
      'destination_location_id', '@main_yard_id'  -- Explicit
    ),
    jsonb_build_object(
      'catalog_item_id', '@gravel_id',
      'qty_received', 50,
      'destination_location_id', '@satellite_yard_id'  -- Different location
    )
  )
);

-- Verify split
SELECT 
  l.name AS location_name,
  sb.qty_on_hand
FROM inventory.stock_balances sb
JOIN inventory.locations l ON l.id = sb.location_id
WHERE sb.tenant_id = 'YOUR-TENANT-ID'
  AND sb.catalog_item_id = '@gravel_id'
ORDER BY l.name;
-- Expected: Main Yard=100, Satellite Yard=50

-- =====================================================================
-- TEST 8: Draft → Confirm Workflow
-- =====================================================================

-- Create draft receipt
SELECT supply_chain.rpc_create_receipt_v2(
  p_receipt_number := 'RCV-DRAFT-001',
  p_location_id := '@main_yard_id',
  p_po_id := '@po_id',
  p_status := 'draft',  -- Save as draft
  p_auto_post := false,  -- Don't post yet
  p_lines := jsonb_build_array(
    jsonb_build_object(
      'catalog_item_id', '@asphalt_id',
      'qty_received', 25
    )
  )
);
-- Save: @draft_receipt_id

-- Validate before confirming
SELECT supply_chain.rpc_validate_receipt('@draft_receipt_id');
-- Expected: { valid: true, errors: [], warnings: [] }

-- Confirm (post to inventory)
SELECT supply_chain.rpc_confirm_receipt('@draft_receipt_id');

-- Verify status changed and inventory updated
SELECT status FROM supply_chain.receipts WHERE id = '@draft_receipt_id';
-- Expected: status='confirmed'

-- =====================================================================
-- TEST 9: Idempotency Test
-- =====================================================================

-- Try to create same receipt twice (should fail on second attempt)
DO $$
DECLARE
  v_result1 JSONB;
  v_result2 JSONB;
BEGIN
  -- First attempt
  v_result1 := supply_chain.rpc_create_receipt_v2(
    p_receipt_number := 'RCV-IDEM-TEST',
    p_location_id := '@main_yard_id',
    p_lines := jsonb_build_array(
      jsonb_build_object('catalog_item_id', '@asphalt_id', 'qty_received', 10)
    )
  );
  
  RAISE NOTICE 'First attempt: %', v_result1;
  
  -- Second attempt (should fail or return idempotent response)
  BEGIN
    v_result2 := supply_chain.rpc_create_receipt_v2(
      p_receipt_number := 'RCV-IDEM-TEST',
      p_location_id := '@main_yard_id',
      p_lines := jsonb_build_array(
        jsonb_build_object('catalog_item_id', '@asphalt_id', 'qty_received', 10)
      )
    );
    
    RAISE NOTICE 'Second attempt: %', v_result2;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'Second attempt failed (expected): %', SQLERRM;
  END;
END $$;

-- Verify inventory only increased once
SELECT COUNT(*) AS receipt_count
FROM supply_chain.receipts
WHERE tenant_id = 'YOUR-TENANT-ID'
  AND receipt_number = 'RCV-IDEM-TEST';
-- Expected: 1

-- =====================================================================
-- CLEANUP (Optional)
-- =====================================================================

-- Delete test receipts
DELETE FROM supply_chain.receipts
WHERE tenant_id = 'YOUR-TENANT-ID'
  AND receipt_number LIKE 'RCV-TEST-%'
     OR receipt_number LIKE 'RCV-QUICK-%'
     OR receipt_number LIKE 'RCV-SPLIT-%'
     OR receipt_number LIKE 'RCV-DRAFT-%'
     OR receipt_number LIKE 'RCV-IDEM-%';

-- Delete test POs
DELETE FROM supply_chain.purchase_orders
WHERE tenant_id = 'YOUR-TENANT-ID'
  AND po_number LIKE 'PO-TEST-%';

-- Delete test catalog items, locations, vendors
-- (Cascade will handle related records)

-- =====================================================================
-- END OF TEST SUITE
-- =====================================================================
