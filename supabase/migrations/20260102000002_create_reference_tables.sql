-- Migration: Create reference tables (what things are + where they can be)
-- These are the foundational tables for inventory items, locations, and assets

-- =====================================================
-- ITEM CATEGORIES TABLE
-- =====================================================
CREATE TABLE inventory.item_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint
    CONSTRAINT item_categories_tenant_name_unique UNIQUE (tenant_id, name)
);

-- Indexes for item_categories
CREATE INDEX idx_item_categories_tenant_id ON inventory.item_categories(tenant_id);

-- =====================================================
-- CATALOG ITEMS TABLE (SKUs)
-- =====================================================
CREATE TABLE inventory.catalog_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    tracking_mode TEXT NOT NULL CHECK (tracking_mode IN ('stock', 'serialized', 'both')),
    uom TEXT NULL, -- Unit of measure: EA/GAL/TON/FT etc.
    category_id UUID NULL REFERENCES inventory.item_categories(id) ON DELETE SET NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint
    CONSTRAINT catalog_items_tenant_sku_unique UNIQUE (tenant_id, sku)
);

-- Indexes for catalog_items
CREATE INDEX idx_catalog_items_tenant_id ON inventory.catalog_items(tenant_id);
CREATE INDEX idx_catalog_items_category_id ON inventory.catalog_items(category_id) WHERE category_id IS NOT NULL;
CREATE INDEX idx_catalog_items_active ON inventory.catalog_items(tenant_id, active);
CREATE INDEX idx_catalog_items_tracking_mode ON inventory.catalog_items(tenant_id, tracking_mode);

-- =====================================================
-- LOCATIONS TABLE
-- =====================================================
-- Locations are universal containers: yard, truck, job, person, vendor, etc.
CREATE TABLE inventory.locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    location_type TEXT NOT NULL CHECK (location_type IN ('yard', 'warehouse', 'truck', 'job', 'person', 'vendor', 'other')),
    name TEXT NOT NULL,
    parent_location_id UUID NULL REFERENCES inventory.locations(id) ON DELETE SET NULL,
    external_ref JSONB NULL, -- Link to jobId, truckId, etc.
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for locations
CREATE INDEX idx_locations_tenant_id ON inventory.locations(tenant_id);
CREATE INDEX idx_locations_parent_id ON inventory.locations(parent_location_id) WHERE parent_location_id IS NOT NULL;
CREATE INDEX idx_locations_type ON inventory.locations(tenant_id, location_type);
CREATE INDEX idx_locations_active ON inventory.locations(tenant_id, active);
CREATE INDEX idx_locations_external_ref ON inventory.locations USING GIN (external_ref) WHERE external_ref IS NOT NULL;

-- =====================================================
-- ASSETS TABLE (serialized/VIN)
-- =====================================================
CREATE TABLE inventory.assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    catalog_item_id UUID NULL REFERENCES inventory.catalog_items(id) ON DELETE SET NULL,
    asset_tag TEXT NOT NULL,
    serial_number TEXT NULL,
    vin TEXT NULL,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'assigned', 'in_repair', 'out_of_service', 'retired')),
    home_location_id UUID NULL REFERENCES inventory.locations(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraints
    CONSTRAINT assets_tenant_asset_tag_unique UNIQUE (tenant_id, asset_tag)
);

-- Partial unique indexes for serial_number and vin (where not null)
CREATE UNIQUE INDEX assets_tenant_serial_number_unique 
    ON inventory.assets(tenant_id, serial_number) 
    WHERE serial_number IS NOT NULL;

CREATE UNIQUE INDEX assets_tenant_vin_unique 
    ON inventory.assets(tenant_id, vin) 
    WHERE vin IS NOT NULL;

-- Regular indexes for assets
CREATE INDEX idx_assets_tenant_id ON inventory.assets(tenant_id);
CREATE INDEX idx_assets_catalog_item_id ON inventory.assets(catalog_item_id) WHERE catalog_item_id IS NOT NULL;
CREATE INDEX idx_assets_status ON inventory.assets(tenant_id, status);
CREATE INDEX idx_assets_home_location_id ON inventory.assets(home_location_id) WHERE home_location_id IS NOT NULL;

-- =====================================================
-- IDENTIFIERS TABLE (optional but recommended)
-- =====================================================
-- For extra IDs: barcode, MPN, GS1, etc.
CREATE TABLE inventory.identifiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('catalog_item', 'asset', 'location')),
    entity_id UUID NOT NULL,
    id_type TEXT NOT NULL, -- barcode, mpn, gs1, upc, etc.
    value TEXT NOT NULL,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint: one identifier value per type per tenant
    CONSTRAINT identifiers_tenant_type_value_unique UNIQUE (tenant_id, id_type, value)
);

-- Indexes for identifiers
CREATE INDEX idx_identifiers_tenant_id ON inventory.identifiers(tenant_id);
CREATE INDEX idx_identifiers_entity ON inventory.identifiers(tenant_id, entity_type, entity_id);
CREATE INDEX idx_identifiers_type ON inventory.identifiers(tenant_id, id_type);
CREATE INDEX idx_identifiers_value ON inventory.identifiers(tenant_id, value);

-- =====================================================
-- RLS POLICIES - ITEM_CATEGORIES
-- =====================================================
ALTER TABLE inventory.item_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY item_categories_tenant_isolation ON inventory.item_categories
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- RLS POLICIES - CATALOG_ITEMS
-- =====================================================
ALTER TABLE inventory.catalog_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalog_items_tenant_isolation ON inventory.catalog_items
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- RLS POLICIES - LOCATIONS
-- =====================================================
ALTER TABLE inventory.locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY locations_tenant_isolation ON inventory.locations
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- RLS POLICIES - ASSETS
-- =====================================================
ALTER TABLE inventory.assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY assets_tenant_isolation ON inventory.assets
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- RLS POLICIES - IDENTIFIERS
-- =====================================================
ALTER TABLE inventory.identifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY identifiers_tenant_isolation ON inventory.identifiers
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- UPDATED_AT TRIGGERS
-- =====================================================
CREATE TRIGGER update_item_categories_updated_at
    BEFORE UPDATE ON inventory.item_categories
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

CREATE TRIGGER update_catalog_items_updated_at
    BEFORE UPDATE ON inventory.catalog_items
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

CREATE TRIGGER update_locations_updated_at
    BEFORE UPDATE ON inventory.locations
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

CREATE TRIGGER update_assets_updated_at
    BEFORE UPDATE ON inventory.assets
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

CREATE TRIGGER update_identifiers_updated_at
    BEFORE UPDATE ON inventory.identifiers
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON TABLE inventory.item_categories IS 'Categories for organizing catalog items';
COMMENT ON TABLE inventory.catalog_items IS 'SKU definitions - what things are';
COMMENT ON TABLE inventory.locations IS 'Universal containers: yards, trucks, jobs, people, vendors, etc.';
COMMENT ON TABLE inventory.assets IS 'Serialized items tracked individually by asset tag, serial number, or VIN';
COMMENT ON TABLE inventory.identifiers IS 'Additional identifiers: barcodes, MPNs, GS1, etc.';
