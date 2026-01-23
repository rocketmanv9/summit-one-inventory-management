-- Add description column to dashboards table
-- This was missing from the original schema but is used by the frontend

ALTER TABLE public.dashboards
ADD COLUMN IF NOT EXISTS description TEXT NULL;

COMMENT ON COLUMN public.dashboards.description IS 
    'Optional description of the dashboard purpose and contents';
