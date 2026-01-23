-- ============================================================================
-- PHASE 6: CYCLE COUNT VARIANCE APPROVAL
-- ============================================================================
-- Adds variance thresholds and approval workflow

-- Add columns to cycle_counts
ALTER TABLE inventory.cycle_counts
ADD COLUMN IF NOT EXISTS auto_approved BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS approval_required BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS approved_by_user_id UUID NULL,
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS approval_notes TEXT NULL;

-- Add columns to cycle_count_lines
ALTER TABLE inventory.cycle_count_lines
ADD COLUMN IF NOT EXISTS variance_qty NUMERIC NULL,
ADD COLUMN IF NOT EXISTS variance_pct NUMERIC NULL,
ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS auto_approved BOOLEAN DEFAULT FALSE;

-- Comments
COMMENT ON COLUMN inventory.cycle_counts.auto_approved IS 'True if all lines auto-approved (under threshold)';
COMMENT ON COLUMN inventory.cycle_counts.approval_required IS 'True if any line exceeds approval threshold';
COMMENT ON COLUMN inventory.cycle_count_lines.variance_qty IS 'Difference between counted and expected qty';
COMMENT ON COLUMN inventory.cycle_count_lines.variance_pct IS 'Variance as percentage of expected qty';
COMMENT ON COLUMN inventory.cycle_count_lines.requires_approval IS 'True if variance exceeds threshold';

-- Create variance thresholds table
CREATE TABLE IF NOT EXISTS inventory.cycle_count_variance_thresholds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    catalog_item_id UUID NULL, -- NULL = default for all items
    location_id UUID NULL, -- NULL = default for all locations
    item_category_id UUID NULL, -- NULL = all categories
    max_variance_qty NUMERIC NULL, -- Absolute threshold
    max_variance_pct NUMERIC NULL, -- Percentage threshold (0-100)
    requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
    priority INTEGER NOT NULL DEFAULT 100, -- Lower = higher priority (for matching)
    last_event_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT cycle_count_variance_thresholds_tenant_event_key 
        UNIQUE (tenant_id, last_event_id),
    CONSTRAINT fk_variance_threshold_tenant 
        FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_variance_threshold_catalog_item 
        FOREIGN KEY (catalog_item_id) REFERENCES inventory.catalog_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_variance_threshold_location 
        FOREIGN KEY (location_id) REFERENCES inventory.locations(id) ON DELETE CASCADE,
    CONSTRAINT fk_variance_threshold_item_category
        FOREIGN KEY (item_category_id) REFERENCES inventory.item_categories(id) ON DELETE CASCADE
);

ALTER TABLE inventory.cycle_count_variance_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON inventory.cycle_count_variance_thresholds
    USING (tenant_id::TEXT = current_setting('app.current_tenant', TRUE));

CREATE POLICY service_role ON inventory.cycle_count_variance_thresholds
    USING (current_setting('app.bypass_rls', TRUE)::BOOLEAN = TRUE);

-- Indexes
CREATE INDEX idx_variance_thresholds_tenant ON inventory.cycle_count_variance_thresholds(tenant_id);
CREATE INDEX idx_variance_thresholds_item ON inventory.cycle_count_variance_thresholds(tenant_id, catalog_item_id) WHERE catalog_item_id IS NOT NULL;
CREATE INDEX idx_variance_thresholds_location ON inventory.cycle_count_variance_thresholds(tenant_id, location_id) WHERE location_id IS NOT NULL;
CREATE INDEX idx_variance_thresholds_priority ON inventory.cycle_count_variance_thresholds(tenant_id, priority);

-- Updated_at trigger
CREATE TRIGGER set_updated_at BEFORE UPDATE ON inventory.cycle_count_variance_thresholds
FOR EACH ROW EXECUTE FUNCTION inventory.update_updated_at_column();

COMMENT ON TABLE inventory.cycle_count_variance_thresholds IS 
    'Defines variance thresholds for cycle count approval';

-- Function to check if variance requires approval
CREATE OR REPLACE FUNCTION inventory.check_variance_approval(
    p_tenant_id UUID,
    p_catalog_item_id UUID,
    p_location_id UUID,
    p_item_category_id UUID,
    p_variance_qty NUMERIC,
    p_expected_qty NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_threshold RECORD;
    v_variance_pct NUMERIC;
BEGIN
    -- Calculate variance percentage
    IF p_expected_qty = 0 THEN
        v_variance_pct := NULL;
    ELSE
        v_variance_pct := ABS((p_variance_qty / p_expected_qty) * 100);
    END IF;
    
    -- Find most specific threshold (priority order)
    SELECT * INTO v_threshold
    FROM inventory.cycle_count_variance_thresholds
    WHERE tenant_id = p_tenant_id
    AND (catalog_item_id = p_catalog_item_id OR catalog_item_id IS NULL)
    AND (location_id = p_location_id OR location_id IS NULL)
    AND (item_category_id = p_item_category_id OR item_category_id IS NULL)
    ORDER BY priority ASC
    LIMIT 1;
    
    -- If no threshold found, require approval for any variance
    IF NOT FOUND THEN
        RETURN (p_variance_qty != 0);
    END IF;
    
    -- Check thresholds
    IF v_threshold.max_variance_qty IS NOT NULL AND ABS(p_variance_qty) > v_threshold.max_variance_qty THEN
        RETURN TRUE;
    END IF;
    
    IF v_threshold.max_variance_pct IS NOT NULL AND v_variance_pct IS NOT NULL 
       AND v_variance_pct > v_threshold.max_variance_pct THEN
        RETURN TRUE;
    END IF;
    
    RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION inventory.check_variance_approval IS 
    'Determines if variance requires approval based on thresholds';

-- Seed default threshold (10 qty or 5% variance)
INSERT INTO inventory.cycle_count_variance_thresholds (
    tenant_id,
    max_variance_qty,
    max_variance_pct,
    requires_approval,
    priority,
    last_event_id
)
SELECT 
    t.id,
    10,
    5.0,
    TRUE,
    999,
    'seed_default_threshold_' || t.id::TEXT
FROM public.tenants t
ON CONFLICT (tenant_id, last_event_id) DO NOTHING;

DO $$ BEGIN
    RAISE NOTICE '✅ Cycle count variance approval system created';
END $$;

