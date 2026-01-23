-- Migration: Add tenants table for syncing tenant data from Core
-- Receives data via webhook events: tenant.created, tenant.updated

-- =====================================================
-- TENANTS TABLE (Synced from Core)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT,
    industry TEXT,
    address JSONB,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for lookups
CREATE INDEX idx_tenants_slug ON public.tenants(slug) WHERE slug IS NOT NULL;
CREATE INDEX idx_tenants_industry ON public.tenants(industry) WHERE industry IS NOT NULL;

-- Grant permissions
GRANT SELECT ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;

COMMENT ON TABLE public.tenants IS 'Tenant information synced from Summit One Core via webhooks';
COMMENT ON COLUMN public.tenants.id IS 'Tenant UUID from Core (matches session tenantId)';
COMMENT ON COLUMN public.tenants.synced_at IS 'Last time this record was updated from Core events';
