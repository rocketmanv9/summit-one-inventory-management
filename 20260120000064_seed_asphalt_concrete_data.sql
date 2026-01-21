-- =====================================================
-- COMPREHENSIVE SEED DATA: Asphalt & Concrete Construction Business
-- =====================================================
-- This migration creates realistic seed data for a paving/concrete contractor
-- All inventory examples match the construction industry use cases from the UI

-- Set the tenant ID
DO $$
DECLARE
    v_tenant_id UUID := 'ae837809-1a24-4ab5-ba06-34fd98c05f48';
    
    -- Categories
    v_cat_asphalt UUID;
    v_cat_concrete UUID;
    v_cat_aggregate UUID;
    v_cat_fuel UUID;
    v_cat_supplies UUID;
    v_cat_rebar UUID;
    v_cat_equipment_parts UUID;
    
    -- Catalog Items
    v_item_hma UUID;
    v_item_rmc_3000 UUID;
    v_item_rmc_4000 UUID;
    v_item_rebar_4 UUID;
    v_item_rebar_5 UUID;
    v_item_aggregate_57 UUID;
    v_item_aggregate_8 UUID;
    v_item_diesel UUID;
    v_item_tack_coat UUID;
    v_item_asphalt_sealer UUID;
    v_item_concrete_sealer UUID;
    v_item_rebar_tie_wire UUID;
    
    -- Locations
    v_loc_main_plant UUID;
    v_loc_yard UUID;
    v_loc_truck_7 UUID;
    v_loc_truck_12 UUID;
    v_loc_truck_23 UUID;
    v_loc_paver_1 UUID;
    v_loc_roller_3 UUID;
    v_loc_job_hwy50 UUID;
    v_loc_job_sr12 UUID;
    v_loc_job_i95 UUID;
    v_loc_job_downtown UUID;
    
    -- Vendors
    v_vendor_acme_asphalt UUID;
    v_vendor_riverside_mix UUID;
    v_vendor_steel_rebar UUID;
    v_vendor_fuel_depot UUID;
    v_vendor_construction_supply UUID;
    
    -- Assets
    v_asset_paver_1 UUID;
    v_asset_roller_3 UUID;
    v_asset_mixer_1 UUID;
    v_asset_truck_7 UUID;
    
    -- POs
    v_po_1 UUID;
    v_po_2 UUID;
    v_po_3 UUID;
    
    v_correlation_1 UUID := gen_random_uuid();
    v_correlation_2 UUID := gen_random_uuid();
    v_correlation_3 UUID := gen_random_uuid();
    
