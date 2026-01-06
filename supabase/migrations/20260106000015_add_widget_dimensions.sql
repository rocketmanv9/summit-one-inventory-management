-- Add default width and height to widget registry
ALTER TABLE public.widget_registry 
ADD COLUMN IF NOT EXISTS default_width INTEGER NOT NULL DEFAULT 4,
ADD COLUMN IF NOT EXISTS default_height INTEGER NOT NULL DEFAULT 4;

-- Update existing widgets with sensible defaults based on their type
UPDATE public.widget_registry
SET 
  default_width = CASE 
    WHEN default_config->>'display' = 'metric' THEN 3
    WHEN default_config->>'display' = 'gauge' THEN 3
    WHEN default_config->>'display' IN ('pie_chart', 'bar_chart') THEN 6
    WHEN default_config->>'display' IN ('line_chart', 'timeline') THEN 8
    WHEN default_config->>'display' IN ('table', 'alert_list') THEN 6
    ELSE 4
  END,
  default_height = CASE 
    WHEN default_config->>'display' = 'metric' THEN 2
    WHEN default_config->>'display' = 'gauge' THEN 3
    WHEN default_config->>'display' IN ('pie_chart', 'bar_chart') THEN 4
    WHEN default_config->>'display' IN ('line_chart', 'timeline') THEN 4
    WHEN default_config->>'display' IN ('table', 'alert_list') THEN 5
    WHEN default_config->>'display' = 'progress' THEN 2
    WHEN default_config->>'display' = 'percentage' THEN 2
    ELSE 4
  END;

COMMENT ON COLUMN public.widget_registry.default_width IS 'Default grid width (columns) when adding widget to dashboard';
COMMENT ON COLUMN public.widget_registry.default_height IS 'Default grid height (rows) when adding widget to dashboard';
