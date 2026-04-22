-- ============================================================
-- Seed Data for Local Development
-- ============================================================
-- This file seeds a local Supabase instance with sample data
-- for development and testing.
--
-- Run: supabase db reset (includes migrations + seed)
-- Or:  psql -f supabase/seed.sql
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Create test tenant
-- ============================================================

INSERT INTO public.tenants (id, name, slug, status, created_at)
VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'Acme Paving Co',
    'acme-paving',
    'active',
    now()
) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. Create test users
-- ============================================================

-- Note: In production, users are created via Summit Core SSO.
-- For local dev, we create test users directly in auth.users.

-- Test admin user
INSERT INTO auth.users (
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data
) VALUES (
    '10000000-0000-0000-0000-000000000001'::uuid,
    'admin@acme.test',
    crypt('password123', gen_salt('bf')), -- Password: password123
    now(),
    now(),
    now(),
    jsonb_build_object(
        'tenant_id', '00000000-0000-0000-0000-000000000001',
        'role', 'admin'
    ),
    jsonb_build_object(
        'name', 'Admin User',
        'tenant_name', 'Acme Paving Co'
    )
) ON CONFLICT (id) DO NOTHING;

-- Test regular user
INSERT INTO auth.users (
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data
) VALUES (
    '10000000-0000-0000-0000-000000000002'::uuid,
    'user@acme.test',
    crypt('password123', gen_salt('bf')),
    now(),
    now(),
    now(),
    jsonb_build_object(
        'tenant_id', '00000000-0000-0000-0000-000000000001',
        'role', 'user'
    ),
    jsonb_build_object(
        'name', 'Regular User',
        'tenant_name', 'Acme Paving Co'
    )
) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 3. Seed inventory master data
-- ============================================================

DO $$
DECLARE
    v_tenant_id uuid := '00000000-0000-0000-0000-000000000001';
    v_cat_asphalt uuid;
    v_cat_aggregate uuid;
    v_cat_equipment uuid;
    v_loc_warehouse uuid;
    v_loc_yard uuid;
    v_item_asphalt uuid;
    v_item_gravel uuid;
    v_vendor_acme_materials uuid;
BEGIN

-- Categories
INSERT INTO inventory.categories (tenant_id, name, code, sku_prefix, last_event_id)
VALUES
    (v_tenant_id, 'Asphalt', 'ASP', 'ASP', 'seed-cat-asp')
RETURNING id INTO v_cat_asphalt;

INSERT INTO inventory.categories (tenant_id, name, code, sku_prefix, last_event_id)
VALUES
    (v_tenant_id, 'Aggregate', 'AGG', 'AGG', 'seed-cat-agg')
RETURNING id INTO v_cat_aggregate;

INSERT INTO inventory.categories (tenant_id, name, code, sku_prefix, last_event_id)
VALUES
    (v_tenant_id, 'Equipment', 'EQP', 'EQP', 'seed-cat-eqp')
RETURNING id INTO v_cat_equipment;

-- Location Types
INSERT INTO inventory.location_types (tenant_id, name, code, last_event_id)
VALUES
    (v_tenant_id, 'Warehouse', 'WH', 'seed-loctype-wh'),
    (v_tenant_id, 'Yard', 'YD', 'seed-loctype-yd'),
    (v_tenant_id, 'Truck', 'TRK', 'seed-loctype-trk')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Locations
INSERT INTO inventory.locations (tenant_id, name, code, location_type_id, address, is_mobile, last_event_id)
SELECT
    v_tenant_id,
    'Main Warehouse',
    'WH-01',
    lt.id,
    '123 Industrial Blvd, City, ST 12345',
    false,
    'seed-loc-wh01'
FROM inventory.location_types lt
WHERE lt.tenant_id = v_tenant_id AND lt.code = 'WH'
RETURNING id INTO v_loc_warehouse;

INSERT INTO inventory.locations (tenant_id, name, code, location_type_id, address, is_mobile, last_event_id)
SELECT
    v_tenant_id,
    'Storage Yard',
    'YD-01',
    lt.id,
    '456 Yard Rd, City, ST 12345',
    false,
    'seed-loc-yd01'
FROM inventory.location_types lt
WHERE lt.tenant_id = v_tenant_id AND lt.code = 'YD'
RETURNING id INTO v_loc_yard;

-- Vendors
INSERT INTO supply_chain.vendors (
    tenant_id,
    name,
    code,
    contact_name,
    contact_email,
    contact_phone,
    address,
    ordering_mode,
    active,
    last_event_id
)
VALUES
    (
        v_tenant_id,
        'Acme Materials Supply',
        'ACME',
        'John Doe',
        'john@acmematerials.com',
        '555-0100',
        '789 Supply St, City, ST 12345',
        'email_po',
        true,
        'seed-vendor-acme'
    )
RETURNING id INTO v_vendor_acme_materials;

-- Catalog Items
INSERT INTO inventory.catalog_items (
    tenant_id,
    name,
    sku,
    description,
    category_id,
    uom,
    tracking_mode,
    reorder_point,
    reorder_qty,
    preferred_vendor_id,
    last_event_id
)
VALUES
    (
        v_tenant_id,
        'Hot Mix Asphalt (HMA)',
        'ASP-0001',
        'Standard hot mix asphalt for paving',
        v_cat_asphalt,
        'TON',
        'simple',
        50,
        100,
        v_vendor_acme_materials,
        'seed-item-asp-hma'
    )
