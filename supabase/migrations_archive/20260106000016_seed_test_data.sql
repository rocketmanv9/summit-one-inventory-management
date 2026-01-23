-- =====================================================
-- SEED DATA FOR TENANT: ae837809-1a24-4ab5-ba06-34fd98c05f48
-- =====================================================
-- This migration seeds comprehensive data for testing dashboards and widgets

-- Set the tenant ID
DO $$
DECLARE
    v_tenant_id UUID := 'ae837809-1a24-4ab5-ba06-34fd98c05f48';
    v_category_pipe UUID;
    v_category_electrical UUID;
    v_category_lumber UUID;
    v_category_fasteners UUID;
    v_category_tools UUID;
    v_category_safety UUID;
    
    v_item_pvc_pipe UUID;
    v_item_copper_pipe UUID;
    v_item_wire_12_2 UUID;
    v_item_wire_14_2 UUID;
    v_item_2x4_lumber UUID;
    v_item_plywood UUID;
    v_item_screws_wood UUID;
    v_item_nails UUID;
    v_item_drill_bits UUID;
    v_item_hard_hat UUID;
    v_item_safety_vest UUID;
    v_item_gloves UUID;
    
    v_loc_main_yard UUID;
    v_loc_warehouse_a UUID;
    v_loc_warehouse_b UUID;
    v_loc_truck_1 UUID;
    v_loc_truck_2 UUID;
    v_loc_job_oakdale UUID;
    v_loc_job_riverside UUID;
    
    v_vendor_acme UUID;
    v_vendor_builders UUID;
    v_vendor_supply_co UUID;
    
    v_po_1 UUID;
    v_po_2 UUID;
    v_po_3 UUID;
