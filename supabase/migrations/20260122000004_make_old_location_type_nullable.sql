-- ============================================================================
-- Make Old location_type Column Nullable
-- ============================================================================
-- The location_type column is deprecated in favor of location_type_id
-- Making it nullable allows inserts to work without providing it

DO $$ BEGIN
    RAISE NOTICE '=== Making Deprecated location_type Column Nullable ===';
END $$;

-- Make the old column nullable
ALTER TABLE inventory.locations 
    ALTER COLUMN location_type DROP NOT NULL;

-- Set a default value to avoid breaking existing queries
ALTER TABLE inventory.locations 
    ALTER COLUMN location_type SET DEFAULT 'warehouse';

COMMENT ON COLUMN inventory.locations.location_type IS 
    'DEPRECATED: Use location_type_id instead. Kept for backward compatibility. Will be removed in future migration.';

DO $$ BEGIN
    RAISE NOTICE '✓ Old location_type column is now nullable with default value';
    RAISE NOTICE '  New inserts should use location_type_id';
END $$;
