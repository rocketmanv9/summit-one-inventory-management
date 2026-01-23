-- Migration: Add dashboard scope and ownership for proper user isolation
-- This fixes the issue where all users in a tenant can see each other's personal dashboards

BEGIN;

-- Add scope and ownership columns
ALTER TABLE public.dashboards 
ADD COLUMN scope TEXT NOT NULL DEFAULT 'user',
ADD COLUMN owner_user_id UUID,
ADD COLUMN role_key TEXT;

-- Migrate existing data: set owner_user_id from created_by for existing dashboards
UPDATE public.dashboards
SET owner_user_id = created_by,
    scope = 'user'
WHERE created_by IS NOT NULL AND created_by != '00000000-0000-0000-0000-000000000000'::uuid;

-- Set scope to 'tenant' for system dashboards (those with null/placeholder created_by)
UPDATE public.dashboards
SET scope = 'tenant',
    owner_user_id = NULL
WHERE created_by IS NULL OR created_by = '00000000-0000-0000-0000-000000000000'::uuid;

-- Add constraints AFTER data is migrated
ALTER TABLE public.dashboards
ADD CONSTRAINT dashboards_scope_enum_check CHECK (scope IN ('tenant', 'role', 'user')),
ADD CONSTRAINT dashboards_scope_check CHECK (
    (scope = 'role' AND role_key IS NOT NULL) OR
    (scope = 'user' AND owner_user_id IS NOT NULL) OR
    (scope = 'tenant')
);

-- Add indexes
CREATE INDEX idx_dashboards_scope ON public.dashboards(tenant_id, scope);
CREATE INDEX idx_dashboards_owner_user_id ON public.dashboards(tenant_id, owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX idx_dashboards_role_key ON public.dashboards(tenant_id, role_key) WHERE role_key IS NOT NULL;

-- Drop old RLS policies
DROP POLICY IF EXISTS "Tenants can view their own dashboards" ON public.dashboards;
DROP POLICY IF EXISTS "Tenants can create their own dashboards" ON public.dashboards;
DROP POLICY IF EXISTS "Tenants can update their own dashboards" ON public.dashboards;
DROP POLICY IF EXISTS "Tenants can delete their own dashboards" ON public.dashboards;

-- Create new RLS policies with scope awareness
CREATE POLICY "Users can view dashboards based on scope"
    ON public.dashboards FOR SELECT
    USING (
        tenant_id::text = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
        AND (
            scope = 'tenant'  -- Everyone in tenant can see tenant-wide dashboards
            OR (scope = 'role' AND role_key = (auth.jwt() -> 'app_metadata' ->> 'role'))  -- Role-specific dashboards
            OR (scope = 'user' AND owner_user_id::text = (auth.jwt() ->> 'sub'))  -- User's own dashboards
        )
    );

CREATE POLICY "Users can create dashboards in their tenant"
    ON public.dashboards FOR INSERT
    WITH CHECK (
        tenant_id::text = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
        AND (
            (scope = 'user' AND owner_user_id::text = (auth.jwt() ->> 'sub'))
            OR (scope = 'tenant')
            OR (scope = 'role')
        )
    );

CREATE POLICY "Users can update their own dashboards or tenant admins can update tenant dashboards"
    ON public.dashboards FOR UPDATE
    USING (
        tenant_id::text = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
        AND (
            (scope = 'user' AND owner_user_id::text = (auth.jwt() ->> 'sub'))
            OR (scope = 'tenant' AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
            OR (scope = 'role' AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
        )
    );

CREATE POLICY "Users can delete their own dashboards or admins can delete tenant dashboards"
    ON public.dashboards FOR DELETE
    USING (
        tenant_id::text = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
        AND (
            (scope = 'user' AND owner_user_id::text = (auth.jwt() ->> 'sub'))
            OR ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
        )
    );

-- Add comments
COMMENT ON COLUMN public.dashboards.scope IS 'Access scope: tenant (all users), role (specific role), user (personal)';
COMMENT ON COLUMN public.dashboards.owner_user_id IS 'User ID who owns this dashboard (for scope=user)';
COMMENT ON COLUMN public.dashboards.role_key IS 'Role key for role-specific dashboards (for scope=role)';

COMMIT;
