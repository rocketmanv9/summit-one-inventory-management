-- =====================================================
-- ADD DEFAULT DIMENSIONS TO WIDGET REGISTRY
-- =====================================================
-- Adds default_width and default_height columns to widget_registry table

ALTER TABLE public.widget_registry 
ADD COLUMN IF NOT EXISTS default_width INTEGER NOT NULL DEFAULT 4,
ADD COLUMN IF NOT EXISTS default_height INTEGER NOT NULL DEFAULT 4;

COMMENT ON COLUMN public.widget_registry.default_width IS 'Default grid width (1-12)';
COMMENT ON COLUMN public.widget_registry.default_height IS 'Default grid height in units';

-- Update existing rows with sensible defaults based on widget type
UPDATE public.widget_registry
SET 
    default_width = CASE 
        WHEN widget_key LIKE '%_timeseries' OR widget_key LIKE '%_chart%' THEN 6
        WHEN widget_key LIKE '%total_%' OR widget_key LIKE '%_score' OR widget_key LIKE '%_rate' THEN 3
        WHEN widget_key LIKE '%_table' OR widget_key LIKE '%items%' THEN 6
        WHEN widget_key LIKE '%_list' THEN 4
        ELSE 4
    END,
    default_height = CASE 
        WHEN widget_key LIKE '%_timeseries' OR widget_key LIKE '%_chart%' THEN 4
        WHEN widget_key LIKE '%total_%' OR widget_key LIKE '%_score' OR widget_key LIKE '%_rate' THEN 2
        WHEN widget_key LIKE '%_table' OR widget_key LIKE '%items%' THEN 5
        WHEN widget_key LIKE '%_list' THEN 4
        ELSE 3
    END
WHERE default_width = 4 AND default_height = 4;
