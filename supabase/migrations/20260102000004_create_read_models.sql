-- Migration: Create read models (fast, queryable state)
-- These are what dashboards hit - rebuilt/updated by pollers from event ledger

-- =====================================================
-- STOCK BALANCES TABLE
-- =====================================================
CREATE TABLE inventory.stock_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    catalog_item_id UUID NOT NULL REFERENCES inventory.catalog_items(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES inventory.locations(id) ON DELETE CASCADE,
    qty_on_hand NUMERIC(18, 4) NOT NULL DEFAULT 0,
    qty_reserved NUMERIC(18, 4) NOT NULL DEFAULT 0,
    qty_available NUMERIC(18, 4) GENERATED ALWAYS AS (qty_on_hand - qty_reserved) STORED,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint: one balance record per item per location
    CONSTRAINT stock_balances_tenant_item_location_unique UNIQUE (tenant_id, catalog_item_id, location_id),
    
    -- Check constraints
    CONSTRAINT stock_balances_qty_on_hand_check CHECK (qty_on_hand >= 0),
    CONSTRAINT stock_balances_qty_reserved_check CHECK (qty_reserved >= 0)
);

-- Indexes for stock_balances
CREATE INDEX idx_stock_balances_tenant_id ON inventory.stock_balances(tenant_id);
CREATE INDEX idx_stock_balances_catalog_item_id ON inventory.stock_balances(catalog_item_id);
CREATE INDEX idx_stock_balances_location_id ON inventory.stock_balances(location_id);
CREATE INDEX idx_stock_balances_qty_available ON inventory.stock_balances(tenant_id, catalog_item_id) WHERE qty_available > 0;
CREATE INDEX idx_stock_balances_updated_at ON inventory.stock_balances(updated_at DESC);

-- =====================================================
-- RESERVATIONS TABLE
-- =====================================================
-- Supports "reserved/allocated/committed" inventory
CREATE TABLE inventory.reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    catalog_item_id UUID NOT NULL REFERENCES inventory.catalog_items(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES inventory.locations(id) ON DELETE CASCADE,
    qty NUMERIC(18, 4) NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fulfilled', 'cancelled', 'expired')),
    needed_by DATE NULL,
    job_ref JSONB NULL, -- Reference to job, project, work order, etc.
    last_event_id TEXT NOT NULL, -- ✅ Idempotency key linking to inventory_events
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fulfilled_at TIMESTAMPTZ NULL,
    
    -- Unique constraint for idempotency
    CONSTRAINT reservations_tenant_last_event_id_unique UNIQUE (tenant_id, last_event_id),
    
    -- Check constraint
    CONSTRAINT reservations_qty_check CHECK (qty > 0)
);

-- Indexes for reservations
CREATE INDEX idx_reservations_tenant_id ON inventory.reservations(tenant_id);
CREATE INDEX idx_reservations_catalog_item_id ON inventory.reservations(catalog_item_id);
CREATE INDEX idx_reservations_location_id ON inventory.reservations(location_id);
CREATE INDEX idx_reservations_status ON inventory.reservations(tenant_id, status);
CREATE INDEX idx_reservations_needed_by ON inventory.reservations(tenant_id, needed_by) WHERE needed_by IS NOT NULL;
CREATE INDEX idx_reservations_job_ref ON inventory.reservations USING GIN (job_ref) WHERE job_ref IS NOT NULL;
CREATE INDEX idx_reservations_active ON inventory.reservations(tenant_id, catalog_item_id, location_id) WHERE status = 'active';

-- =====================================================
-- ASSET STATE TABLE
-- =====================================================
-- Current state of each asset (rebuilt from asset_events)
CREATE TABLE inventory.asset_state (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    asset_id UUID NOT NULL REFERENCES inventory.assets(id) ON DELETE CASCADE,
    current_location_id UUID NULL REFERENCES inventory.locations(id) ON DELETE SET NULL,
    current_status TEXT NOT NULL CHECK (current_status IN ('available', 'assigned', 'in_repair', 'out_of_service', 'retired')),
    assigned_to_ref JSONB NULL, -- Job, crew, person reference
    last_movement_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint: one state record per asset
    CONSTRAINT asset_state_tenant_asset_unique UNIQUE (tenant_id, asset_id)
);

-- Indexes for asset_state
CREATE INDEX idx_asset_state_tenant_id ON inventory.asset_state(tenant_id);
CREATE INDEX idx_asset_state_asset_id ON inventory.asset_state(asset_id);
CREATE INDEX idx_asset_state_current_location_id ON inventory.asset_state(current_location_id) WHERE current_location_id IS NOT NULL;
CREATE INDEX idx_asset_state_current_status ON inventory.asset_state(tenant_id, current_status);
CREATE INDEX idx_asset_state_assigned_to_ref ON inventory.asset_state USING GIN (assigned_to_ref) WHERE assigned_to_ref IS NOT NULL;
CREATE INDEX idx_asset_state_updated_at ON inventory.asset_state(updated_at DESC);

