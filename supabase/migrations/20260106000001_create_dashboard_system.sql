-- =====================================================
-- DASHBOARD SYSTEM TABLES
-- =====================================================
-- Multi-tenant dashboard builder with customizable widgets

-- =====================================================
-- 1. DASHBOARDS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_dashboard_name_per_tenant UNIQUE (tenant_id, name)
);

-- Indexes
CREATE INDEX idx_dashboards_tenant_id ON public.dashboards(tenant_id);
CREATE INDEX idx_dashboards_is_default ON public.dashboards(tenant_id, is_default) WHERE is_default = true;

-- Comments
COMMENT ON TABLE public.dashboards IS 'Named dashboards for multi-tenant customizable dashboard builder';
COMMENT ON COLUMN public.dashboards.is_default IS 'Only one dashboard per tenant should be default';

-- =====================================================
-- 2. DASHBOARD WIDGETS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.dashboard_widgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    dashboard_id UUID NOT NULL REFERENCES public.dashboards(id) ON DELETE CASCADE,
    widget_key TEXT NOT NULL,
    title TEXT,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    layout JSONB NOT NULL DEFAULT '{"x": 0, "y": 0, "w": 4, "h": 4}'::jsonb,
    refresh_seconds INTEGER NOT NULL DEFAULT 300,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT fk_dashboard_widgets_dashboard FOREIGN KEY (dashboard_id) REFERENCES public.dashboards(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_dashboard_widgets_tenant_id ON public.dashboard_widgets(tenant_id);
CREATE INDEX idx_dashboard_widgets_dashboard_id ON public.dashboard_widgets(dashboard_id);
CREATE INDEX idx_dashboard_widgets_widget_key ON public.dashboard_widgets(widget_key);

-- Comments
COMMENT ON TABLE public.dashboard_widgets IS 'Widget instances placed on dashboards with configuration and layout';
COMMENT ON COLUMN public.dashboard_widgets.widget_key IS 'References widget_registry.widget_key';
COMMENT ON COLUMN public.dashboard_widgets.config IS 'Widget-specific configuration (filters, display options, etc.)';
COMMENT ON COLUMN public.dashboard_widgets.layout IS 'Grid layout position: {x, y, w, h} plus optional breakpoints';
COMMENT ON COLUMN public.dashboard_widgets.refresh_seconds IS 'Auto-refresh interval in seconds';

-- =====================================================
-- 3. WIDGET REGISTRY TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.widget_registry (
    widget_key TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    default_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    allowed_filters JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_widget_registry_domain ON public.widget_registry(domain);
CREATE INDEX idx_widget_registry_is_enabled ON public.widget_registry(is_enabled) WHERE is_enabled = true;

-- Comments
COMMENT ON TABLE public.widget_registry IS 'Catalog of available widget types across all tenants';
COMMENT ON COLUMN public.widget_registry.widget_key IS 'Unique identifier for widget type (e.g., inventory.widget.items_below_reorder)';
COMMENT ON COLUMN public.widget_registry.domain IS 'Widget category: inventory, flow, procurement, alerts, exec';
COMMENT ON COLUMN public.widget_registry.allowed_filters IS 'List of configurable filter keys this widget supports';

-- =====================================================
-- 4. ROW LEVEL SECURITY POLICIES
-- =====================================================

-- Enable RLS
ALTER TABLE public.dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.widget_registry ENABLE ROW LEVEL SECURITY;

-- Dashboards policies
CREATE POLICY "Tenants can view their own dashboards"
    ON public.dashboards FOR SELECT
    USING (tenant_id::text = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'));

CREATE POLICY "Tenants can create their own dashboards"
    ON public.dashboards FOR INSERT
    WITH CHECK (tenant_id::text = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'));

CREATE POLICY "Tenants can update their own dashboards"
    ON public.dashboards FOR UPDATE
    USING (tenant_id::text = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'))
    WITH CHECK (tenant_id::text = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'));

CREATE POLICY "Tenants can delete their own dashboards"
    ON public.dashboards FOR DELETE
    USING (tenant_id::text = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'));

-- Dashboard widgets policies
CREATE POLICY "Tenants can view their own widgets"
    ON public.dashboard_widgets FOR SELECT
    USING (tenant_id::text = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'));

CREATE POLICY "Tenants can create their own widgets"
    ON public.dashboard_widgets FOR INSERT
    WITH CHECK (tenant_id::text = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'));

CREATE POLICY "Tenants can update their own widgets"
    ON public.dashboard_widgets FOR UPDATE
    USING (tenant_id::text = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'))
    WITH CHECK (tenant_id::text = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'));

CREATE POLICY "Tenants can delete their own widgets"
    ON public.dashboard_widgets FOR DELETE
    USING (tenant_id::text = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'));

-- Widget registry policies (readable by all authenticated users)
CREATE POLICY "Authenticated users can view widget registry"
    ON public.widget_registry FOR SELECT
    TO authenticated
    USING (is_enabled = true);

-- Service role can manage widget registry
CREATE POLICY "Service role can manage widget registry"
    ON public.widget_registry FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- =====================================================
-- 5. UPDATED_AT TRIGGERS
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_dashboards_updated_at
    BEFORE UPDATE ON public.dashboards
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dashboard_widgets_updated_at
    BEFORE UPDATE ON public.dashboard_widgets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_widget_registry_updated_at
    BEFORE UPDATE ON public.widget_registry
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 6. GRANTS
-- =====================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_widgets TO authenticated;
GRANT SELECT ON public.widget_registry TO authenticated;
GRANT ALL ON public.widget_registry TO service_role;
