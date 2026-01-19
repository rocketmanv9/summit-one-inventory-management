-- Seed data for asphalt and concrete service company
-- Summit One Inventory Management - Demo Data

-- Set a test tenant ID
DO $$
DECLARE
    v_tenant_id UUID := 'ae837809-1a24-4ab5-ba06-34fd98c05f48';
    v_user_id UUID := '22222222-2222-2222-2222-222222222222';
    
    -- Categories
    v_cat_materials UUID;
    v_cat_equipment UUID;
    v_cat_vehicles UUID;
    v_cat_tools UUID;
    v_cat_fuel UUID;
    
    -- Locations
    v_loc_main_yard UUID;
    v_loc_warehouse UUID;
    v_loc_truck1 UUID;
    v_loc_truck2 UUID;
    v_loc_truck3 UUID;
    v_loc_job_maple UUID;
    v_loc_job_oak UUID;
    v_loc_vendor_supply UUID;
    
    -- Catalog Items
    v_item_crackfill UUID;
    v_item_sealcoat UUID;
    v_item_asphalt_mix UUID;
    v_item_concrete_mix UUID;
    v_item_propane UUID;
    v_item_diesel UUID;
    v_item_gas UUID;
    v_item_hand_tamper UUID;
    v_item_squeegee UUID;
    v_item_safety_cones UUID;
    
    -- Assets
    v_asset_truck1 UUID;
    v_asset_truck2 UUID;
    v_asset_truck3 UUID;
    v_asset_compactor UUID;
    v_asset_mixer UUID;
    