-- =====================================================
-- DAILY ITEM ACTIVITY TABLE (optional but recommended)
-- =====================================================
-- Aggregates for charts and analytics - makes dashboards snappy
CREATE TABLE inventory.daily_item_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    activity_date DATE NOT NULL,
    catalog_item_id UUID NOT NULL REFERENCES inventory.catalog_items(id) ON DELETE CASCADE,
    location_id UUID NULL REFERENCES inventory.locations(id) ON DELETE CASCADE,
    qty_received NUMERIC(18, 4) NOT NULL DEFAULT 0,
    qty_issued NUMERIC(18, 4) NOT NULL DEFAULT 0,
    qty_adjusted NUMERIC(18, 4) NOT NULL DEFAULT 0,
    qty_transferred_in NUMERIC(18, 4) NOT NULL DEFAULT 0,
    qty_transferred_out NUMERIC(18, 4) NOT NULL DEFAULT 0,
    net_change NUMERIC(18, 4) GENERATED ALWAYS AS (
        qty_received + qty_adjusted + qty_transferred_in - qty_issued - qty_transferred_out
    ) STORED,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint
    CONSTRAINT daily_item_activity_unique UNIQUE (tenant_id, activity_date, catalog_item_id, location_id)
);

-- Indexes for daily_item_activity
CREATE INDEX idx_daily_item_activity_tenant_id ON inventory.daily_item_activity(tenant_id);
CREATE INDEX idx_daily_item_activity_date ON inventory.daily_item_activity(tenant_id, activity_date DESC);
CREATE INDEX idx_daily_item_activity_catalog_item_id ON inventory.daily_item_activity(catalog_item_id);
CREATE INDEX idx_daily_item_activity_location_id ON inventory.daily_item_activity(location_id) WHERE location_id IS NOT NULL;

-- =====================================================
-- DAILY ASSET METRICS TABLE (optional)
-- =====================================================
-- Aggregated asset metrics by day
CREATE TABLE inventory.daily_asset_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    activity_date DATE NOT NULL,
    asset_type TEXT NULL, -- Optional grouping by type/category
    category_id UUID NULL REFERENCES inventory.item_categories(id) ON DELETE SET NULL,
    count_available INTEGER NOT NULL DEFAULT 0,
    count_assigned INTEGER NOT NULL DEFAULT 0,
    count_in_repair INTEGER NOT NULL DEFAULT 0,
    count_out_of_service INTEGER NOT NULL DEFAULT 0,
    downtime_hours NUMERIC(10, 2) NULL,
    utilization_rate NUMERIC(5, 2) NULL, -- Percentage
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index (using expression for nullable columns)
CREATE UNIQUE INDEX daily_asset_metrics_unique_idx 
    ON inventory.daily_asset_metrics(tenant_id, activity_date, COALESCE(asset_type, ''), COALESCE(category_id::TEXT, ''));

-- Indexes for daily_asset_metrics
CREATE INDEX idx_daily_asset_metrics_tenant_id ON inventory.daily_asset_metrics(tenant_id);
CREATE INDEX idx_daily_asset_metrics_date ON inventory.daily_asset_metrics(tenant_id, activity_date DESC);
CREATE INDEX idx_daily_asset_metrics_category_id ON inventory.daily_asset_metrics(category_id) WHERE category_id IS NOT NULL;

-- =====================================================
-- RLS POLICIES - STOCK_BALANCES
-- =====================================================
ALTER TABLE inventory.stock_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_balances_tenant_isolation ON inventory.stock_balances
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- RLS POLICIES - RESERVATIONS
-- =====================================================
ALTER TABLE inventory.reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY reservations_tenant_isolation ON inventory.reservations
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- RLS POLICIES - ASSET_STATE
-- =====================================================
ALTER TABLE inventory.asset_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY asset_state_tenant_isolation ON inventory.asset_state
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- RLS POLICIES - DAILY_ITEM_ACTIVITY
-- =====================================================
ALTER TABLE inventory.daily_item_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_item_activity_tenant_isolation ON inventory.daily_item_activity
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- RLS POLICIES - DAILY_ASSET_METRICS
-- =====================================================
ALTER TABLE inventory.daily_asset_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_asset_metrics_tenant_isolation ON inventory.daily_asset_metrics
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- UPDATED_AT TRIGGERS
-- =====================================================
CREATE TRIGGER update_stock_balances_updated_at
    BEFORE UPDATE ON inventory.stock_balances
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

CREATE TRIGGER update_reservations_updated_at
    BEFORE UPDATE ON inventory.reservations
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

CREATE TRIGGER update_asset_state_updated_at
    BEFORE UPDATE ON inventory.asset_state
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

CREATE TRIGGER update_daily_item_activity_updated_at
    BEFORE UPDATE ON inventory.daily_item_activity
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

CREATE TRIGGER update_daily_asset_metrics_updated_at
    BEFORE UPDATE ON inventory.daily_asset_metrics
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON TABLE inventory.stock_balances IS 'Current stock levels per item per location - rebuilt from inventory_events';
COMMENT ON TABLE inventory.reservations IS 'Active reservations/allocations - prevents overselling';
COMMENT ON TABLE inventory.asset_state IS 'Current state of each asset - rebuilt from asset_events';
COMMENT ON TABLE inventory.daily_item_activity IS 'Daily aggregated activity for charts and analytics';
COMMENT ON TABLE inventory.daily_asset_metrics IS 'Daily aggregated asset metrics for dashboards';
COMMENT ON COLUMN inventory.stock_balances.qty_available IS 'Computed as qty_on_hand - qty_reserved';
COMMENT ON COLUMN inventory.daily_item_activity.net_change IS 'Computed as received + adjusted + transferred_in - issued - transferred_out';