BEGIN
    -- =====================================================
    -- 1. CLEAN UP OLD SEED DATA (idempotent - always clean first)
    -- =====================================================
    
    DELETE FROM inventory.accounting_expenses WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.cycle_count_lines WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.cycle_counts WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.receipt_lines WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.receipts WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.purchase_order_lines WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.purchase_orders WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.reservations WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.stock_movements WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.stock_balances WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.vendor_items WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.assets WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.catalog_items WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.vendors WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.locations WHERE tenant_id = v_tenant_id;
    DELETE FROM inventory.item_categories WHERE tenant_id = v_tenant_id;
    
    -- =====================================================
    -- 2. ITEM CATEGORIES
    -- =====================================================
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
    (gen_random_uuid(), v_tenant_id, 'Asphalt Products') RETURNING id INTO v_cat_asphalt;
    
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
    (gen_random_uuid(), v_tenant_id, 'Concrete Products') RETURNING id INTO v_cat_concrete;
    
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
    (gen_random_uuid(), v_tenant_id, 'Aggregates') RETURNING id INTO v_cat_aggregate;
    
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
    (gen_random_uuid(), v_tenant_id, 'Rebar & Steel') RETURNING id INTO v_cat_rebar;
    
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
    (gen_random_uuid(), v_tenant_id, 'Fuel & Lubricants') RETURNING id INTO v_cat_fuel;
    
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
    (gen_random_uuid(), v_tenant_id, 'Construction Supplies') RETURNING id INTO v_cat_supplies;
    
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
    (gen_random_uuid(), v_tenant_id, 'Equipment Parts') RETURNING id INTO v_cat_equipment_parts;
    
    -- =====================================================
    -- 3. LOCATIONS
    -- =====================================================
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'yard', 'Main Plant Yard', true) RETURNING id INTO v_loc_main_plant;
    
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'yard', 'Central Storage Yard', true) RETURNING id INTO v_loc_yard;
    
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'truck', 'Truck #7 (Peterbilt 567)', true) RETURNING id INTO v_loc_truck_7;
    
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'truck', 'Truck #12 (Mack Granite)', true) RETURNING id INTO v_loc_truck_12;
    
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'truck', 'Truck #23 (Kenworth T880)', true) RETURNING id INTO v_loc_truck_23;
    
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'other', 'Paver #1 (Vogele S1800)', true) RETURNING id INTO v_loc_paver_1;
    
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'other', 'Roller #3 (Dynapac CC624)', true) RETURNING id INTO v_loc_roller_3;
    
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'job', 'Highway 50 Resurfacing Project', true) RETURNING id INTO v_loc_job_hwy50;
    
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'job', 'State Route 12 Paving Project', true) RETURNING id INTO v_loc_job_sr12;
    
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'job', 'I-95 Expansion (Northbound)', true) RETURNING id INTO v_loc_job_i95;
    
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'job', 'Downtown Parking Lot (City Hall)', true) RETURNING id INTO v_loc_job_downtown;
    
    -- =====================================================
    -- 4. VENDORS
    -- =====================================================
    INSERT INTO inventory.vendors (id, tenant_id, name, code, contact_email, contact_phone, payment_terms, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'Acme Asphalt Supply', 'ACME-ASPH', 'orders@acmeasphalt.com', '555-0100', 'Net 30', true) RETURNING id INTO v_vendor_acme_asphalt;
    
    INSERT INTO inventory.vendors (id, tenant_id, name, code, contact_email, contact_phone, payment_terms, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'Riverside Ready-Mix Concrete', 'RIVERSIDE', 'dispatch@riversidereadymix.com', '555-0200', 'Net 30', true) RETURNING id INTO v_vendor_riverside_mix;
    
    INSERT INTO inventory.vendors (id, tenant_id, name, code, contact_email, contact_phone, payment_terms, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'Steel Rebar Distributors Inc', 'STEEL-REBAR', 'sales@steelrebar.com', '555-0300', 'Net 45', true) RETURNING id INTO v_vendor_steel_rebar;
    
    INSERT INTO inventory.vendors (id, tenant_id, name, code, contact_email, contact_phone, payment_terms, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'Highway Fuel Depot', 'FUEL-DEPOT', 'billing@hwyfuel.com', '555-0400', 'Net 15', true) RETURNING id INTO v_vendor_fuel_depot;
    
    INSERT INTO inventory.vendors (id, tenant_id, name, code, contact_email, contact_phone, payment_terms, active) VALUES
    (gen_random_uuid(), v_tenant_id, 'General Construction Supply Co', 'GEN-CONST', 'orders@genconsupply.com', '555-0500', 'Net 30', true) RETURNING id INTO v_vendor_construction_supply;
    
    -- =====================================================
    -- 5. CATALOG ITEMS
    -- =====================================================
    
    -- Asphalt Products
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'ASPH-HMA-001', 'Hot Mix Asphalt (HMA)', 'stock', 'TON', v_cat_asphalt, true, 100, 200, 500, 1, v_vendor_acme_asphalt) RETURNING id INTO v_item_hma;
    
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'ASPH-TACK-001', 'Asphalt Tack Coat Emulsion', 'stock', 'GAL', v_cat_asphalt, true, v_vendor_acme_asphalt) RETURNING id INTO v_item_tack_coat;
    
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'ASPH-SEAL-001', 'Asphalt Sealer (Coal Tar)', 'stock', 'GAL', v_cat_asphalt, true, v_vendor_acme_asphalt) RETURNING id INTO v_item_asphalt_sealer;
    
    -- Concrete Products
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'CONC-3000-001', 'Ready-Mix Concrete 3000 PSI', 'stock', 'YD3', v_cat_concrete, true, 50, 100, 200, 0, v_vendor_riverside_mix) RETURNING id INTO v_item_rmc_3000;
    
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'CONC-4000-001', 'Ready-Mix Concrete 4000 PSI', 'stock', 'YD3', v_cat_concrete, true, 30, 60, 150, 0, v_vendor_riverside_mix) RETURNING id INTO v_item_rmc_4000;
    
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'CONC-SEAL-001', 'Concrete Sealer (Siliconate)', 'stock', 'GAL', v_cat_concrete, true, v_vendor_construction_supply) RETURNING id INTO v_item_concrete_sealer;
    
    -- Aggregates
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'AGG-57-001', '#57 Aggregate Stone', 'stock', 'TON', v_cat_aggregate, true, 200, 400, 1000, v_vendor_construction_supply) RETURNING id INTO v_item_aggregate_57;
    
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'AGG-8-001', '#8 Aggregate Stone', 'stock', 'TON', v_cat_aggregate, true, 150, 300, 800, v_vendor_construction_supply) RETURNING id INTO v_item_aggregate_8;
    
    -- Rebar & Steel
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, pack_size, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'REBAR-4-20', 'Rebar #4 (1/2") 20ft', 'stock', 'EA', v_cat_rebar, true, 100, 200, 500, 20, 3, v_vendor_steel_rebar) RETURNING id INTO v_item_rebar_4;
    
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, pack_size, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'REBAR-5-20', 'Rebar #5 (5/8") 20ft', 'stock', 'EA', v_cat_rebar, true, 80, 150, 400, 20, 3, v_vendor_steel_rebar) RETURNING id INTO v_item_rebar_5;
    
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'REBAR-WIRE-001', 'Rebar Tie Wire 16ga', 'stock', 'LB', v_cat_rebar, true, v_vendor_steel_rebar) RETURNING id INTO v_item_rebar_tie_wire;
    
    -- Fuel & Lubricants
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id, active, min_stock_level, reorder_point, reorder_qty, lead_time_days, preferred_vendor_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'FUEL-DIESEL-001', 'Diesel Fuel #2', 'stock', 'GAL', v_cat_fuel, true, 500, 1000, 3000, 1, v_vendor_fuel_depot) RETURNING id INTO v_item_diesel;
    
    -- =====================================================
    -- 6. VENDOR ITEMS MAPPING
    -- =====================================================
    INSERT INTO inventory.vendor_items (tenant_id, vendor_id, catalog_item_id, vendor_sku, pack_size, is_preferred, unit_cost, lead_time_days) VALUES
    (v_tenant_id, v_vendor_acme_asphalt, v_item_hma, 'ACME-HMA-BULK', 1, true, 85.00, 1),
    (v_tenant_id, v_vendor_acme_asphalt, v_item_tack_coat, 'ACME-TACK-55GAL', 55, true, 12.50, 2),
    (v_tenant_id, v_vendor_acme_asphalt, v_item_asphalt_sealer, 'ACME-SEAL-5GAL', 5, true, 45.00, 3),
    (v_tenant_id, v_vendor_riverside_mix, v_item_rmc_3000, 'RMC-3000-BULK', 1, true, 125.00, 0),
    (v_tenant_id, v_vendor_riverside_mix, v_item_rmc_4000, 'RMC-4000-BULK', 1, true, 145.00, 0),
    (v_tenant_id, v_vendor_construction_supply, v_item_concrete_sealer, 'GCS-SEAL-5GAL', 5, true, 55.00, 2),
    (v_tenant_id, v_vendor_construction_supply, v_item_aggregate_57, 'GCS-AGG57-BULK', 1, true, 18.00, 1),
    (v_tenant_id, v_vendor_construction_supply, v_item_aggregate_8, 'GCS-AGG8-BULK', 1, true, 22.00, 1),
    (v_tenant_id, v_vendor_steel_rebar, v_item_rebar_4, 'SRD-RB4-20', 20, true, 8.50, 3),
    (v_tenant_id, v_vendor_steel_rebar, v_item_rebar_5, 'SRD-RB5-20', 20, true, 12.00, 3),
    (v_tenant_id, v_vendor_steel_rebar, v_item_rebar_tie_wire, 'SRD-WIRE-50LB', 50, true, 1.25, 2),
    (v_tenant_id, v_vendor_fuel_depot, v_item_diesel, 'HFD-DIESEL-BULK', 1, true, 3.85, 1);
    
    -- =====================================================
    -- 7. ASSETS (Equipment Tracking)
    -- =====================================================
    INSERT INTO inventory.assets (id, tenant_id, asset_tag, catalog_item_id, serial_number, status, home_location_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'PAVER-001', NULL, 'VIN-ABC123XYZ', 'available', v_loc_paver_1) RETURNING id INTO v_asset_paver_1;
    
    INSERT INTO inventory.assets (id, tenant_id, asset_tag, catalog_item_id, serial_number, status, home_location_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'ROLLER-003', NULL, 'SN-789456123', 'available', v_loc_roller_3) RETURNING id INTO v_asset_roller_3;
    
    INSERT INTO inventory.assets (id, tenant_id, asset_tag, catalog_item_id, serial_number, status) VALUES
    (gen_random_uuid(), v_tenant_id, 'MIXER-001', NULL, 'MIX-2024-001', 'available') RETURNING id INTO v_asset_mixer_1;
    
    INSERT INTO inventory.assets (id, tenant_id, asset_tag, catalog_item_id, serial_number, status, home_location_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'TRUCK-007', NULL, 'VIN-TRUCK7-123', 'available', v_loc_truck_7) RETURNING id INTO v_asset_truck_7;
    
    -- =====================================================
    -- 8. STOCK MOVEMENTS (Initial Inventory)
    -- =====================================================
    
    -- Main Plant - Asphalt and Aggregates
    INSERT INTO inventory.stock_movements (tenant_id, catalog_item_id, location_id, quantity_delta, movement_type, source_ref_type, unit_cost, occurred_at, last_event_id) VALUES
    (v_tenant_id, v_item_hma, v_loc_main_plant, 850, 'received', 'manual', 85.00, NOW() - INTERVAL '5 days', gen_random_uuid()::text),
    (v_tenant_id, v_item_aggregate_57, v_loc_yard, 1200, 'received', 'manual', 18.00, NOW() - INTERVAL '10 days', gen_random_uuid()::text),
    (v_tenant_id, v_item_aggregate_8, v_loc_yard, 900, 'received', 'manual', 22.00, NOW() - INTERVAL '10 days', gen_random_uuid()::text),
    (v_tenant_id, v_item_diesel, v_loc_main_plant, 2500, 'received', 'manual', 3.85, NOW() - INTERVAL '3 days', gen_random_uuid()::text);
    
    -- Concrete inventory
    INSERT INTO inventory.stock_movements (tenant_id, catalog_item_id, location_id, quantity_delta, movement_type, source_ref_type, unit_cost, occurred_at, last_event_id) VALUES
    (v_tenant_id, v_item_rmc_3000, v_loc_main_plant, 180, 'received', 'manual', 125.00, NOW() - INTERVAL '2 days', gen_random_uuid()::text),
    (v_tenant_id, v_item_rmc_4000, v_loc_main_plant, 120, 'received', 'manual', 145.00, NOW() - INTERVAL '2 days', gen_random_uuid()::text);
    
    -- Rebar inventory
    INSERT INTO inventory.stock_movements (tenant_id, catalog_item_id, location_id, quantity_delta, movement_type, source_ref_type, unit_cost, occurred_at, last_event_id) VALUES
    (v_tenant_id, v_item_rebar_4, v_loc_yard, 450, 'received', 'manual', 8.50, NOW() - INTERVAL '7 days', gen_random_uuid()::text),
    (v_tenant_id, v_item_rebar_5, v_loc_yard, 320, 'received', 'manual', 12.00, NOW() - INTERVAL '7 days', gen_random_uuid()::text),
    (v_tenant_id, v_item_rebar_tie_wire, v_loc_yard, 250, 'received', 'manual', 1.25, NOW() - INTERVAL '7 days', gen_random_uuid()::text);
    
    -- Supplies
    INSERT INTO inventory.stock_movements (tenant_id, catalog_item_id, location_id, quantity_delta, movement_type, source_ref_type, unit_cost, occurred_at, last_event_id) VALUES
    (v_tenant_id, v_item_tack_coat, v_loc_main_plant, 220, 'received', 'manual', 12.50, NOW() - INTERVAL '8 days', gen_random_uuid()::text),
    (v_tenant_id, v_item_asphalt_sealer, v_loc_yard, 80, 'received', 'manual', 45.00, NOW() - INTERVAL '12 days', gen_random_uuid()::text),
    (v_tenant_id, v_item_concrete_sealer, v_loc_yard, 60, 'received', 'manual', 55.00, NOW() - INTERVAL '12 days', gen_random_uuid()::text);
    
    -- =====================================================
    -- 9. TRANSFERS TO TRUCKS AND JOBS
    -- =====================================================
    
    -- Transfer asphalt from plant to Truck #7 for I-95 project
    INSERT INTO inventory.stock_movements (tenant_id, catalog_item_id, location_id, quantity_delta, movement_type, source_ref_type, correlation_id, occurred_at, last_event_id) VALUES
    (v_tenant_id, v_item_hma, v_loc_main_plant, -50, 'transferred_out', 'manual', v_correlation_1, NOW() - INTERVAL '1 day', gen_random_uuid()::text),
    (v_tenant_id, v_item_hma, v_loc_truck_7, 50, 'transferred_in', 'manual', v_correlation_1, NOW() - INTERVAL '1 day', gen_random_uuid()::text);
    
    -- Transfer aggregate from yard to Truck #12
    INSERT INTO inventory.stock_movements (tenant_id, catalog_item_id, location_id, quantity_delta, movement_type, source_ref_type, correlation_id, occurred_at, last_event_id) VALUES
    (v_tenant_id, v_item_aggregate_57, v_loc_yard, -75, 'transferred_out', 'manual', v_correlation_2, NOW() - INTERVAL '2 days', gen_random_uuid()::text),
    (v_tenant_id, v_item_aggregate_57, v_loc_truck_12, 75, 'transferred_in', 'manual', v_correlation_2, NOW() - INTERVAL '2 days', gen_random_uuid()::text);
    
    -- Transfer diesel to equipment
    INSERT INTO inventory.stock_movements (tenant_id, catalog_item_id, location_id, quantity_delta, movement_type, source_ref_type, correlation_id, occurred_at, last_event_id) VALUES
    (v_tenant_id, v_item_diesel, v_loc_main_plant, -120, 'transferred_out', 'manual', v_correlation_3, NOW() - INTERVAL '1 day', gen_random_uuid()::text),
    (v_tenant_id, v_item_diesel, v_loc_paver_1, 80, 'transferred_in', 'manual', v_correlation_3, NOW() - INTERVAL '1 day', gen_random_uuid()::text),
    (v_tenant_id, v_item_diesel, v_loc_roller_3, 40, 'transferred_in', 'manual', v_correlation_3, NOW() - INTERVAL '1 day', gen_random_uuid()::text);
    
    -- =====================================================
    -- 10. ISSUES TO JOBS
    -- =====================================================
    
    -- Issue asphalt to Highway 50 project
    INSERT INTO inventory.stock_movements (tenant_id, catalog_item_id, location_id, quantity_delta, movement_type, source_ref_type, reason, occurred_at, last_event_id) VALUES
    (v_tenant_id, v_item_hma, v_loc_main_plant, -500, 'issued', 'manual', 'Issued to Highway 50 Resurfacing Project', NOW() - INTERVAL '4 days', gen_random_uuid()::text);
    
    -- Issue concrete to downtown parking lot
    INSERT INTO inventory.stock_movements (tenant_id, catalog_item_id, location_id, quantity_delta, movement_type, source_ref_type, reason, occurred_at, last_event_id) VALUES
    (v_tenant_id, v_item_rmc_3000, v_loc_main_plant, -85, 'issued', 'manual', 'Issued to Downtown Parking Lot Project', NOW() - INTERVAL '3 days', gen_random_uuid()::text);
    
    -- Issue rebar to State Route 12 project
    INSERT INTO inventory.stock_movements (tenant_id, catalog_item_id, location_id, quantity_delta, movement_type, source_ref_type, reason, occurred_at, last_event_id) VALUES
    (v_tenant_id, v_item_rebar_4, v_loc_yard, -120, 'issued', 'manual', 'Issued to State Route 12 Project', NOW() - INTERVAL '5 days', gen_random_uuid()::text),
    (v_tenant_id, v_item_rebar_5, v_loc_yard, -80, 'issued', 'manual', 'Issued to State Route 12 Project', NOW() - INTERVAL '5 days', gen_random_uuid()::text);
    
    -- =====================================================
    -- 11. ADJUSTMENTS (Cycle Count Variances)
    -- =====================================================
    INSERT INTO inventory.stock_movements (tenant_id, catalog_item_id, location_id, quantity_delta, movement_type, source_ref_type, reason, occurred_at, last_event_id) VALUES
    (v_tenant_id, v_item_aggregate_57, v_loc_yard, -15, 'adjusted', 'manual', 'Cycle count variance - material settling', NOW() - INTERVAL '6 days', gen_random_uuid()::text),
    (v_tenant_id, v_item_rebar_tie_wire, v_loc_yard, 10, 'adjusted', 'manual', 'Found in back storage', NOW() - INTERVAL '8 days', gen_random_uuid()::text);
    
    -- =====================================================
    -- 12. RESERVATIONS
    -- =====================================================
    INSERT INTO inventory.reservations (tenant_id, catalog_item_id, location_id, qty, status, needed_by, job_ref, last_event_id) VALUES
    (v_tenant_id, v_item_hma, v_loc_main_plant, 300, 'active', CURRENT_DATE + 3, '{"job_id": "HWY50", "job_name": "Highway 50 Phase 2"}'::jsonb, gen_random_uuid()::text),
    (v_tenant_id, v_item_rmc_4000, v_loc_main_plant, 75, 'active', CURRENT_DATE + 2, '{"job_id": "I95-NB", "job_name": "I-95 Bridge Deck"}'::jsonb, gen_random_uuid()::text),
    (v_tenant_id, v_item_aggregate_57, v_loc_yard, 200, 'active', CURRENT_DATE + 5, '{"job_id": "SR12", "job_name": "State Route 12 Base Layer"}'::jsonb, gen_random_uuid()::text),
    (v_tenant_id, v_item_rebar_4, v_loc_yard, 150, 'active', CURRENT_DATE + 7, '{"job_id": "DTOWN", "job_name": "Downtown Parking Structure"}'::jsonb, gen_random_uuid()::text),
    (v_tenant_id, v_item_diesel, v_loc_main_plant, 500, 'active', CURRENT_DATE + 1, '{"job_id": "ALL", "job_name": "Weekly Equipment Fueling"}'::jsonb, gen_random_uuid()::text);
    
    -- =====================================================
    -- 13. PURCHASE ORDERS
    -- =====================================================
    
    -- PO 1: Open order for asphalt (will create on-order qty)
    INSERT INTO inventory.purchase_orders (id, tenant_id, po_number, vendor_location_id, status, order_date, expected_delivery_date, delivery_location_id, notes, last_event_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'PO-2026-001', NULL, 'placed', CURRENT_DATE - 3, CURRENT_DATE + 2, v_loc_main_plant, 'Asphalt order for Highway 50 project', gen_random_uuid()::text) RETURNING id INTO v_po_1;
    
    INSERT INTO inventory.purchase_order_lines (tenant_id, po_id, line_number, catalog_item_id, qty_ordered, qty_received, unit_cost, status, last_event_id) VALUES
    (v_tenant_id, v_po_1, 1, v_item_hma, 500, 0, 85.00, 'open', gen_random_uuid()::text),
    (v_tenant_id, v_po_1, 2, v_item_tack_coat, 110, 0, 12.50, 'open', gen_random_uuid()::text);
    
    -- PO 2: Partially received rebar order
    INSERT INTO inventory.purchase_orders (id, tenant_id, po_number, vendor_location_id, status, order_date, expected_delivery_date, delivery_location_id, notes, last_event_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'PO-2026-002', NULL, 'partially_received', CURRENT_DATE - 10, CURRENT_DATE - 3, v_loc_yard, 'Rebar for SR-12 project', gen_random_uuid()::text) RETURNING id INTO v_po_2;
    
    INSERT INTO inventory.purchase_order_lines (tenant_id, po_id, line_number, catalog_item_id, qty_ordered, qty_received, unit_cost, status, last_event_id) VALUES
    (v_tenant_id, v_po_2, 1, v_item_rebar_4, 500, 300, 8.50, 'partially_received', gen_random_uuid()::text),
    (v_tenant_id, v_po_2, 2, v_item_rebar_5, 400, 200, 12.00, 'partially_received', gen_random_uuid()::text),
    (v_tenant_id, v_po_2, 3, v_item_rebar_tie_wire, 200, 200, 1.25, 'fully_received', gen_random_uuid()::text);
    
    -- PO 3: Draft concrete order
    INSERT INTO inventory.purchase_orders (id, tenant_id, po_number, vendor_location_id, status, order_date, expected_delivery_date, delivery_location_id, notes, last_event_id) VALUES
    (gen_random_uuid(), v_tenant_id, 'PO-2026-003', NULL, 'draft', CURRENT_DATE, CURRENT_DATE + 1, v_loc_main_plant, 'Ready-mix for bridge deck pour', gen_random_uuid()::text) RETURNING id INTO v_po_3;
    
    INSERT INTO inventory.purchase_order_lines (tenant_id, po_id, line_number, catalog_item_id, qty_ordered, qty_received, unit_cost, status, last_event_id) VALUES
    (v_tenant_id, v_po_3, 1, v_item_rmc_4000, 150, 0, 145.00, 'open', gen_random_uuid()::text);
    
    -- =====================================================
    -- 14. RECEIPTS
    -- =====================================================
    INSERT INTO inventory.receipts (tenant_id, po_id, receipt_number, received_at, location_id, notes, last_event_id) VALUES
    (v_tenant_id, v_po_2, 'RCV-2026-001', NOW() - INTERVAL '3 days', v_loc_yard, 'Partial delivery - 1 of 2 trucks arrived', gen_random_uuid()::text);
    
    -- =====================================================
    -- 15. CYCLE COUNTS
    -- =====================================================
    INSERT INTO inventory.cycle_counts (tenant_id, count_number, location_id, scheduled_for, status, notes) VALUES
    (v_tenant_id, 'CC-2026-001', v_loc_main_plant, CURRENT_DATE + 5, 'scheduled', 'Monthly asphalt inventory count'),
    (v_tenant_id, 'CC-2026-002', v_loc_yard, CURRENT_DATE - 6, 'completed', 'Weekly aggregate count'),
    (v_tenant_id, 'CC-2026-003', v_loc_truck_7, CURRENT_DATE + 2, 'scheduled', 'Truck inventory before job'),
    (v_tenant_id, 'CC-2026-004', v_loc_yard, CURRENT_DATE - 8, 'completed', 'Rebar stock verification');
    
    -- =====================================================
    -- 16. ACCOUNTING EXPENSES
    -- =====================================================
    INSERT INTO inventory.accounting_expenses (tenant_id, vendor_id, po_id, expense_date, amount, status, invoice_number, last_event_id) VALUES
    (v_tenant_id, v_vendor_acme_asphalt, NULL, CURRENT_DATE - 15, 42500.00, 'posted', 'INV-ACME-20260105', gen_random_uuid()::text),
    (v_tenant_id, v_vendor_riverside_mix, NULL, CURRENT_DATE - 8, 37500.00, 'posted', 'INV-RMC-20260112', gen_random_uuid()::text),
    (v_tenant_id, v_vendor_steel_rebar, v_po_2, CURRENT_DATE - 3, 7350.00, 'matched', 'INV-SRD-20260117', gen_random_uuid()::text),
    (v_tenant_id, v_vendor_fuel_depot, NULL, CURRENT_DATE - 2, 9625.00, 'posted', 'INV-FUEL-20260118', gen_random_uuid()::text);
    
    RAISE NOTICE '✅ Asphalt & Concrete construction seed data created successfully for tenant: %', v_tenant_id;
    RAISE NOTICE '   - 7 categories';
    RAISE NOTICE '   - 12 catalog items (asphalt, concrete, rebar, aggregates, fuel)';
    RAISE NOTICE '   - 11 locations (plant, yard, trucks, equipment, job sites)';
    RAISE NOTICE '   - 5 vendors';
    RAISE NOTICE '   - 4 assets (equipment)';
    RAISE NOTICE '   - Stock movements, transfers, issues, adjustments';
    RAISE NOTICE '   - 5 active reservations';
    RAISE NOTICE '   - 3 purchase orders (open, partial, draft)';
    RAISE NOTICE '   - 4 cycle counts';
    RAISE NOTICE '   - 4 accounting expenses';
    
END $$;
