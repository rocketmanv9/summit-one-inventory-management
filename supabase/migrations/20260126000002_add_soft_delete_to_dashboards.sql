-- =====================================================
-- ADD SOFT DELETE TO DASHBOARDS
-- =====================================================
-- Adds deleted_at timestamp for soft deletion support
-- Allows recovery of accidentally deleted dashboards

-- Add deleted_at column to dashboards
ALTER TABLE public.dashboards 
ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Add index for filtering out deleted dashboards
CREATE INDEX idx_dashboards_deleted_at ON public.dashboards(tenant_id, deleted_at) 
WHERE deleted_at IS NULL;

-- Add comment
COMMENT ON COLUMN public.dashboards.deleted_at IS 'Timestamp when dashboard was soft-deleted. NULL means active.';

-- Update the default dashboard index to exclude deleted dashboards
DROP INDEX IF EXISTS idx_dashboards_is_default;
CREATE INDEX idx_dashboards_is_default ON public.dashboards(tenant_id, is_default) 
WHERE is_default = true AND deleted_at IS NULL;