BEGIN
    -- =====================================================
    -- CATEGORIES
    -- =====================================================
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
        (uuid_generate_v4(), v_tenant_id, 'Materials') RETURNING id INTO v_cat_materials;
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
        (uuid_generate_v4(), v_tenant_id, 'Equipment') RETURNING id INTO v_cat_equipment;
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
        (uuid_generate_v4(), v_tenant_id, 'Vehicles') RETURNING id INTO v_cat_vehicles;
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
        (uuid_generate_v4(), v_tenant_id, 'Tools') RETURNING id INTO v_cat_tools;
    INSERT INTO inventory.item_categories (id, tenant_id, name) VALUES
        (uuid_generate_v4(), v_tenant_id, 'Fuel & Gas') RETURNING id INTO v_cat_fuel;

    -- =====================================================
    -- LOCATIONS
    -- =====================================================
    INSERT INTO inventory.locations (id, tenant_id, location_type, name) VALUES
        (uuid_generate_v4(), v_tenant_id, 'yard', 'Main Yard') RETURNING id INTO v_loc_main_yard;
    INSERT INTO inventory.locations (id, tenant_id, location_type, name) VALUES
        (uuid_generate_v4(), v_tenant_id, 'warehouse', 'Main Warehouse') RETURNING id INTO v_loc_warehouse;
    INSERT INTO inventory.locations (id, tenant_id, location_type, name) VALUES
        (uuid_generate_v4(), v_tenant_id, 'truck', 'Truck #1 - Ford F-350') RETURNING id INTO v_loc_truck1;
    INSERT INTO inventory.locations (id, tenant_id, location_type, name) VALUES
        (uuid_generate_v4(), v_tenant_id, 'truck', 'Truck #2 - Chevy 3500') RETURNING id INTO v_loc_truck2;
    INSERT INTO inventory.locations (id, tenant_id, location_type, name) VALUES
        (uuid_generate_v4(), v_tenant_id, 'truck', 'Truck #3 - Ram 5500') RETURNING id INTO v_loc_truck3;
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, external_ref) VALUES
        (uuid_generate_v4(), v_tenant_id, 'job', 'Job Site - Maple Street Parking Lot', '{"jobId": "JOB-2024-001", "address": "123 Maple St"}') RETURNING id INTO v_loc_job_maple;
    INSERT INTO inventory.locations (id, tenant_id, location_type, name, external_ref) VALUES
        (uuid_generate_v4(), v_tenant_id, 'job', 'Job Site - Oak Avenue Driveway', '{"jobId": "JOB-2024-002", "address": "456 Oak Ave"}') RETURNING id INTO v_loc_job_oak;
    INSERT INTO inventory.locations (id, tenant_id, location_type, name) VALUES
        (uuid_generate_v4(), v_tenant_id, 'vendor', 'ABC Construction Supply') RETURNING id INTO v_loc_vendor_supply;

    -- =====================================================
    -- CATALOG ITEMS (SKUs)
    -- =====================================================
    
    -- Materials
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (uuid_generate_v4(), v_tenant_id, 'MAT-CRACKFILL-5G', 'Hot Pour Crackfill - 5 Gallon', 'stock', 'GAL', v_cat_materials) RETURNING id INTO v_item_crackfill;
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (uuid_generate_v4(), v_tenant_id, 'MAT-SEALCOAT-55G', 'Coal Tar Sealcoat - 55 Gallon Drum', 'stock', 'GAL', v_cat_materials) RETURNING id INTO v_item_sealcoat;
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (uuid_generate_v4(), v_tenant_id, 'MAT-ASPHALT-TON', 'Hot Mix Asphalt', 'stock', 'TON', v_cat_materials) RETURNING id INTO v_item_asphalt_mix;
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (uuid_generate_v4(), v_tenant_id, 'MAT-CONCRETE-80LB', 'Portland Cement Mix - 80lb Bag', 'stock', 'BAG', v_cat_materials) RETURNING id INTO v_item_concrete_mix;
    
    INSERT INTO inventory.catalog_items (tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (v_tenant_id, 'MAT-SAND-TON', 'Fine Masonry Sand', 'stock', 'TON', v_cat_materials);
    INSERT INTO inventory.catalog_items (tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (v_tenant_id, 'MAT-AGGREGATE-TON', 'Crushed Stone Aggregate', 'stock', 'TON', v_cat_materials);
    INSERT INTO inventory.catalog_items (tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (v_tenant_id, 'MAT-PRIMER-5G', 'Asphalt Primer/Tack Coat - 5 Gallon', 'stock', 'GAL', v_cat_materials);
    INSERT INTO inventory.catalog_items (tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (v_tenant_id, 'MAT-STRIPING-WHITE', 'Traffic Striping Paint - White', 'stock', 'GAL', v_cat_materials);
    INSERT INTO inventory.catalog_items (tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (v_tenant_id, 'MAT-STRIPING-YELLOW', 'Traffic Striping Paint - Yellow', 'stock', 'GAL', v_cat_materials);
    
    -- Fuel
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (uuid_generate_v4(), v_tenant_id, 'FUEL-PROPANE', 'Propane - Heating/Equipment', 'stock', 'GAL', v_cat_fuel) RETURNING id INTO v_item_propane;
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (uuid_generate_v4(), v_tenant_id, 'FUEL-DIESEL', 'Diesel Fuel', 'stock', 'GAL', v_cat_fuel) RETURNING id INTO v_item_diesel;
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (uuid_generate_v4(), v_tenant_id, 'FUEL-GAS-87', 'Unleaded Gasoline - 87 Octane', 'stock', 'GAL', v_cat_fuel) RETURNING id INTO v_item_gas;
    
    -- Tools
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (uuid_generate_v4(), v_tenant_id, 'TOOL-TAMPER-HAND', 'Hand Tamper - Steel', 'both', 'EA', v_cat_tools) RETURNING id INTO v_item_hand_tamper;
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (uuid_generate_v4(), v_tenant_id, 'TOOL-SQUEEGEE-24', 'Sealcoat Squeegee - 24 inch', 'stock', 'EA', v_cat_tools) RETURNING id INTO v_item_squeegee;
    INSERT INTO inventory.catalog_items (id, tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (uuid_generate_v4(), v_tenant_id, 'SAFETY-CONES-28', 'Safety Cones - 28 inch Orange', 'stock', 'EA', v_cat_tools) RETURNING id INTO v_item_safety_cones;
    
    INSERT INTO inventory.catalog_items (tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (v_tenant_id, 'TOOL-EDGER-CONCRETE', 'Concrete Edger Tool', 'stock', 'EA', v_cat_tools);
    INSERT INTO inventory.catalog_items (tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (v_tenant_id, 'TOOL-TROWEL-MAG', 'Magnesium Concrete Trowel', 'stock', 'EA', v_cat_tools);
    INSERT INTO inventory.catalog_items (tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (v_tenant_id, 'TOOL-BRUSH-WIRE', 'Wire Brush for Surface Prep', 'stock', 'EA', v_cat_tools);
    INSERT INTO inventory.catalog_items (tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (v_tenant_id, 'TOOL-SPRAYER-BACKPACK', 'Backpack Sprayer - 4 Gallon', 'both', 'EA', v_cat_tools);

    -- Equipment (serialized)
    INSERT INTO inventory.catalog_items (tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (v_tenant_id, 'EQ-COMPACTOR-PLATE', 'Plate Compactor - Gas Powered', 'serialized', 'EA', v_cat_equipment);
    INSERT INTO inventory.catalog_items (tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (v_tenant_id, 'EQ-MIXER-CONCRETE', 'Concrete Mixer - 9 cu ft', 'serialized', 'EA', v_cat_equipment);
    INSERT INTO inventory.catalog_items (tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (v_tenant_id, 'EQ-MELTER-CRACKFILL', 'Crackfill Melter/Applicator', 'serialized', 'EA', v_cat_equipment);
    INSERT INTO inventory.catalog_items (tenant_id, sku, name, tracking_mode, uom, category_id) VALUES
        (v_tenant_id, 'EQ-STRIPER-MACHINE', 'Line Striping Machine', 'serialized', 'EA', v_cat_equipment);

    -- =====================================================
    -- ASSETS (Serialized Equipment & Vehicles)
    -- =====================================================
    
    -- Trucks
    INSERT INTO inventory.assets (id, tenant_id, catalog_item_id, asset_tag, vin, status, home_location_id) 
    SELECT uuid_generate_v4(), v_tenant_id, ci.id, 'TRUCK-001', '1FTFW1ET5EFC12345', 'assigned', v_loc_main_yard
    FROM inventory.catalog_items ci 
    WHERE ci.tenant_id = v_tenant_id AND ci.sku = 'EQ-COMPACTOR-PLATE' LIMIT 1
    RETURNING id INTO v_asset_truck1;
    
    INSERT INTO inventory.assets (id, tenant_id, catalog_item_id, asset_tag, vin, status, home_location_id) 
    VALUES (uuid_generate_v4(), v_tenant_id, NULL, 'TRUCK-002', '1GC4KZCG8EF234567', 'assigned', v_loc_main_yard)
    RETURNING id INTO v_asset_truck2;
    
    INSERT INTO inventory.assets (id, tenant_id, catalog_item_id, asset_tag, vin, status, home_location_id) 
    VALUES (uuid_generate_v4(), v_tenant_id, NULL, 'TRUCK-003', '3C63DRNL5EG345678', 'available', v_loc_main_yard)
    RETURNING id INTO v_asset_truck3;
    
    -- Equipment
    INSERT INTO inventory.assets (id, tenant_id, catalog_item_id, asset_tag, serial_number, status, home_location_id) 
    SELECT uuid_generate_v4(), v_tenant_id, ci.id, 'COMP-001', 'PC2024-5678', 'assigned', v_loc_job_maple
    FROM inventory.catalog_items ci 
    WHERE ci.tenant_id = v_tenant_id AND ci.sku = 'EQ-COMPACTOR-PLATE' LIMIT 1
    RETURNING id INTO v_asset_compactor;
    
    INSERT INTO inventory.assets (id, tenant_id, catalog_item_id, asset_tag, serial_number, status, home_location_id) 
    SELECT uuid_generate_v4(), v_tenant_id, ci.id, 'MIX-001', 'CM2023-9012', 'available', v_loc_warehouse
    FROM inventory.catalog_items ci 
    WHERE ci.tenant_id = v_tenant_id AND ci.sku = 'EQ-MIXER-CONCRETE' LIMIT 1
    RETURNING id INTO v_asset_mixer;
    
    INSERT INTO inventory.assets (tenant_id, catalog_item_id, asset_tag, serial_number, status, home_location_id) 
    SELECT v_tenant_id, ci.id, 'MELT-001', 'CF2024-1122', 'available', v_loc_warehouse
    FROM inventory.catalog_items ci 
    WHERE ci.tenant_id = v_tenant_id AND ci.sku = 'EQ-MELTER-CRACKFILL' LIMIT 1;
    
    INSERT INTO inventory.assets (tenant_id, catalog_item_id, asset_tag, serial_number, status, home_location_id) 
    SELECT v_tenant_id, ci.id, 'STRIPE-001', 'LS2023-3344', 'in_repair', v_loc_warehouse
    FROM inventory.catalog_items ci 
    WHERE ci.tenant_id = v_tenant_id AND ci.sku = 'EQ-STRIPER-MACHINE' LIMIT 1;
    
    -- Hand tools with serial tracking
    INSERT INTO inventory.assets (tenant_id, catalog_item_id, asset_tag, serial_number, status, home_location_id) 
    SELECT v_tenant_id, ci.id, 'TAMP-001', 'HT-5566', 'assigned', v_loc_truck1
    FROM inventory.catalog_items ci 
    WHERE ci.tenant_id = v_tenant_id AND ci.sku = 'TOOL-TAMPER-HAND' LIMIT 1;
    
    INSERT INTO inventory.assets (tenant_id, catalog_item_id, asset_tag, serial_number, status, home_location_id) 
    SELECT v_tenant_id, ci.id, 'TAMP-002', 'HT-5567', 'available', v_loc_warehouse
    FROM inventory.catalog_items ci 
    WHERE ci.tenant_id = v_tenant_id AND ci.sku = 'TOOL-TAMPER-HAND' LIMIT 1;

    -- =====================================================
    -- INVENTORY EVENTS (Historical)
    -- =====================================================
    
    -- Receive materials to warehouse
    INSERT INTO inventory.inventory_events (tenant_id, event_type, occurred_at, actor_user_id, source_system, last_event_id, payload) VALUES
        (v_tenant_id, 'receive', NOW() - INTERVAL '30 days', v_user_id, 'web_app', 'evt-recv-001',
         jsonb_build_object('catalog_item_id', v_item_sealcoat::text, 'location_id', v_loc_warehouse::text, 'qty', 550, 'reason', 'Initial stock - bulk order'));
    
    INSERT INTO inventory.inventory_events (tenant_id, event_type, occurred_at, actor_user_id, source_system, last_event_id, payload) VALUES
        (v_tenant_id, 'receive', NOW() - INTERVAL '30 days', v_user_id, 'web_app', 'evt-recv-002',
         jsonb_build_object('catalog_item_id', v_item_crackfill::text, 'location_id', v_loc_warehouse::text, 'qty', 200, 'reason', 'Initial stock'));
    
    INSERT INTO inventory.inventory_events (tenant_id, event_type, occurred_at, actor_user_id, source_system, last_event_id, payload) VALUES
        (v_tenant_id, 'receive', NOW() - INTERVAL '25 days', v_user_id, 'web_app', 'evt-recv-003',
         jsonb_build_object('catalog_item_id', v_item_concrete_mix::text, 'location_id', v_loc_warehouse::text, 'qty', 120, 'reason', 'Restock'));
    
    INSERT INTO inventory.inventory_events (tenant_id, event_type, occurred_at, actor_user_id, source_system, last_event_id, payload) VALUES
        (v_tenant_id, 'receive', NOW() - INTERVAL '20 days', v_user_id, 'web_app', 'evt-recv-004',
         jsonb_build_object('catalog_item_id', v_item_diesel::text, 'location_id', v_loc_main_yard::text, 'qty', 500, 'reason', 'Fuel delivery'));
    
    INSERT INTO inventory.inventory_events (tenant_id, event_type, occurred_at, actor_user_id, source_system, last_event_id, payload) VALUES
        (v_tenant_id, 'receive', NOW() - INTERVAL '20 days', v_user_id, 'web_app', 'evt-recv-005',
         jsonb_build_object('catalog_item_id', v_item_propane::text, 'location_id', v_loc_main_yard::text, 'qty', 300, 'reason', 'Propane delivery'));
    
    INSERT INTO inventory.inventory_events (tenant_id, event_type, occurred_at, actor_user_id, source_system, last_event_id, payload) VALUES
        (v_tenant_id, 'receive', NOW() - INTERVAL '15 days', v_user_id, 'web_app', 'evt-recv-006',
         jsonb_build_object('catalog_item_id', v_item_safety_cones::text, 'location_id', v_loc_warehouse::text, 'qty', 50, 'reason', 'Safety equipment order'));
    
    -- Issue materials to jobs
    INSERT INTO inventory.inventory_events (tenant_id, event_type, occurred_at, actor_user_id, source_system, last_event_id, payload) VALUES
        (v_tenant_id, 'issue', NOW() - INTERVAL '10 days', v_user_id, 'mobile_app', 'evt-issue-001',
         jsonb_build_object('catalog_item_id', v_item_sealcoat::text, 'location_id', v_loc_warehouse::text, 'qty', 165, 'reason', 'Issued to Maple St job', 'job_ref', jsonb_build_object('jobId', 'JOB-2024-001')));
    
    INSERT INTO inventory.inventory_events (tenant_id, event_type, occurred_at, actor_user_id, source_system, last_event_id, payload) VALUES
        (v_tenant_id, 'issue', NOW() - INTERVAL '8 days', v_user_id, 'mobile_app', 'evt-issue-002',
         jsonb_build_object('catalog_item_id', v_item_crackfill::text, 'location_id', v_loc_warehouse::text, 'qty', 45, 'reason', 'Issued to Maple St job', 'job_ref', jsonb_build_object('jobId', 'JOB-2024-001')));
    
    INSERT INTO inventory.inventory_events (tenant_id, event_type, occurred_at, actor_user_id, source_system, last_event_id, payload) VALUES
        (v_tenant_id, 'issue', NOW() - INTERVAL '5 days', v_user_id, 'mobile_app', 'evt-issue-003',
         jsonb_build_object('catalog_item_id', v_item_concrete_mix::text, 'location_id', v_loc_warehouse::text, 'qty', 32, 'reason', 'Issued to Oak Ave job', 'job_ref', jsonb_build_object('jobId', 'JOB-2024-002')));
    
    INSERT INTO inventory.inventory_events (tenant_id, event_type, occurred_at, actor_user_id, source_system, last_event_id, payload) VALUES
        (v_tenant_id, 'issue', NOW() - INTERVAL '3 days', v_user_id, 'mobile_app', 'evt-issue-004',
         jsonb_build_object('catalog_item_id', v_item_diesel::text, 'location_id', v_loc_main_yard::text, 'qty', 85, 'reason', 'Fuel for trucks'));
    
    -- Transfers between locations
    INSERT INTO inventory.inventory_events (tenant_id, event_type, occurred_at, actor_user_id, source_system, last_event_id, payload) VALUES
        (v_tenant_id, 'transfer', NOW() - INTERVAL '2 days', v_user_id, 'web_app', 'evt-trans-001',
         jsonb_build_object('catalog_item_id', v_item_safety_cones::text, 'from_location_id', v_loc_warehouse::text, 'to_location_id', v_loc_truck1::text, 'qty', 10, 'reason', 'Loaded to truck for job'));

    -- =====================================================
    -- ASSET EVENTS
    -- =====================================================
    
    INSERT INTO inventory.asset_events (tenant_id, event_type, occurred_at, asset_id, actor_user_id, source_system, last_event_id, payload) VALUES
        (v_tenant_id, 'assigned', NOW() - INTERVAL '10 days', v_asset_compactor, v_user_id, 'web_app', 'evt-asset-001',
         jsonb_build_object('location_id', v_loc_job_maple::text, 'assigned_to', jsonb_build_object('jobId', 'JOB-2024-001', 'jobName', 'Maple Street Parking Lot')));
    
    INSERT INTO inventory.asset_events (tenant_id, event_type, occurred_at, asset_id, actor_user_id, source_system, last_event_id, payload) VALUES
        (v_tenant_id, 'moved', NOW() - INTERVAL '7 days', v_asset_truck1, v_user_id, 'mobile_app', 'evt-asset-002',
         jsonb_build_object('from_location_id', v_loc_main_yard::text, 'to_location_id', v_loc_job_maple::text, 'reason', 'Deployed to job site'));

    -- =====================================================
    -- STOCK BALANCES (Current State)
    -- =====================================================
    
    INSERT INTO inventory.stock_balances (tenant_id, catalog_item_id, location_id, qty_on_hand, qty_reserved) VALUES
        (v_tenant_id, v_item_sealcoat, v_loc_warehouse, 385, 55),
        (v_tenant_id, v_item_crackfill, v_loc_warehouse, 155, 0),
        (v_tenant_id, v_item_concrete_mix, v_loc_warehouse, 88, 16),
        (v_tenant_id, v_item_diesel, v_loc_main_yard, 415, 0),
        (v_tenant_id, v_item_propane, v_loc_main_yard, 280, 20),
        (v_tenant_id, v_item_gas, v_loc_main_yard, 0, 0),
        (v_tenant_id, v_item_safety_cones, v_loc_warehouse, 40, 0),
        (v_tenant_id, v_item_safety_cones, v_loc_truck1, 10, 0),
        (v_tenant_id, v_item_squeegee, v_loc_warehouse, 8, 0);

    -- =====================================================
    -- RESERVATIONS
    -- =====================================================
    
    INSERT INTO inventory.reservations (tenant_id, catalog_item_id, location_id, qty, status, needed_by, job_ref, last_event_id) VALUES
        (v_tenant_id, v_item_sealcoat, v_loc_warehouse, 55, 'active', CURRENT_DATE + 5, 
         jsonb_build_object('jobId', 'JOB-2024-003', 'jobName', 'Pine Plaza - Commercial Lot'),
         'evt-reserve-001');
    
    INSERT INTO inventory.reservations (tenant_id, catalog_item_id, location_id, qty, status, needed_by, job_ref, last_event_id) VALUES
        (v_tenant_id, v_item_concrete_mix, v_loc_warehouse, 16, 'active', CURRENT_DATE + 3,
         jsonb_build_object('jobId', 'JOB-2024-004', 'jobName', 'Elm Street Sidewalk Repair'),
         'evt-reserve-002');
    
    INSERT INTO inventory.reservations (tenant_id, catalog_item_id, location_id, qty, status, needed_by, job_ref, last_event_id) VALUES
        (v_tenant_id, v_item_propane, v_loc_main_yard, 20, 'active', CURRENT_DATE + 1,
         jsonb_build_object('jobId', 'JOB-2024-001', 'jobName', 'Maple Street - Heating Equipment'),
         'evt-reserve-003');

    -- =====================================================
    -- ASSET STATE
    -- =====================================================
    
    INSERT INTO inventory.asset_state (id, tenant_id, asset_id, current_location_id, current_status, assigned_to_ref, last_movement_at) VALUES
        (v_asset_compactor, v_tenant_id, v_asset_compactor, v_loc_job_maple, 'assigned', 
         jsonb_build_object('jobId', 'JOB-2024-001', 'jobName', 'Maple Street Parking Lot'),
         NOW() - INTERVAL '10 days');
    
    INSERT INTO inventory.asset_state (id, tenant_id, asset_id, current_location_id, current_status, assigned_to_ref, last_movement_at) VALUES
        (v_asset_mixer, v_tenant_id, v_asset_mixer, v_loc_warehouse, 'available', NULL, NOW() - INTERVAL '30 days');
    
    INSERT INTO inventory.asset_state (id, tenant_id, asset_id, current_location_id, current_status, last_movement_at) VALUES
        (v_asset_truck1, v_tenant_id, v_asset_truck1, v_loc_job_maple, 'assigned', NOW() - INTERVAL '7 days');
    
    INSERT INTO inventory.asset_state (id, tenant_id, asset_id, current_location_id, current_status, last_movement_at) VALUES
        (v_asset_truck2, v_tenant_id, v_asset_truck2, v_loc_main_yard, 'assigned', NOW() - INTERVAL '30 days');
    
    INSERT INTO inventory.asset_state (id, tenant_id, asset_id, current_location_id, current_status, last_movement_at) VALUES
        (v_asset_truck3, v_tenant_id, v_asset_truck3, v_loc_main_yard, 'available', NOW() - INTERVAL '30 days');

    -- =====================================================
    -- PURCHASE ORDERS
    -- =====================================================
    
    INSERT INTO inventory.purchase_orders (tenant_id, po_number, vendor_location_id, status, order_date, expected_delivery_date, delivery_location_id) VALUES
        (v_tenant_id, 'PO-2024-001', v_loc_vendor_supply, 'received', CURRENT_DATE - 30, CURRENT_DATE - 25, v_loc_warehouse);
    
    INSERT INTO inventory.purchase_orders (tenant_id, po_number, vendor_location_id, status, order_date, expected_delivery_date, delivery_location_id) VALUES
        (v_tenant_id, 'PO-2024-002', v_loc_vendor_supply, 'approved', CURRENT_DATE, CURRENT_DATE + 7, v_loc_warehouse);
    
    -- PO Lines for first PO
    INSERT INTO inventory.purchase_order_lines (tenant_id, po_id, line_number, catalog_item_id, qty_ordered, qty_received, unit_cost, status)
    SELECT v_tenant_id, po.id, 1, v_item_sealcoat, 550, 550, 15.50, 'received'
    FROM inventory.purchase_orders po WHERE po.tenant_id = v_tenant_id AND po.po_number = 'PO-2024-001';
    
    INSERT INTO inventory.purchase_order_lines (tenant_id, po_id, line_number, catalog_item_id, qty_ordered, qty_received, unit_cost, status)
    SELECT v_tenant_id, po.id, 2, v_item_crackfill, 200, 200, 22.75, 'received'
    FROM inventory.purchase_orders po WHERE po.tenant_id = v_tenant_id AND po.po_number = 'PO-2024-001';
    
    -- PO Lines for second PO (not yet received)
    INSERT INTO inventory.purchase_order_lines (tenant_id, po_id, line_number, catalog_item_id, qty_ordered, qty_received, unit_cost, status)
    SELECT v_tenant_id, po.id, 1, v_item_asphalt_mix, 10, 0, 125.00, 'pending'
    FROM inventory.purchase_orders po WHERE po.tenant_id = v_tenant_id AND po.po_number = 'PO-2024-002';

    -- =====================================================
    -- DASHBOARDS & WIDGETS
    -- =====================================================
    
    INSERT INTO inventory.dashboards (tenant_id, name, scope, is_default) VALUES
        (v_tenant_id, 'Operations Dashboard', 'tenant', true);
    
    INSERT INTO inventory.dashboard_widgets (tenant_id, dashboard_id, widget_type, title, layout, query_def, visual_def, refresh_mode)
    SELECT v_tenant_id, d.id, 'kpi', 'Total Items in Stock',
           '{"x": 0, "y": 0, "w": 3, "h": 2}'::jsonb,
           '{"metric": "stock_on_hand", "filters": {}}'::jsonb,
           '{"format": "number", "threshold": {"low": 100, "high": 1000}}'::jsonb,
           'interval'
    FROM inventory.dashboards d WHERE d.tenant_id = v_tenant_id AND d.name = 'Operations Dashboard';
    
    INSERT INTO inventory.dashboard_widgets (tenant_id, dashboard_id, widget_type, title, layout, query_def, visual_def, refresh_mode)
    SELECT v_tenant_id, d.id, 'table', 'Low Stock Alerts',
           '{"x": 3, "y": 0, "w": 6, "h": 4}'::jsonb,
           '{"metric": "stock_balances", "filters": {"qty_available": {"lt": 50}}}'::jsonb,
           '{"columns": ["item_name", "qty_available", "location"]}'::jsonb,
           'interval'
    FROM inventory.dashboards d WHERE d.tenant_id = v_tenant_id AND d.name = 'Operations Dashboard';

    RAISE NOTICE 'Seed data created successfully for tenant %', v_tenant_id;
    RAISE NOTICE 'Access Supabase Studio and filter by tenant_id = %', v_tenant_id;
END $$;
