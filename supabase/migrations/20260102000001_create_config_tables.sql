-- Migration: Create dashboard and widget configuration tables
-- These tables enable fully customizable dashboards per tenant, role, or user

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- DASHBOARDS TABLE
-- =====================================================
CREATE TABLE inventory.dashboards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    scope TEXT NOT NULL,
    role_key TEXT NULL,
    owner_user_id UUID NULL,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT dashboards_scope_enum_check CHECK (scope IN ('tenant', 'role', 'user')),
    CONSTRAINT dashboards_scope_check CHECK (
        (scope = 'role' AND role_key IS NOT NULL) OR
        (scope = 'user' AND owner_user_id IS NOT NULL) OR
        (scope = 'tenant')
    )
);

-- Indexes for dashboards
CREATE INDEX idx_dashboards_tenant_id ON inventory.dashboards(tenant_id);
CREATE INDEX idx_dashboards_tenant_scope ON inventory.dashboards(tenant_id, scope);
CREATE INDEX idx_dashboards_role_key ON inventory.dashboards(tenant_id, role_key) WHERE role_key IS NOT NULL;
CREATE INDEX idx_dashboards_owner_user_id ON inventory.dashboards(tenant_id, owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX idx_dashboards_default ON inventory.dashboards(tenant_id, is_default) WHERE is_default = TRUE;

-- =====================================================
-- DASHBOARD WIDGETS TABLE
-- =====================================================
CREATE TABLE inventory.dashboard_widgets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    dashboard_id UUID NOT NULL REFERENCES inventory.dashboards(id) ON DELETE CASCADE,
    widget_type TEXT NOT NULL,
    title TEXT NOT NULL,
    layout JSONB NOT NULL, -- {x, y, w, h}
    query_def JSONB NOT NULL, -- saved metric + filters
    visual_def JSONB NOT NULL, -- columns, chart config, thresholds
    refresh_mode TEXT NOT NULL DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT dashboard_widgets_widget_type_check CHECK (widget_type IN ('kpi', 'table', 'chart', 'alert', 'map', 'activity')),
    CONSTRAINT dashboard_widgets_refresh_mode_check CHECK (refresh_mode IN ('manual', 'interval', 'on_event'))
);

-- Indexes for dashboard_widgets
CREATE INDEX idx_dashboard_widgets_tenant_id ON inventory.dashboard_widgets(tenant_id);
CREATE INDEX idx_dashboard_widgets_dashboard_id ON inventory.dashboard_widgets(dashboard_id);
CREATE INDEX idx_dashboard_widgets_widget_type ON inventory.dashboard_widgets(tenant_id, widget_type);

-- =====================================================
-- RLS POLICIES - DASHBOARDS
-- =====================================================
ALTER TABLE inventory.dashboards ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see dashboards in their tenant
CREATE POLICY dashboards_tenant_isolation ON inventory.dashboards
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- RLS POLICIES - DASHBOARD_WIDGETS
-- =====================================================
ALTER TABLE inventory.dashboard_widgets ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see widgets in their tenant
CREATE POLICY dashboard_widgets_tenant_isolation ON inventory.dashboard_widgets
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- UPDATED_AT TRIGGER FUNCTION
-- =====================================================
CREATE OR REPLACE FUNCTION inventory.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER update_dashboards_updated_at
    BEFORE UPDATE ON inventory.dashboards
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

CREATE TRIGGER update_dashboard_widgets_updated_at
    BEFORE UPDATE ON inventory.dashboard_widgets
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON TABLE inventory.dashboards IS 'Customizable dashboard configurations per tenant, role, or user';
COMMENT ON TABLE inventory.dashboard_widgets IS 'Widget configurations that query read models and display data';
COMMENT ON COLUMN inventory.dashboard_widgets.query_def IS 'Saved metric definitions and filters for data queries';
COMMENT ON COLUMN inventory.dashboard_widgets.visual_def IS 'Visual configuration: columns, chart settings, thresholds';
