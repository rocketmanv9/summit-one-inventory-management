-- ============================================================================
-- PHASE 2: ITEM SUBSTITUTIONS
-- ============================================================================
-- Allows defining alternative/substitute items for auto-replacement

CREATE TABLE inventory.item_substitutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    item_id UUID NOT NULL REFERENCES inventory.catalog_items(id) ON DELETE CASCADE,
    substitute_item_id UUID NOT NULL REFERENCES inventory.catalog_items(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 1,
    conversion_factor NUMERIC(18, 4) NOT NULL DEFAULT 1.0,
    active BOOLEAN DEFAULT TRUE,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT item_substitutions_tenant_item_substitute_unique 
        UNIQUE (tenant_id, item_id, substitute_item_id),
    CONSTRAINT item_substitutions_not_self_reference 
        CHECK (item_id != substitute_item_id),
    CONSTRAINT item_substitutions_priority_check 
        CHECK (priority > 0),
    CONSTRAINT item_substitutions_conversion_factor_check 
        CHECK (conversion_factor > 0)
);

-- Indexes
CREATE INDEX idx_item_substitutions_tenant_id ON inventory.item_substitutions(tenant_id);
CREATE INDEX idx_item_substitutions_item_id ON inventory.item_substitutions(item_id);
CREATE INDEX idx_item_substitutions_substitute_item_id ON inventory.item_substitutions(substitute_item_id);
CREATE INDEX idx_item_substitutions_active 
    ON inventory.item_substitutions(tenant_id, item_id, priority) 
    WHERE active = TRUE;

-- Comments
COMMENT ON TABLE inventory.item_substitutions IS 
    'Defines substitute/alternative items for automatic replacement when primary is unavailable';
COMMENT ON COLUMN inventory.item_substitutions.priority IS 
    'Lower number = higher priority (1 = first choice substitute)';
COMMENT ON COLUMN inventory.item_substitutions.conversion_factor IS 
    'Multiply primary quantity by this to get substitute quantity (e.g., 1 gallon = 4 quarts → 4.0)';

-- Enable RLS
ALTER TABLE inventory.item_substitutions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY item_substitutions_tenant_isolation ON inventory.item_substitutions
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE POLICY item_substitutions_service_role ON inventory.item_substitutions
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_item_substitutions_updated_at
    BEFORE UPDATE ON inventory.item_substitutions
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- Helper function to get substitutes
CREATE OR REPLACE FUNCTION inventory.get_substitutes(
    p_item_id UUID,
    p_tenant_id UUID
)
RETURNS TABLE (
    substitute_item_id UUID,
    sku TEXT,
    name TEXT,
    priority INTEGER,
    conversion_factor NUMERIC,
    qty_available NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.substitute_item_id,
        ci.sku,
        ci.name,
        s.priority,
        s.conversion_factor,
        COALESCE(SUM(sb.qty_available), 0) as qty_available
    FROM inventory.item_substitutions s
    JOIN inventory.catalog_items ci ON ci.id = s.substitute_item_id
    LEFT JOIN inventory.stock_balances sb ON sb.catalog_item_id = s.substitute_item_id 
        AND sb.tenant_id = p_tenant_id
    WHERE s.item_id = p_item_id
    AND s.tenant_id = p_tenant_id
    AND s.active = TRUE
    GROUP BY s.substitute_item_id, ci.sku, ci.name, s.priority, s.conversion_factor
    ORDER BY s.priority ASC, qty_available DESC;
END;
$$;

COMMENT ON FUNCTION inventory.get_substitutes IS 
    'Returns active substitutes for an item, ordered by priority and availability';

DO $$ BEGIN
    RAISE NOTICE '✅ Item substitutions table created';
END $$;

