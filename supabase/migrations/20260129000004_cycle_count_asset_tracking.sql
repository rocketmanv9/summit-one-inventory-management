-- Add asset tracking for cycle counts
-- For serialized items, we need to know WHICH specific assets were found

-- Create junction table to track counted assets
CREATE TABLE IF NOT EXISTS inventory.cycle_count_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    cycle_count_line_id UUID NOT NULL REFERENCES inventory.cycle_count_lines(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES inventory.assets(id) ON DELETE CASCADE,
    was_expected BOOLEAN NOT NULL DEFAULT false, -- Was this asset expected to be here?
    was_found BOOLEAN NOT NULL DEFAULT true, -- Was this asset actually found during count?
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT unique_cycle_count_asset UNIQUE (cycle_count_line_id, asset_id)
);

-- RLS
ALTER TABLE inventory.cycle_count_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY cycle_count_assets_tenant_isolation ON inventory.cycle_count_assets
    FOR ALL USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

-- Indexes
CREATE INDEX idx_cycle_count_assets_tenant ON inventory.cycle_count_assets(tenant_id);
CREATE INDEX idx_cycle_count_assets_line ON inventory.cycle_count_assets(cycle_count_line_id);
CREATE INDEX idx_cycle_count_assets_asset ON inventory.cycle_count_assets(asset_id);
CREATE INDEX idx_cycle_count_assets_found ON inventory.cycle_count_assets(tenant_id, was_found) WHERE was_found = true;

-- Comments
COMMENT ON TABLE inventory.cycle_count_assets IS 'Tracks which specific assets were found during cycle counts for serialized items';
COMMENT ON COLUMN inventory.cycle_count_assets.was_expected IS 'True if this asset was expected to be at this location based on inventory records';
COMMENT ON COLUMN inventory.cycle_count_assets.was_found IS 'True if this asset was physically found during the count';
