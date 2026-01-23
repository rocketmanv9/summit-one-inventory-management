-- ============================================================================
-- Fix Location Type to Use ID Instead of Composite Key
-- ============================================================================
-- Migrates from composite FK (tenant_id, code) to simple UUID foreign key
-- This is the standard pattern and much simpler than composite keys

DO $$ BEGIN
    RAISE NOTICE '=== Fixing Location Type Foreign Key ===';
END $$;

-- Step 1: Add new location_type_id column
ALTER TABLE inventory.locations 
    ADD COLUMN IF NOT EXISTS location_type_id UUID NULL;

-- Step 2: Populate location_type_id from existing location_type code
UPDATE inventory.locations l
SET location_type_id = lt.id
FROM inventory.location_types lt
WHERE lt.tenant_id = l.tenant_id 
  AND lt.code = l.location_type;

-- Step 3: Verify all locations got matched
DO $$
DECLARE
    v_unmatched INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_unmatched
    FROM inventory.locations
    WHERE location_type_id IS NULL;
    
    IF v_unmatched > 0 THEN
        RAISE EXCEPTION 'Migration failed: % locations have no matching location_type_id', v_unmatched;
    END IF;
    
    RAISE NOTICE '✓ All locations matched to location types';
END $$;

-- Step 4: Make location_type_id NOT NULL
ALTER TABLE inventory.locations 
    ALTER COLUMN location_type_id SET NOT NULL;

-- Step 5: Drop old composite foreign key constraint
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'locations_location_type_fkey'
        AND table_schema = 'inventory'
    ) THEN
        ALTER TABLE inventory.locations 
            DROP CONSTRAINT locations_location_type_fkey;
        RAISE NOTICE '✓ Dropped old composite FK constraint';
    END IF;
END $$;

-- Step 6: Add new simple foreign key constraint
ALTER TABLE inventory.locations 
    ADD CONSTRAINT locations_location_type_id_fkey 
        FOREIGN KEY (location_type_id) 
        REFERENCES inventory.location_types(id) 
        ON DELETE RESTRICT;

COMMENT ON CONSTRAINT locations_location_type_id_fkey ON inventory.locations IS 
    'RESTRICT prevents deletion of location types still in use';

-- Step 7: Create index for foreign key lookups
CREATE INDEX IF NOT EXISTS idx_locations_location_type_id 
    ON inventory.locations(location_type_id);

-- Step 8: Drop old location_type column (keep for now for safety)
-- We'll drop this in a future migration after verifying everything works
-- ALTER TABLE inventory.locations DROP COLUMN location_type;

COMMENT ON COLUMN inventory.locations.location_type IS 
    'DEPRECATED: Use location_type_id instead. Will be removed in future migration.';

COMMENT ON COLUMN inventory.locations.location_type_id IS 
    'Reference to tenant-specific location type definition';

-- Step 9: Drop the composite unique constraint on location_types
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'location_types_tenant_code_unique'
        AND table_schema = 'inventory'
    ) THEN
        ALTER TABLE inventory.location_types 
            DROP CONSTRAINT location_types_tenant_code_unique;
        RAISE NOTICE '✓ Dropped composite unique constraint';
    END IF;
END $$;

-- Step 10: Create simple unique constraint on code per tenant
-- (Keep this to prevent duplicate codes within a tenant)
CREATE UNIQUE INDEX IF NOT EXISTS idx_location_types_tenant_code_unique 
    ON inventory.location_types(tenant_id, code);

COMMENT ON INDEX inventory.idx_location_types_tenant_code_unique IS 
    'Ensures location type codes are unique within each tenant';

DO $$ 
DECLARE
    v_location_count INTEGER;
    v_type_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_location_count FROM inventory.locations;
    SELECT COUNT(*) INTO v_type_count FROM inventory.location_types;
    
    RAISE NOTICE '';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '   LOCATION TYPE FK MIGRATION COMPLETE';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'CHANGES APPLIED:';
    RAISE NOTICE '  ✓ Added location_type_id UUID column to locations';
    RAISE NOTICE '  ✓ Migrated % existing location records', v_location_count;
    RAISE NOTICE '  ✓ Replaced composite FK with simple UUID FK';
    RAISE NOTICE '  ✓ Added index on location_type_id';
    RAISE NOTICE '  ✓ Kept old location_type column (marked deprecated)';
    RAISE NOTICE '';
    RAISE NOTICE 'NEXT STEPS:';
    RAISE NOTICE '  1. Update API to use location_type_id instead of code';
    RAISE NOTICE '  2. Update UI to work with UUIDs';
    RAISE NOTICE '  3. Test thoroughly';
    RAISE NOTICE '  4. Drop location_type column in future migration';
    RAISE NOTICE '';
END $$;
