-- ============================================================================
-- FIX SCHEMA/API MISMATCHES
-- ============================================================================
-- Date: 2026-01-22
-- Purpose: Add missing columns that APIs expect but don't exist in production
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. FIX DASHBOARDS TABLE (public schema)
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '=== Fixing dashboards table ===';
END $$;

-- Add missing columns for dashboard scope and ownership
ALTER TABLE public.dashboards 
ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'user',
ADD COLUMN IF NOT EXISTS owner_user_id UUID,
ADD COLUMN IF NOT EXISTS role_key TEXT;

-- Update existing records to have proper ownership
UPDATE public.dashboards
SET owner_user_id = created_by,
    scope = 'user'
WHERE created_by IS NOT NULL 
  AND created_by != '00000000-0000-0000-0000-000000000000'::uuid
  AND owner_user_id IS NULL;

-- Set scope to 'tenant' for system dashboards
UPDATE public.dashboards
SET scope = 'tenant',
    owner_user_id = NULL
WHERE (created_by IS NULL OR created_by = '00000000-0000-0000-0000-000000000000'::uuid)
  AND scope != 'tenant';

-- Add constraints
ALTER TABLE public.dashboards
DROP CONSTRAINT IF EXISTS dashboards_scope_enum_check,
DROP CONSTRAINT IF EXISTS dashboards_scope_check;

