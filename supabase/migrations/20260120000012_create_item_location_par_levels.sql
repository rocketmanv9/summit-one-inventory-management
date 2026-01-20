-- ============================================================================
-- PHASE 2: ITEM LOCATION PAR LEVELS
-- ============================================================================
-- Defines min/max/reorder levels per item per location

CREATE TABLE inventory.item_location_par_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    catalog_item_id UUID NOT NULL REFERENCES inventory.catalog_items(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES inventory.locations(id) ON DELETE CASCADE,
    min_qty NUMERIC(18, 4) NOT NULL DEFAULT 0,
    max_qty NUMERIC(18, 4) NULL,
    reorder_point NUMERIC(18, 4) NULL,
    safety_stock NUMERIC(18, 4) NOT NULL DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT item_location_par_levels_tenant_item_location_unique 
        UNIQUE (tenant_id, catalog_item_id, location_id),
    CONSTRAINT item_location_par_levels_min_qty_check 
        CHECK (min_qty >= 0),
    CONSTRAINT item_location_par_levels_max_qty_check 
        CHECK (max_qty IS NULL OR max_qty > min_qty),
    CONSTRAINT item_location_par_levels_reorder_point_check 
        CHECK (reorder_point IS NULL OR reorder_point >= min_qty),
    CONSTRAINT item_location_par_levels_safety_stock_check 
        CHECK (safety_stock >= 0)
);

-- Indexes
CREATE INDEX idx_item_location_par_levels_tenant_id 
    ON inventory.item_location_par_levels(tenant_id);
CREATE INDEX idx_item_location_par_levels_item_id 
    ON inventory.item_location_par_levels(catalog_item_id);
CREATE INDEX idx_item_location_par_levels_location_id 
    ON inventory.item_location_par_levels(location_id);
CREATE INDEX idx_item_location_par_levels_active 
    ON inventory.item_location_par_levels(tenant_id, active) 
    WHERE active = TRUE;

-- Comments
COMMENT ON TABLE inventory.item_location_par_levels IS 
    'Min/max/reorder point settings per item per location for inventory optimization';
COMMENT ON COLUMN inventory.item_location_par_levels.min_qty IS 
    'Minimum quantity to maintain at this location';
COMMENT ON COLUMN inventory.item_location_par_levels.max_qty IS 
    'Maximum quantity target (for restocking "up to" workflows)';
COMMENT ON COLUMN inventory.item_location_par_levels.reorder_point IS 
    'Trigger auto-ordering when qty drops below this level';
COMMENT ON COLUMN inventory.item_location_par_levels.safety_stock IS 
    'Buffer stock to account for lead time variability';

-- Enable RLS
ALTER TABLE inventory.item_location_par_levels ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY item_location_par_levels_tenant_isolation ON inventory.item_location_par_levels
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE POLICY item_location_par_levels_service_role ON inventory.item_location_par_levels
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_item_location_par_levels_updated_at
    BEFORE UPDATE ON inventory.item_location_par_levels
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- View: Items below par level by location
CREATE OR REPLACE VIEW inventory.v_items_below_par AS
SELECT 
    pl.tenant_id,
    pl.catalog_item_id,
    ci.sku,
    ci.name,
    pl.location_id,
    l.name as location_name,
    COALESCE(sb.qty_on_hand, 0) as qty_on_hand,
    COALESCE(sb.qty_available, 0) as qty_available,
    pl.min_qty,
    pl.max_qty,
    pl.reorder_point,
    pl.safety_stock,
    (pl.min_qty - COALESCE(sb.qty_on_hand, 0)) as qty_below_min,
    CASE 
        WHEN pl.reorder_point IS NOT NULL AND COALESCE(sb.qty_on_hand, 0) <= pl.reorder_point THEN 'REORDER'
        WHEN COALESCE(sb.qty_on_hand, 0) < pl.min_qty THEN 'BELOW_MIN'
        ELSE 'OK'
    END as status
FROM inventory.item_location_par_levels pl
JOIN inventory.catalog_items ci ON ci.id = pl.catalog_item_id
JOIN inventory.locations l ON l.id = pl.location_id
LEFT JOIN inventory.stock_balances sb ON sb.catalog_item_id = pl.catalog_item_id 
    AND sb.location_id = pl.location_id
    AND sb.tenant_id = pl.tenant_id
WHERE pl.active = TRUE
AND (
    (pl.reorder_point IS NOT NULL AND COALESCE(sb.qty_on_hand, 0) <= pl.reorder_point)
    OR COALESCE(sb.qty_on_hand, 0) < pl.min_qty
);

COMMENT ON VIEW inventory.v_items_below_par IS 
    'Items currently below their par levels (triggers restocking/reordering)';

DO $$ BEGIN
    RAISE NOTICE '✅ Item location par levels created';
END $$;

