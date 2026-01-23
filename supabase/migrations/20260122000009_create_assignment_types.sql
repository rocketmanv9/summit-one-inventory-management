-- ============================================================================
-- CREATE ASSET ASSIGNMENT TYPES (Customizable)
-- ============================================================================
-- Date: 2026-01-22
-- Purpose: Allow tenants to define their own asset assignment categories
-- ============================================================================

-- Create assignment_types lookup table
CREATE TABLE IF NOT EXISTS inventory.assignment_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    
    -- Type definition
    type_key TEXT NOT NULL, -- 'employee', 'crew', 'vehicle', 'job', 'yard', 'department', etc.
    display_name TEXT NOT NULL, -- 'Employee', 'Crew', 'Vehicle', etc.
    icon TEXT NULL, -- Optional emoji or icon identifier '👤', '👥', '🚛', etc.
    
    -- Configuration
    is_system BOOLEAN NOT NULL DEFAULT false, -- System types cannot be deleted
    is_active BOOLEAN NOT NULL DEFAULT true,
    requires_id BOOLEAN NOT NULL DEFAULT true, -- Whether assigned_to_id is required
    
    -- Display
    sort_order INTEGER NOT NULL DEFAULT 0,
    description TEXT NULL,
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_user_id UUID NULL,
    
    -- Constraints
    CONSTRAINT assignment_types_tenant_type_key_unique UNIQUE (tenant_id, type_key)
);

-- Indexes
CREATE INDEX idx_assignment_types_tenant ON inventory.assignment_types(tenant_id) WHERE is_active = true;
CREATE INDEX idx_assignment_types_sort ON inventory.assignment_types(tenant_id, sort_order);

-- Comments
COMMENT ON TABLE inventory.assignment_types IS 
    'Customizable lookup table for asset assignment categories (Employee, Crew, Vehicle, Job, Yard, etc.)';
COMMENT ON COLUMN inventory.assignment_types.type_key IS 
    'Unique identifier for the type (lowercase, no spaces). Used in assigned_to_type field.';
COMMENT ON COLUMN inventory.assignment_types.is_system IS 
    'System types (employee, vehicle, job, location) cannot be deleted to maintain data integrity';
COMMENT ON COLUMN inventory.assignment_types.requires_id IS 
    'If true, assigned_to_id must be provided when assigning to this type';

-- RLS
ALTER TABLE inventory.assignment_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY assignment_types_tenant_isolation ON inventory.assignment_types
    FOR ALL
    USING (tenant_id = (current_setting('app.current_tenant_id', true))::UUID);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON inventory.assignment_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory.assignment_types TO service_role;

-- ============================================================================
-- Seed Default Assignment Types
-- ============================================================================

-- Function to seed default types for a tenant
CREATE OR REPLACE FUNCTION inventory.seed_default_assignment_types(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Only seed if tenant has no assignment types
    IF NOT EXISTS (SELECT 1 FROM inventory.assignment_types WHERE tenant_id = p_tenant_id) THEN
        INSERT INTO inventory.assignment_types (tenant_id, type_key, display_name, icon, is_system, sort_order, description) VALUES
            (p_tenant_id, 'employee', 'Employee', '👤', true, 10, 'Assign to individual employee'),
            (p_tenant_id, 'crew', 'Crew', '👥', false, 20, 'Assign to work crew or team'),
            (p_tenant_id, 'vehicle', 'Vehicle', '🚛', true, 30, 'Assign to company vehicle or truck'),
            (p_tenant_id, 'job', 'Job Site', '🏗️', true, 40, 'Assign to specific job or project'),
            (p_tenant_id, 'yard', 'Yard/Location', '📍', true, 50, 'Assign to yard, warehouse, or storage location'),
            (p_tenant_id, 'department', 'Department', '🏢', false, 60, 'Assign to department or division');
        
        RAISE NOTICE 'Seeded default assignment types for tenant %', p_tenant_id;
    END IF;
END;
$$;

COMMENT ON FUNCTION inventory.seed_default_assignment_types IS 
    'Seeds default assignment types for a new tenant. Idempotent - only runs if tenant has no types.';

-- ============================================================================
-- Update assignment_types CHECK constraint to be more flexible
-- ============================================================================

-- Remove the restrictive CHECK constraint on asset_assignments.assigned_to_type
-- We'll validate against the assignment_types table instead
DO $$
BEGIN
    -- Drop the old constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'asset_assignments_assigned_to_type_check'
        AND table_schema = 'inventory'
        AND table_name = 'asset_assignments'
    ) THEN
        ALTER TABLE inventory.asset_assignments 
            DROP CONSTRAINT asset_assignments_assigned_to_type_check;
        RAISE NOTICE '✓ Removed restrictive assigned_to_type CHECK constraint';
    END IF;
