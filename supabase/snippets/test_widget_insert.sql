-- Test anon can insert into dashboard_widgets
SET ROLE anon;

-- Try to insert a test widget
INSERT INTO public.dashboard_widgets (
  tenant_id,
  dashboard_id,
  widget_key,
  title,
  layout,
  config
) VALUES (
  'ae837809-1a24-4ab5-ba06-34fd98c05f48'::uuid,
  'a8ec2ea1-4253-436a-9815-d8a4449e034c'::uuid,
  'test.widget',
  'Test Widget',
  '{"x": 0, "y": 0, "w": 4, "h": 4}'::jsonb,
  '{}'::jsonb
) RETURNING id;

RESET ROLE;
