-- ============================================================================
-- Remove Deprecated location_type Column
-- ============================================================================
-- Migration: 20260122000005
-- Description: Drop the deprecated location_type text column from locations table
--              We now use location_type_id UUID exclusively
-- ============================================================================

BEGIN;

-- Drop the deprecated location_type column
ALTER TABLE inventory.locations 
  DROP COLUMN IF EXISTS location_type;

COMMENT ON TABLE inventory.locations IS 
  'Storage locations for inventory items. Uses location_type_id to reference location_types table.';

-- Verify the column is gone
DO $$
DECLARE
  v_column_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'inventory' 
      AND table_name = 'locations' 
      AND column_name = 'location_type'
  ) INTO v_column_exists;
  
  IF v_column_exists THEN
    RAISE EXCEPTION 'Failed to drop location_type column';
  ELSE
    RAISE NOTICE '✓ Successfully removed deprecated location_type column';
  END IF;
END $$;

COMMIT;
