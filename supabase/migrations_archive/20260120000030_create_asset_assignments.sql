-- ============================================================================
-- PHASE 4: ASSET ASSIGNMENTS (Custody Tracking)
-- ============================================================================
-- Tracks who has custody of assets (employee, vehicle, job, etc.)

CREATE TABLE inventory.asset_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    asset_id UUID NOT NULL REFERENCES inventory.assets(id) ON DELETE CASCADE,
    assigned_to_type TEXT NOT NULL CHECK (assigned_to_type IN ('employee', 'vehicle', 'job', 'location', 'other')),
    assigned_to_id UUID NOT NULL, -- External ref (employee_id, vehicle_id, job_id, etc.)
    assigned_by_user_id UUID NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    returned_at TIMESTAMPTZ NULL,
    return_condition TEXT NULL CHECK (return_condition IS NULL OR return_condition IN ('good', 'damaged', 'needs_repair', 'lost')),
    notes TEXT NULL,
    last_event_id TEXT NOT NULL, -- ✅ Idempotency key
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT asset_assignments_tenant_last_event_id_unique 
        UNIQUE (tenant_id, last_event_id),
    CONSTRAINT asset_assignments_return_check 
        CHECK (returned_at IS NULL OR returned_at >= assigned_at)
);

-- Indexes
CREATE INDEX idx_asset_assignments_tenant_id ON inventory.asset_assignments(tenant_id);
CREATE INDEX idx_asset_assignments_asset_id ON inventory.asset_assignments(asset_id);
CREATE INDEX idx_asset_assignments_assigned_to ON inventory.asset_assignments(tenant_id, assigned_to_type, assigned_to_id);
CREATE INDEX idx_asset_assignments_assigned_at ON inventory.asset_assignments(tenant_id, assigned_at DESC);
CREATE INDEX idx_asset_assignments_active 
    ON inventory.asset_assignments(tenant_id, asset_id) 
    WHERE returned_at IS NULL;

-- Unique constraint: only one active assignment per asset
CREATE UNIQUE INDEX asset_assignments_active_unique 
    ON inventory.asset_assignments(tenant_id, asset_id) 
    WHERE returned_at IS NULL;

-- Comments
COMMENT ON TABLE inventory.asset_assignments IS 
    'Custody ledger - tracks who has possession of serialized assets';
COMMENT ON COLUMN inventory.asset_assignments.assigned_to_id IS 
    'Foreign key to external system (employee_id, vehicle_id, job_id, etc.)';
COMMENT ON COLUMN inventory.asset_assignments.return_condition IS 
    'Condition of asset when returned (for maintenance tracking)';

-- Enable RLS
ALTER TABLE inventory.asset_assignments ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY asset_assignments_tenant_isolation ON inventory.asset_assignments
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE POLICY asset_assignments_service_role ON inventory.asset_assignments
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_asset_assignments_updated_at
    BEFORE UPDATE ON inventory.asset_assignments
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- View: Currently assigned assets
CREATE OR REPLACE VIEW inventory.v_assets_assigned AS
SELECT 
    aa.tenant_id,
    aa.asset_id,
    a.asset_tag,
    a.serial_number,
    ci.sku,
    ci.name as item_name,
    aa.assigned_to_type,
    aa.assigned_to_id,
    aa.assigned_by_user_id,
    aa.assigned_at,
    aa.notes,
    EXTRACT(DAY FROM (NOW() - aa.assigned_at)) as days_assigned
FROM inventory.asset_assignments aa
JOIN inventory.assets a ON a.id = aa.asset_id
LEFT JOIN inventory.catalog_items ci ON ci.id = a.catalog_item_id
WHERE aa.returned_at IS NULL;

COMMENT ON VIEW inventory.v_assets_assigned IS 
    'Currently assigned assets with custody details';

DO $$ BEGIN
    RAISE NOTICE '✅ Asset assignments table created';
END $$;

