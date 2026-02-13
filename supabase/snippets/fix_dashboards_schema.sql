-- Fix dashboards table schema to match API expectations
-- Run this in Supabase SQL Editor

BEGIN;

-- Add missing columns
ALTER TABLE public.dashboards 
ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'user',
ADD COLUMN IF NOT EXISTS owner_user_id UUID,
ADD COLUMN IF NOT EXISTS role_key TEXT;

-- Update existing records to have proper ownership
UPDATE public.dashboards
SET owner_user_id = created_by,
    scope = 'user'
WHERE created_by IS NOT NULL 
  AND created_by != '00000000-0000-0000-0000-000000000000'::uuid
  AND owner_user_id IS NULL;

-- Set scope to 'tenant' for system dashboards
UPDATE public.dashboards
SET scope = 'tenant',
    owner_user_id = NULL
WHERE (created_by IS NULL OR created_by = '00000000-0000-0000-0000-000000000000'::uuid)
  AND scope != 'tenant';

-- Add constraints
ALTER TABLE public.dashboards
DROP CONSTRAINT IF EXISTS dashboards_scope_enum_check,
DROP CONSTRAINT IF EXISTS dashboards_scope_check;

ALTER TABLE public.dashboards
ADD CONSTRAINT dashboards_scope_enum_check CHECK (scope IN ('tenant', 'role', 'user')),
ADD CONSTRAINT dashboards_scope_check CHECK (
    (scope = 'role' AND role_key IS NOT NULL) OR
    (scope = 'user' AND owner_user_id IS NOT NULL) OR
    (scope = 'tenant')
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_dashboards_scope ON public.dashboards(tenant_id, scope);
CREATE INDEX IF NOT EXISTS idx_dashboards_owner_user_id ON public.dashboards(tenant_id, owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dashboards_role_key ON public.dashboards(tenant_id, role_key) WHERE role_key IS NOT NULL;

-- Verify the changes
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'dashboards'
  AND column_name IN ('scope', 'owner_user_id', 'role_key')
ORDER BY column_name;

COMMIT;

-- Show results
SELECT 'Dashboards table schema fixed successfully!' as status;
