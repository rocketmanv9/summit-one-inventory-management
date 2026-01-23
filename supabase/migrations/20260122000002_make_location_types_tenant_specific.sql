-- ============================================================================
-- MAKE LOCATION TYPES TENANT-SPECIFIC
-- ============================================================================
-- Date: 2026-01-22
-- Purpose: Convert location types from CHECK constraint to tenant-specific table
-- ============================================================================

-- ============================================================================
-- 1. Create location_types table
-- ============================================================================
CREATE TABLE inventory.location_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by_user_id UUID NULL,
    updated_by_user_id UUID NULL,
    
    CONSTRAINT location_types_tenant_code_unique UNIQUE (tenant_id, code)
);

-- Indexes
CREATE INDEX idx_location_types_tenant_id ON inventory.location_types(tenant_id);
CREATE INDEX idx_location_types_active ON inventory.location_types(tenant_id, active) WHERE active = true;

-- Comments
COMMENT ON TABLE inventory.location_types IS 'Tenant-specific location types (yard, warehouse, truck, etc.)';
COMMENT ON COLUMN inventory.location_types.code IS 'Unique code within tenant (e.g., yard, warehouse)';
COMMENT ON COLUMN inventory.location_types.name IS 'Display name for the location type';

-- ============================================================================
-- 2. Seed default location types for all existing tenants
-- ============================================================================
DO $$
DECLARE
    v_tenant_id UUID;
BEGIN
    FOR v_tenant_id IN SELECT DISTINCT tenant_id FROM inventory.locations
    LOOP
        INSERT INTO inventory.location_types (tenant_id, code, name) VALUES
        (v_tenant_id, 'yard', 'Yard'),
        (v_tenant_id, 'warehouse', 'Warehouse'),
        (v_tenant_id, 'truck', 'Truck'),
        (v_tenant_id, 'job', 'Job Site'),
        (v_tenant_id, 'person', 'Person'),
        (v_tenant_id, 'vendor', 'Vendor'),
        (v_tenant_id, 'other', 'Other')
        ON CONFLICT (tenant_id, code) DO NOTHING;
        
        RAISE NOTICE 'Seeded location types for tenant: %', v_tenant_id;
    END LOOP;
END $$;

-- ============================================================================
-- 3. Drop CHECK constraint and add foreign key
-- ============================================================================
ALTER TABLE inventory.locations 
    DROP CONSTRAINT IF EXISTS locations_location_type_check;

-- Add foreign key to location_types
ALTER TABLE inventory.locations
    ADD CONSTRAINT locations_location_type_fkey 
        FOREIGN KEY (tenant_id, location_type) 
        REFERENCES inventory.location_types(tenant_id, code)
        ON DELETE RESTRICT;

COMMENT ON CONSTRAINT locations_location_type_fkey ON inventory.locations IS 
    'Enforces location type exists for tenant; RESTRICT prevents deletion of types in use';

-- ============================================================================
-- 4. Create trigger for updated_at
-- ============================================================================
CREATE TRIGGER update_location_types_updated_at
    BEFORE UPDATE ON inventory.location_types
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- ============================================================================
-- 5. Grant permissions
-- ============================================================================
GRANT SELECT, INSERT, UPDATE ON inventory.location_types TO authenticated;
GRANT SELECT, INSERT, UPDATE ON inventory.location_types TO anon;

-- ============================================================================
-- VALIDATION
-- ============================================================================
DO $$
DECLARE
    v_type_count INTEGER;
    v_tenant_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_type_count FROM inventory.location_types;
    SELECT COUNT(DISTINCT tenant_id) INTO v_tenant_count FROM inventory.location_types;
    
    RAISE NOTICE '';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '   LOCATION TYPES MIGRATION COMPLETE';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Created % location types across % tenant(s)', v_type_count, v_tenant_count;
    RAISE NOTICE 'CHECK constraint removed from locations table';
    RAISE NOTICE 'Foreign key constraint added: locations → location_types';
    RAISE NOTICE '';
END $$;