RETURNING id INTO v_item_asphalt;

INSERT INTO inventory.catalog_items (
    tenant_id,
    name,
    sku,
    description,
    category_id,
    uom,
    tracking_mode,
    reorder_point,
    reorder_qty,
    preferred_vendor_id,
    last_event_id
)
VALUES
    (
        v_tenant_id,
        'Crushed Gravel',
        'AGG-0001',
        '3/4" crushed gravel',
        v_cat_aggregate,
        'TON',
        'simple',
        100,
        200,
        v_vendor_acme_materials,
        'seed-item-agg-gravel'
    )
RETURNING id INTO v_item_gravel;

-- Vendor Items (link catalog items to vendors)
INSERT INTO supply_chain.vendor_items (
    tenant_id,
    vendor_id,
    catalog_item_id,
    vendor_sku,
    unit_cost,
    currency,
    lead_time_days,
    min_order_qty,
    last_event_id
)
VALUES
    (
        v_tenant_id,
        v_vendor_acme_materials,
        v_item_asphalt,
        'ACME-HMA-STD',
        75.00,
        'USD',
        3,
        10,
        'seed-vi-hma'
    ),
    (
        v_tenant_id,
        v_vendor_acme_materials,
        v_item_gravel,
        'ACME-GRV-34',
        25.00,
        'USD',
        1,
        20,
        'seed-vi-gravel'
    );

-- Initial Stock (using stock movement which triggers balance update)
INSERT INTO inventory.stock_movements (
    tenant_id,
    catalog_item_id,
    location_id,
    quantity_delta,
    movement_type,
    source_ref_type,
    reason,
    notes,
    unit_cost,
    currency,
    occurred_at,
    last_event_id
)
VALUES
    (
        v_tenant_id,
        v_item_asphalt,
        v_loc_warehouse,
        150,
        'received',
        'initial_stock',
        'Initial inventory load',
        'Seed data for development',
        75.00,
        'USD',
        now(),
        'seed-stock-hma-wh'
    ),
    (
        v_tenant_id,
        v_item_gravel,
        v_loc_warehouse,
        300,
        'received',
        'initial_stock',
        'Initial inventory load',
        'Seed data for development',
        25.00,
        'USD',
        now(),
        'seed-stock-gravel-wh'
    ),
    (
        v_tenant_id,
        v_item_gravel,
        v_loc_yard,
        200,
        'received',
        'initial_stock',
        'Initial inventory load',
        'Seed data for development',
        25.00,
        'USD',
        now(),
        'seed-stock-gravel-yd'
    );

END $$;

-- ============================================================
-- 4. Seed guardrail policies
-- ============================================================

INSERT INTO inventory.guardrail_policies (
    tenant_id,
    over_receipt_policy,
    over_receipt_threshold_pct,
    uom_mismatch_policy,
    require_override_reason,
    last_event_id
)
VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'block',
    0,
    'warn',
    true,
    'seed-guardrail-policy'
) ON CONFLICT (tenant_id) DO NOTHING;

-- ============================================================
-- 5. Seed negative inventory config
-- ============================================================

INSERT INTO inventory.negative_inventory_config (
    tenant_id,
    scope_type,
    scope_id,
    allow_negative,
    reason,
    last_event_id
)
VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'global',
    NULL,
    false,
    'Default policy: block negative inventory',
    'seed-neg-inv-global'
) ON CONFLICT (tenant_id, scope_type, COALESCE(scope_id::text, '')) DO NOTHING;

-- ============================================================
-- Verification Queries
-- ============================================================

-- Check created data
DO $$
BEGIN
    RAISE NOTICE 'Seed data loaded successfully!';
    RAISE NOTICE 'Tenant: %', (SELECT name FROM public.tenants LIMIT 1);
    RAISE NOTICE 'Users: %', (SELECT COUNT(*) FROM auth.users WHERE email LIKE '%@acme.test');
    RAISE NOTICE 'Categories: %', (SELECT COUNT(*) FROM inventory.categories WHERE tenant_id = '00000000-0000-0000-0000-000000000001');
    RAISE NOTICE 'Locations: %', (SELECT COUNT(*) FROM inventory.locations WHERE tenant_id = '00000000-0000-0000-0000-000000000001');
    RAISE NOTICE 'Items: %', (SELECT COUNT(*) FROM inventory.catalog_items WHERE tenant_id = '00000000-0000-0000-0000-000000000001');
    RAISE NOTICE 'Stock Balances: %', (SELECT COUNT(*) FROM inventory.stock_balances WHERE tenant_id = '00000000-0000-0000-0000-000000000001');
    RAISE NOTICE '';
    RAISE NOTICE 'Test credentials:';
    RAISE NOTICE '  Admin: admin@acme.test / password123';
    RAISE NOTICE '  User:  user@acme.test / password123';
    RAISE NOTICE '';
    RAISE NOTICE 'Tenant ID: 00000000-0000-0000-0000-000000000001';
END $$;

COMMIT;