BEGIN
    -- =====================================================
    -- 1. ITEM CATEGORIES
    -- =====================================================
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
    (gen_random_uuid(), v_tenant_id, 'Pipe & Fittings') RETURNING id INTO v_category_pipe;
    
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
    (gen_random_uuid(), v_tenant_id, 'Electrical') RETURNING id INTO v_category_electrical;
    
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
    (gen_random_uuid(), v_tenant_id, 'Lumber & Building Materials') RETURNING id INTO v_category_lumber;
    
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
    (gen_random_uuid(), v_tenant_id, 'Fasteners & Hardware') RETURNING id INTO v_category_fasteners;
    
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
    (gen_random_uuid(), v_tenant_id, 'Tools & Equipment') RETURNING id INTO v_category_tools;
    
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
    (gen_random_uuid(), v_tenant_id, 'Safety Equipment') RETURNING id INTO v_category_safety;
    
    -- =====================================================
    -- 2. LOCATIONS
    -- =====================================================
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'yard', 'Main Yard - Central Ave', true) RETURNING id INTO v_loc_main_yard;
    
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'warehouse', 'Warehouse A - Indoor Storage', true) RETURNING id INTO v_loc_warehouse_a;
    
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'warehouse', 'Warehouse B - Outdoor Yard', true) RETURNING id INTO v_loc_warehouse_b;
    
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'truck', 'Service Truck #1 (Ford F-350)', true) RETURNING id INTO v_loc_truck_1;
    
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'truck', 'Service Truck #2 (Chevy 3500)', true) RETURNING id INTO v_loc_truck_2;
    
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'job', 'Oakdale Residential Development', true) RETURNING id INTO v_loc_job_oakdale;
    
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'job', 'Riverside Commercial Plaza', true) RETURNING id INTO v_loc_job_riverside;
    
    -- =====================================================
    -- 3. VENDORS
    -- =====================================================
    INSERT INTO inventory.vendors (id, tenant_id, name, code, contact_email, contact_phone, payment_terms, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'ACME Building Supply', 'ACME', 'orders@acmesupply.com', '555-0100', 'Net 30', true) RETURNING id INTO v_vendor_acme;
    
    INSERT INTO inventory.vendors (id, tenant_id, name, code, contact_email, contact_phone, payment_terms, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'Builders Warehouse Inc', 'BWI', 'sales@builderswarehouse.com', '555-0200', 'Net 45', true) RETURNING id INTO v_vendor_builders;
    
    INSERT INTO inventory.vendors (id, tenant_id, name, code, contact_email, contact_phone, payment_terms, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'Industrial Supply Co', 'ISC', 'support@indsupply.com', '555-0300', 'Net 30', true) RETURNING id INTO v_vendor_supply_co;
    
    -- =====================================================
    -- 4. CATALOG ITEMS
    -- =====================================================
    
    -- Pipe & Fittings
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, pack_size, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'PVC-100-1', 'PVC Pipe 1" x 10ft', 'stock', 'EA', v_category_pipe, true, 50, 100, 200, 10, 7, v_vendor_acme) RETURNING id INTO v_item_pvc_pipe;
    
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, pack_size, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'COP-075-10', 'Copper Pipe 3/4" x 10ft', 'stock', 'EA', v_category_pipe, true, 30, 60, 100, 10, 14, v_vendor_builders) RETURNING id INTO v_item_copper_pipe;
    
    -- Electrical
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, pack_size, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'WIRE-12-2-250', '12/2 NM-B Wire 250ft Roll', 'stock', 'ROLL', v_category_electrical, true, 10, 20, 50, 5, 10, v_vendor_supply_co) RETURNING id INTO v_item_wire_12_2;
    
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, pack_size, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'WIRE-14-2-250', '14/2 NM-B Wire 250ft Roll', 'stock', 'ROLL', v_category_electrical, true, 15, 30, 50, 5, 10, v_vendor_supply_co) RETURNING id INTO v_item_wire_14_2;
    
    -- Lumber
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, pack_size, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, '2X4-8-SPF', '2x4x8 SPF Stud', 'stock', 'EA', v_category_lumber, true, 200, 400, 500, 50, 5, v_vendor_builders) RETURNING id INTO v_item_2x4_lumber;
    
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, pack_size, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'PLY-48-34', '3/4" 4x8 Plywood Sheet', 'stock', 'SHEET', v_category_lumber, true, 50, 100, 150, 25, 7, v_vendor_builders) RETURNING id INTO v_item_plywood;
    
    -- Fasteners
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, pack_size, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'SCR-WOOD-3-1LB', '#8 3" Wood Screws 1lb Box', 'stock', 'BOX', v_category_fasteners, true, 100, 200, 300, 25, 7, v_vendor_acme) RETURNING id INTO v_item_screws_wood;
    
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, pack_size, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'NAIL-16D-5LB', '16D Common Nails 5lb Box', 'stock', 'BOX', v_category_fasteners, true, 50, 100, 150, 20, 5, v_vendor_acme) RETURNING id INTO v_item_nails;
    
    -- Tools
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, pack_size, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'DRILL-BIT-SET', 'Drill Bit Set 29pc', 'stock', 'SET', v_category_tools, true, 5, 10, 20, 5, 14, v_vendor_supply_co) RETURNING id INTO v_item_drill_bits;
    
    -- Safety
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, pack_size, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'SAFE-HAT-WHT', 'Hard Hat - White', 'stock', 'EA', v_category_safety, true, 20, 40, 50, 10, 7, v_vendor_supply_co) RETURNING id INTO v_item_hard_hat;
    
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, pack_size, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'SAFE-VEST-ORG', 'Safety Vest - Orange', 'stock', 'EA', v_category_safety, true, 30, 60, 100, 20, 5, v_vendor_supply_co) RETURNING id INTO v_item_safety_vest;
    
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, pack_size, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'SAFE-GLOVE-L', 'Work Gloves - Large', 'stock', 'PAIR', v_category_safety, true, 50, 100, 200, 25, 7, v_vendor_acme) RETURNING id INTO v_item_gloves;
    
    -- =====================================================
    -- 5. VENDOR ITEMS MAPPING
    -- =====================================================
    
    INSERT INTO inventory.vendor_items (tenant_id, vendor_id, catalog_item_id, vendor_sku, pack_size, is_preferred, unit_cost, lead_time_days) VALUES
    (v_tenant_id, v_vendor_acme, v_item_pvc_pipe, 'ACME-PVC100', 10, true, 8.50, 7),
    (v_tenant_id, v_vendor_builders, v_item_copper_pipe, 'BWI-COP075', 10, true, 22.00, 14),
    (v_tenant_id, v_vendor_supply_co, v_item_wire_12_2, 'ISC-W122', 5, true, 85.00, 10),
    (v_tenant_id, v_vendor_supply_co, v_item_wire_14_2, 'ISC-W142', 5, true, 65.00, 10),
    (v_tenant_id, v_vendor_builders, v_item_2x4_lumber, 'BWI-2X4-8', 50, true, 4.25, 5),
    (v_tenant_id, v_vendor_builders, v_item_plywood, 'BWI-PLY48', 25, true, 38.00, 7),
    (v_tenant_id, v_vendor_acme, v_item_screws_wood, 'ACME-SCR3', 25, true, 6.50, 7),
    (v_tenant_id, v_vendor_acme, v_item_nails, 'ACME-N16D', 20, true, 12.00, 5),
    (v_tenant_id, v_vendor_supply_co, v_item_drill_bits, 'ISC-DB29', 5, true, 35.00, 14),
    (v_tenant_id, v_vendor_supply_co, v_item_hard_hat, 'ISC-HH-W', 10, true, 18.00, 7),
    (v_tenant_id, v_vendor_supply_co, v_item_safety_vest, 'ISC-SV-O', 20, true, 12.50, 5),
    (v_tenant_id, v_vendor_acme, v_item_gloves, 'ACME-GL-L', 25, true, 8.00, 7);
    
    -- =====================================================
    -- 6. STOCK MOVEMENTS (Create Initial Inventory)
    -- =====================================================
    
    -- Main Yard - Initial receipts
    INSERT INTO inventory.stock_movements (tenant_id, catalog_item_id, location_id, quantity_delta, movement_type, source_ref_type, unit_cost, occurred_at, last_event_id) VALUES
    (v_tenant_id, v_item_pvc_pipe, v_loc_main_yard, 150, 'received', 'manual', 8.50, NOW() - INTERVAL '30 days', 'seed_mv_1'),
    (v_tenant_id, v_item_copper_pipe, v_loc_main_yard, 80, 'received', 'manual', 22.00, NOW() - INTERVAL '28 days', 'seed_mv_2'),
    (v_tenant_id, v_item_wire_12_2, v_loc_main_yard, 45, 'received', 'manual', 85.00, NOW() - INTERVAL '25 days', 'seed_mv_3'),
    (v_tenant_id, v_item_wire_14_2, v_loc_main_yard, 60, 'received', 'manual', 65.00, NOW() - INTERVAL '25 days', 'seed_mv_4'),
    (v_tenant_id, v_item_2x4_lumber, v_loc_main_yard, 600, 'received', 'manual', 4.25, NOW() - INTERVAL '20 days', 'seed_mv_5'),
    (v_tenant_id, v_item_plywood, v_loc_main_yard, 200, 'received', 'manual', 38.00, NOW() - INTERVAL '20 days', 'seed_mv_6'),
    (v_tenant_id, v_item_screws_wood, v_loc_main_yard, 250, 'received', 'manual', 6.50, NOW() - INTERVAL '15 days', 'seed_mv_7'),
    (v_tenant_id, v_item_nails, v_loc_main_yard, 120, 'received', 'manual', 12.00, NOW() - INTERVAL '15 days', 'seed_mv_8'),
    (v_tenant_id, v_item_drill_bits, v_loc_main_yard, 25, 'received', 'manual', 35.00, NOW() - INTERVAL '10 days', 'seed_mv_9'),
    (v_tenant_id, v_item_hard_hat, v_loc_main_yard, 80, 'received', 'manual', 18.00, NOW() - INTERVAL '12 days', 'seed_mv_10'),
    (v_tenant_id, v_item_safety_vest, v_loc_main_yard, 150, 'received', 'manual', 12.50, NOW() - INTERVAL '12 days', 'seed_mv_11'),
    (v_tenant_id, v_item_gloves, v_loc_main_yard, 200, 'received', 'manual', 8.00, NOW() - INTERVAL '10 days', 'seed_mv_12');
    
    -- Warehouse A - Additional stock
    INSERT INTO inventory.stock_movements (tenant_id, catalog_item_id, location_id, quantity_delta, movement_type, source_ref_type, unit_cost, occurred_at, last_event_id) VALUES
    (v_tenant_id, v_item_wire_12_2, v_loc_warehouse_a, 30, 'received', 'manual', 85.00, NOW() - INTERVAL '18 days', 'seed_mv_13'),
    (v_tenant_id, v_item_wire_14_2, v_loc_warehouse_a, 40, 'received', 'manual', 65.00, NOW() - INTERVAL '18 days', 'seed_mv_14'),
    (v_tenant_id, v_item_drill_bits, v_loc_warehouse_a, 15, 'received', 'manual', 35.00, NOW() - INTERVAL '8 days', 'seed_mv_15');
    
    -- Issues to jobs
    INSERT INTO inventory.stock_movements (tenant_id, catalog_item_id, location_id, quantity_delta, movement_type, source_ref_type, reason, occurred_at, last_event_id) VALUES
    (v_tenant_id, v_item_pvc_pipe, v_loc_main_yard, -40, 'issued', 'manual', 'Issued to Oakdale job', NOW() - INTERVAL '5 days', 'seed_mv_16'),
    (v_tenant_id, v_item_2x4_lumber, v_loc_main_yard, -150, 'issued', 'manual', 'Issued to Riverside job', NOW() - INTERVAL '4 days', 'seed_mv_17'),
    (v_tenant_id, v_item_plywood, v_loc_main_yard, -60, 'issued', 'manual', 'Issued to Riverside job', NOW() - INTERVAL '4 days', 'seed_mv_18'),
    (v_tenant_id, v_item_screws_wood, v_loc_main_yard, -80, 'issued', 'manual', 'Issued to Oakdale job', NOW() - INTERVAL '3 days', 'seed_mv_19'),
    (v_tenant_id, v_item_safety_vest, v_loc_main_yard, -25, 'issued', 'manual', 'Issued to crew', NOW() - INTERVAL '2 days', 'seed_mv_20'),
    (v_tenant_id, v_item_hard_hat, v_loc_main_yard, -15, 'issued', 'manual', 'Issued to crew', NOW() - INTERVAL '2 days', 'seed_mv_21');
    
    -- Transfers to trucks
    INSERT INTO inventory.stock_movements (tenant_id, catalog_item_id, location_id, quantity_delta, movement_type, source_ref_type, correlation_id, occurred_at, last_event_id) VALUES
    (v_tenant_id, v_item_pvc_pipe, v_loc_main_yard, -20, 'transferred_out', 'manual', gen_random_uuid(), NOW() - INTERVAL '1 day', 'seed_mv_22'),
    (v_tenant_id, v_item_pvc_pipe, v_loc_truck_1, 20, 'transferred_in', 'manual', gen_random_uuid(), NOW() - INTERVAL '1 day', 'seed_mv_23'),
    (v_tenant_id, v_item_screws_wood, v_loc_main_yard, -10, 'transferred_out', 'manual', gen_random_uuid(), NOW() - INTERVAL '1 day', 'seed_mv_24'),
    (v_tenant_id, v_item_screws_wood, v_loc_truck_2, 10, 'transferred_in', 'manual', gen_random_uuid(), NOW() - INTERVAL '1 day', 'seed_mv_25');
    
    -- Adjustments (cycle count variance)
    INSERT INTO inventory.stock_movements (tenant_id, catalog_item_id, location_id, quantity_delta, movement_type, source_ref_type, reason, occurred_at, last_event_id) VALUES
    (v_tenant_id, v_item_nails, v_loc_main_yard, -5, 'adjusted', 'manual', 'Cycle count variance', NOW() - INTERVAL '6 days', 'seed_mv_26'),
    (v_tenant_id, v_item_gloves, v_loc_main_yard, 8, 'adjusted', 'manual', 'Found in storage', NOW() - INTERVAL '7 days', 'seed_mv_27');
    
    -- Damaged items
    INSERT INTO inventory.stock_movements (tenant_id, catalog_item_id, location_id, quantity_delta, movement_type, source_ref_type, reason, occurred_at, last_event_id) VALUES
    (v_tenant_id, v_item_plywood, v_loc_main_yard, -3, 'damaged', 'manual', 'Water damage', NOW() - INTERVAL '9 days', 'seed_mv_28');
    
    -- =====================================================
    -- 7. RESERVATIONS (Active and Fulfilled)
    -- =====================================================
    
    INSERT INTO inventory.reservations (tenant_id, catalog_item_id, location_id, qty, status, needed_by, job_ref, last_event_id) VALUES
    (v_tenant_id, v_item_pvc_pipe, v_loc_main_yard, 30, 'active', CURRENT_DATE + 5, '{"job_id": "job_001", "job_name": "Oakdale Phase 2"}'::jsonb, 'seed_res_1'),
    (v_tenant_id, v_item_copper_pipe, v_loc_main_yard, 25, 'active', CURRENT_DATE + 7, '{"job_id": "job_002", "job_name": "Downtown Office"}'::jsonb, 'seed_res_2'),
    (v_tenant_id, v_item_2x4_lumber, v_loc_main_yard, 200, 'active', CURRENT_DATE + 3, '{"job_id": "job_003", "job_name": "Riverside Phase 2"}'::jsonb, 'seed_res_3'),
    (v_tenant_id, v_item_plywood, v_loc_main_yard, 40, 'active', CURRENT_DATE + 3, '{"job_id": "job_003", "job_name": "Riverside Phase 2"}'::jsonb, 'seed_res_4'),
    (v_tenant_id, v_item_wire_12_2, v_loc_warehouse_a, 10, 'active', CURRENT_DATE + 10, '{"job_id": "job_004", "job_name": "Hospital Remodel"}'::jsonb, 'seed_res_5'),
    (v_tenant_id, v_item_screws_wood, v_loc_main_yard, 50, 'active', CURRENT_DATE + 2, '{"job_id": "job_001", "job_name": "Oakdale Phase 2"}'::jsonb, 'seed_res_6'),
    (v_tenant_id, v_item_hard_hat, v_loc_main_yard, 10, 'active', CURRENT_DATE + 1, '{"job_id": "job_005", "job_name": "Safety Audit"}'::jsonb, 'seed_res_7'),
    -- Fulfilled reservation
    (v_tenant_id, v_item_nails, v_loc_main_yard, 20, 'fulfilled', CURRENT_DATE - 2, '{"job_id": "job_001", "job_name": "Oakdale Phase 1"}'::jsonb, 'seed_res_8'),
    -- Expired reservation
    (v_tenant_id, v_item_gloves, v_loc_main_yard, 15, 'expired', CURRENT_DATE - 5, '{"job_id": "job_999", "job_name": "Cancelled Job"}'::jsonb, 'seed_res_9');
    
    -- =====================================================
    -- 8. PURCHASE ORDERS
    -- =====================================================
    
    -- PO 1: Open order with ACME (will create on-order qty)
    INSERT INTO inventory.purchase_orders (id, tenant_id, po_number, vendor_location_id, status, order_date, expected_delivery_date, delivery_location_id, last_event_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'PO-2026-001', NULL, 'placed', CURRENT_DATE - 5, CURRENT_DATE + 3, v_loc_main_yard, 'seed_po_1') RETURNING id INTO v_po_1;
    
    INSERT INTO inventory.purchase_order_lines (tenant_id, po_id, line_number, catalog_item_id, qty_ordered, qty_received, unit_cost, status, last_event_id) VALUES
    (v_tenant_id, v_po_1, 1, v_item_pvc_pipe, 200, 0, 8.50, 'open', 'seed_po_1_line_1'),
    (v_tenant_id, v_po_1, 2, v_item_screws_wood, 300, 0, 6.50, 'open', 'seed_po_1_line_2'),
    (v_tenant_id, v_po_1, 3, v_item_nails, 150, 0, 12.00, 'open', 'seed_po_1_line_3');
    
    -- PO 2: Partially received order
    INSERT INTO inventory.purchase_orders (id, tenant_id, po_number, vendor_location_id, status, order_date, expected_delivery_date, delivery_location_id, last_event_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'PO-2026-002', NULL, 'partially_received', CURRENT_DATE - 10, CURRENT_DATE - 2, v_loc_warehouse_a, 'seed_po_2') RETURNING id INTO v_po_2;
    
    INSERT INTO inventory.purchase_order_lines (tenant_id, po_id, line_number, catalog_item_id, qty_ordered, qty_received, unit_cost, status, last_event_id) VALUES
    (v_tenant_id, v_po_2, 1, v_item_2x4_lumber, 500, 300, 4.25, 'partially_received', 'seed_po_2_line_1'),
    (v_tenant_id, v_po_2, 2, v_item_plywood, 150, 0, 38.00, 'open', 'seed_po_2_line_2');
    
    -- PO 3: Draft order (awaiting approval)
    INSERT INTO inventory.purchase_orders (id, tenant_id, po_number, vendor_location_id, status, order_date, expected_delivery_date, delivery_location_id, last_event_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'PO-2026-003', NULL, 'draft', CURRENT_DATE, CURRENT_DATE + 10, v_loc_main_yard, 'seed_po_3') RETURNING id INTO v_po_3;
    
    INSERT INTO inventory.purchase_order_lines (tenant_id, po_id, line_number, catalog_item_id, qty_ordered, qty_received, unit_cost, status, last_event_id) VALUES
    (v_tenant_id, v_po_3, 1, v_item_wire_12_2, 50, 0, 85.00, 'open', 'seed_po_3_line_1'),
    (v_tenant_id, v_po_3, 2, v_item_wire_14_2, 50, 0, 65.00, 'open', 'seed_po_3_line_2'),
    (v_tenant_id, v_po_3, 3, v_item_drill_bits, 20, 0, 35.00, 'open', 'seed_po_3_line_3');
    
    -- =====================================================
    -- 9. RECEIPTS (for partially received PO)
    -- =====================================================
    
    INSERT INTO inventory.receipts (tenant_id, po_id, receipt_number, received_at, location_id, last_event_id) VALUES
    (v_tenant_id, v_po_2, 'RCV-2026-001', NOW() - INTERVAL '2 days', v_loc_warehouse_a, 'seed_rcv_1');
    
    -- Receipt lines would normally be created, but movements were already created above
    
    -- =====================================================
    -- 10. CYCLE COUNTS
    -- =====================================================
    
    INSERT INTO inventory.cycle_counts (tenant_id, count_number, location_id, scheduled_for, status) VALUES
    (v_tenant_id, 'CC-2026-001', v_loc_main_yard, CURRENT_DATE + 7, 'scheduled'),
    (v_tenant_id, 'CC-2026-002', v_loc_warehouse_a, CURRENT_DATE - 5, 'completed');
    
    -- =====================================================
    -- 11. ACCOUNTING EXPENSES (optional)
    -- =====================================================
    
    INSERT INTO inventory.accounting_expenses (tenant_id, vendor_id, po_id, expense_date, amount, status, invoice_number, last_event_id) VALUES
    (v_tenant_id, v_vendor_acme, NULL, CURRENT_DATE - 15, 2500.00, 'posted', 'INV-ACME-12345', 'seed_exp_1'),
    (v_tenant_id, v_vendor_builders, v_po_2, CURRENT_DATE - 3, 1275.00, 'matched', 'INV-BWI-98765', 'seed_exp_2'),
    (v_tenant_id, v_vendor_supply_co, NULL, CURRENT_DATE - 8, 850.00, 'posted', 'INV-ISC-55555', 'seed_exp_3');
    
    RAISE NOTICE 'Seed data created successfully for tenant: %', v_tenant_id;
    
END $$;