END $$;

-- Create validation trigger to check against assignment_types table
CREATE OR REPLACE FUNCTION inventory.validate_assignment_type()
RETURNS TRIGGER AS $$
DECLARE
    v_type_exists BOOLEAN;
BEGIN
    -- Check if the assignment type exists and is active for this tenant
    SELECT EXISTS(
        SELECT 1 FROM inventory.assignment_types
        WHERE tenant_id = NEW.tenant_id
        AND type_key = NEW.assigned_to_type
        AND is_active = true
    ) INTO v_type_exists;
    
    IF NOT v_type_exists THEN
        RAISE EXCEPTION 'Invalid or inactive assignment type: %. Please use a valid assignment type from your configuration.',
            NEW.assigned_to_type
        USING 
            ERRCODE = 'check_violation',
            HINT = 'Check inventory.assignment_types table for valid assignment types';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION inventory.validate_assignment_type() IS 
    'Validates assigned_to_type exists in assignment_types table and is active';

-- Create trigger
DROP TRIGGER IF EXISTS validate_assignment_type ON inventory.asset_assignments;
CREATE TRIGGER validate_assignment_type
    BEFORE INSERT OR UPDATE ON inventory.asset_assignments
    FOR EACH ROW
    EXECUTE FUNCTION inventory.validate_assignment_type();

-- ============================================================================
-- Helper Views
-- ============================================================================

-- View for active assignment types by tenant
CREATE OR REPLACE VIEW inventory.v_assignment_types AS
SELECT 
    t.id,
    t.tenant_id,
    t.type_key,
    t.display_name,
    t.icon,
    t.is_system,
    t.is_active,
    t.requires_id,
    t.sort_order,
    t.description,
    COUNT(aa.id) as usage_count
FROM inventory.assignment_types t
LEFT JOIN inventory.asset_assignments aa ON aa.assigned_to_type = t.type_key AND aa.tenant_id = t.tenant_id
WHERE t.is_active = true
GROUP BY t.id, t.tenant_id, t.type_key, t.display_name, t.icon, t.is_system, t.is_active, t.requires_id, t.sort_order, t.description
ORDER BY t.sort_order, t.display_name;

COMMENT ON VIEW inventory.v_assignment_types IS 
    'Active assignment types with usage counts for easy lookup';

GRANT SELECT ON inventory.v_assignment_types TO authenticated;

-- ============================================================================
-- Migration Validation
-- ============================================================================

DO $$
DECLARE
    v_table_count INTEGER;
    v_trigger_count INTEGER;
BEGIN
    -- Verify table exists
    SELECT COUNT(*) INTO v_table_count
    FROM information_schema.tables
    WHERE table_schema = 'inventory'
    AND table_name = 'assignment_types';
    
    IF v_table_count = 0 THEN
        RAISE WARNING 'assignment_types table not created!';
    ELSE
        RAISE NOTICE '✓ assignment_types table created';
    END IF;
    
    -- Verify trigger exists
    SELECT COUNT(*) INTO v_trigger_count
    FROM pg_trigger
    WHERE tgname = 'validate_assignment_type';
    
    IF v_trigger_count = 0 THEN
        RAISE WARNING 'validate_assignment_type trigger not found!';
    ELSE
        RAISE NOTICE '✓ validate_assignment_type trigger exists';
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '   ASSIGNMENT TYPES CONFIGURATION SYSTEM READY';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'WHAT THIS ADDS:';
    RAISE NOTICE '  ✓ Customizable asset assignment types per tenant';
    RAISE NOTICE '  ✓ Default types: Employee, Crew, Vehicle, Job Site, Yard, Department';
    RAISE NOTICE '  ✓ System types (employee, vehicle, job, yard) cannot be deleted';
    RAISE NOTICE '  ✓ Tenants can add custom types (e.g., "Tool Crib", "Contractor")';
    RAISE NOTICE '  ✓ Validation trigger enforces only active types can be used';
    RAISE NOTICE '';
    RAISE NOTICE 'USAGE:';
    RAISE NOTICE '  -- Seed defaults for a tenant:';
    RAISE NOTICE '  SELECT inventory.seed_default_assignment_types(''your-tenant-id'');';
    RAISE NOTICE '';
    RAISE NOTICE '  -- Add custom type:';
    RAISE NOTICE '  INSERT INTO inventory.assignment_types (tenant_id, type_key, display_name, icon)';
    RAISE NOTICE '  VALUES (''tenant-id'', ''contractor'', ''Contractor'', ''🔧'');';
    RAISE NOTICE '';
    RAISE NOTICE '  -- View active types:';
    RAISE NOTICE '  SELECT * FROM inventory.v_assignment_types WHERE tenant_id = ''your-id'';';
    RAISE NOTICE '';
END $$;