ALTER TABLE public.dashboards
ADD CONSTRAINT dashboards_scope_enum_check CHECK (scope IN ('tenant', 'role', 'user')),
ADD CONSTRAINT dashboards_scope_check CHECK (
    (scope = 'role' AND role_key IS NOT NULL) OR
    (scope = 'user' AND owner_user_id IS NOT NULL) OR
    (scope = 'tenant')
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_dashboards_scope ON public.dashboards(tenant_id, scope);
CREATE INDEX IF NOT EXISTS idx_dashboards_owner_user_id ON public.dashboards(tenant_id, owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dashboards_role_key ON public.dashboards(tenant_id, role_key) WHERE role_key IS NOT NULL;

COMMENT ON COLUMN public.dashboards.scope IS 'Access scope: tenant (all users), role (specific role), user (personal)';
COMMENT ON COLUMN public.dashboards.owner_user_id IS 'User ID who owns this dashboard (for scope=user)';
COMMENT ON COLUMN public.dashboards.role_key IS 'Role key for role-specific dashboards (for scope=role)';

-- ============================================================================
-- 2. FIX CATALOG_ITEMS TABLE (inventory schema)
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '=== Fixing catalog_items table ===';
END $$;

-- Add description column
ALTER TABLE inventory.catalog_items
ADD COLUMN IF NOT EXISTS description TEXT;

-- Add unit_of_measure as alias for uom (APIs use unit_of_measure)
ALTER TABLE inventory.catalog_items
ADD COLUMN IF NOT EXISTS unit_of_measure TEXT;

-- Migrate existing data from uom to unit_of_measure
UPDATE inventory.catalog_items
SET unit_of_measure = uom
WHERE unit_of_measure IS NULL AND uom IS NOT NULL;

-- Add reorder columns
ALTER TABLE inventory.catalog_items
ADD COLUMN IF NOT EXISTS reorder_point NUMERIC(15,4),
ADD COLUMN IF NOT EXISTS min_stock_level NUMERIC(15,4),
ADD COLUMN IF NOT EXISTS max_stock_level NUMERIC(15,4);

-- Add indexes for reorder management
CREATE INDEX IF NOT EXISTS idx_catalog_items_reorder_point 
    ON inventory.catalog_items(tenant_id, reorder_point) 
    WHERE reorder_point IS NOT NULL;

COMMENT ON COLUMN inventory.catalog_items.description IS 'Detailed item description';
COMMENT ON COLUMN inventory.catalog_items.unit_of_measure IS 'Unit of measure (EA, GAL, TON, FT, etc.) - preferred API field';
COMMENT ON COLUMN inventory.catalog_items.uom IS 'Legacy unit of measure field - use unit_of_measure instead';
COMMENT ON COLUMN inventory.catalog_items.reorder_point IS 'Stock level that triggers reorder';
COMMENT ON COLUMN inventory.catalog_items.min_stock_level IS 'Minimum stock level alert threshold';
COMMENT ON COLUMN inventory.catalog_items.max_stock_level IS 'Maximum stock level (for overstocking alerts)';

-- ============================================================================
-- 3. FIX LOCATIONS TABLE (inventory schema)
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '=== Fixing locations table ===';
END $$;

-- Add address column
ALTER TABLE inventory.locations
ADD COLUMN IF NOT EXISTS address TEXT;

COMMENT ON COLUMN inventory.locations.address IS 'Physical address or location description';

-- ============================================================================
-- 4. FIX ASSETS TABLE (inventory schema)
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '=== Fixing assets table ===';
END $$;

-- Add location_id as alias for home_location_id (APIs use location_id)
ALTER TABLE inventory.assets
ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES inventory.locations(id) ON DELETE SET NULL;

-- Migrate existing data
UPDATE inventory.assets
SET location_id = home_location_id
WHERE location_id IS NULL AND home_location_id IS NOT NULL;

-- Add purchase and warranty columns
ALTER TABLE inventory.assets
ADD COLUMN IF NOT EXISTS purchase_date DATE,
ADD COLUMN IF NOT EXISTS purchase_cost NUMERIC(15,2),
ADD COLUMN IF NOT EXISTS warranty_expires DATE;

-- Add index for location_id
CREATE INDEX IF NOT EXISTS idx_assets_location_id 
    ON inventory.assets(location_id) 
    WHERE location_id IS NOT NULL;

COMMENT ON COLUMN inventory.assets.location_id IS 'Current location (preferred API field)';
COMMENT ON COLUMN inventory.assets.home_location_id IS 'Home/default location (legacy field)';
COMMENT ON COLUMN inventory.assets.purchase_date IS 'Date asset was purchased';
COMMENT ON COLUMN inventory.assets.purchase_cost IS 'Purchase cost/value of asset';
COMMENT ON COLUMN inventory.assets.warranty_expires IS 'Warranty expiration date';

-- ============================================================================
-- VALIDATION
-- ============================================================================
DO $$
DECLARE
    v_missing_columns TEXT[];
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== Verifying Schema Fixes ===';
    
    -- Check dashboards columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dashboards' AND column_name = 'scope') THEN
        v_missing_columns := array_append(v_missing_columns, 'public.dashboards.scope');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dashboards' AND column_name = 'owner_user_id') THEN
        v_missing_columns := array_append(v_missing_columns, 'public.dashboards.owner_user_id');
    END IF;
    
    -- Check catalog_items columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'inventory' AND table_name = 'catalog_items' AND column_name = 'description') THEN
        v_missing_columns := array_append(v_missing_columns, 'inventory.catalog_items.description');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'inventory' AND table_name = 'catalog_items' AND column_name = 'unit_of_measure') THEN
        v_missing_columns := array_append(v_missing_columns, 'inventory.catalog_items.unit_of_measure');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'inventory' AND table_name = 'catalog_items' AND column_name = 'reorder_point') THEN
        v_missing_columns := array_append(v_missing_columns, 'inventory.catalog_items.reorder_point');
    END IF;
    
    -- Check locations columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'inventory' AND table_name = 'locations' AND column_name = 'address') THEN
        v_missing_columns := array_append(v_missing_columns, 'inventory.locations.address');
    END IF;
    
    -- Check assets columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'inventory' AND table_name = 'assets' AND column_name = 'location_id') THEN
        v_missing_columns := array_append(v_missing_columns, 'inventory.assets.location_id');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'inventory' AND table_name = 'assets' AND column_name = 'purchase_date') THEN
        v_missing_columns := array_append(v_missing_columns, 'inventory.assets.purchase_date');
    END IF;
    
    IF array_length(v_missing_columns, 1) > 0 THEN
        RAISE WARNING 'Missing columns after migration: %', array_to_string(v_missing_columns, ', ');
    ELSE
        RAISE NOTICE '✓ All required columns exist';
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '   SCHEMA/API MISMATCH FIX COMPLETE';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'FIXED TABLES:';
    RAISE NOTICE '  ✓ public.dashboards - Added scope, owner_user_id, role_key';
    RAISE NOTICE '  ✓ inventory.catalog_items - Added description, unit_of_measure, reorder columns';
    RAISE NOTICE '  ✓ inventory.locations - Added address';
    RAISE NOTICE '  ✓ inventory.assets - Added location_id, purchase columns';
    RAISE NOTICE '';
    RAISE NOTICE 'APIs should now work correctly!';
    RAISE NOTICE '';
END $$;

COMMIT;
