-- Seed ReplenishmentSuggestions widget into public.widget_registry
-- This widget was registered in code (WidgetRegistry.tsx) but never seeded into the DB.

INSERT INTO public.widget_registry (
  widget_key,
  domain,
  name,
  description,
  default_config,
  default_width,
  default_height
) VALUES (
  'inventory.widget.replenishment_suggestions',
  'procurement',
  'Replenishment Suggestions',
  'Recommended items to reorder based on stock levels and usage rates',
  '{"display": "table"}'::jsonb,
  4,
  4
)
ON CONFLICT (widget_key) DO UPDATE SET
  domain      = EXCLUDED.domain,
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  default_config = EXCLUDED.default_config,
  default_width  = EXCLUDED.default_width,
  default_height = EXCLUDED.default_height,
  updated_at     = now();
