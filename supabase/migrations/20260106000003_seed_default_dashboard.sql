-- Create a default dashboard for testing
INSERT INTO dashboards (
  id,
  tenant_id,
  name,
  description,
  is_default,
  created_by,
  updated_by
)
VALUES (
  gen_random_uuid(),
  'default-tenant', -- This will be replaced by actual tenant_id from JWT in production
  'Inventory Overview',
  'Real-time inventory metrics and alerts',
  true,
  'system',
  'system'
)
ON CONFLICT DO NOTHING;

-- Get the dashboard ID for widget insertion
DO $$
DECLARE
  dashboard_uuid UUID;
BEGIN
  SELECT id INTO dashboard_uuid
  FROM dashboards
  WHERE name = 'Inventory Overview'
  AND tenant_id = 'default-tenant'
  LIMIT 1;

  -- Add sample widgets to the dashboard
  INSERT INTO dashboard_widgets (
    id,
    tenant_id,
    dashboard_id,
    widget_key,
    title,
    layout,
    config,
    refresh_seconds,
    created_by,
    updated_by
  )
  VALUES
    -- Row 1: Key metrics
    (
      gen_random_uuid(),
      'default-tenant',
      dashboard_uuid,
      'inv_total_value',
      'Total Inventory Value',
      jsonb_build_object('x', 0, 'y', 0, 'w', 3, 'h', 1),
      jsonb_build_object('description', 'Current total value of all inventory'),
      300,
      'system',
      'system'
    ),
    (
      gen_random_uuid(),
      'default-tenant',
      dashboard_uuid,
      'inv_total_items',
      'Total Items',
      jsonb_build_object('x', 3, 'y', 0, 'w', 3, 'h', 1),
      jsonb_build_object('description', 'Total quantity on hand'),
      300,
      'system',
      'system'
    ),
    (
      gen_random_uuid(),
      'default-tenant',
      dashboard_uuid,
      'inv_stockout_items',
      'Stockout Items',
      jsonb_build_object('x', 6, 'y', 0, 'w', 3, 'h', 1),
      jsonb_build_object('description', 'Items with zero stock'),
      60,
      'system',
      'system'
    ),
    (
      gen_random_uuid(),
      'default-tenant',
      dashboard_uuid,
      'inv_low_stock_items',
      'Low Stock Alerts',
      jsonb_build_object('x', 9, 'y', 0, 'w', 3, 'h', 1),
      jsonb_build_object('description', 'Items below reorder point'),
      60,
      'system',
      'system'
    ),

    -- Row 2: Tables
    (
      gen_random_uuid(),
      'default-tenant',
      dashboard_uuid,
      'inv_stock_alerts_list',
      'Critical Stock Alerts',
      jsonb_build_object('x', 0, 'y', 1, 'w', 6, 'h', 2),
      jsonb_build_object('limit', 10),
      120,
      'system',
      'system'
    ),
    (
      gen_random_uuid(),
      'default-tenant',
      dashboard_uuid,
      'inv_top_value_items',
      'Highest Value Items',
      jsonb_build_object('x', 6, 'y', 1, 'w', 6, 'h', 2),
      jsonb_build_object('limit', 10),
      300,
      'system',
      'system'
    ),

    -- Row 3: Flow metrics
    (
      gen_random_uuid(),
      'default-tenant',
      dashboard_uuid,
      'flow_receipts_today',
      'Receipts Today',
      jsonb_build_object('x', 0, 'y', 3, 'w', 4, 'h', 1),
      jsonb_build_object('description', 'Total items received today'),
      60,
      'system',
      'system'
    ),
    (
      gen_random_uuid(),
      'default-tenant',
      dashboard_uuid,
      'flow_shipments_today',
      'Shipments Today',
      jsonb_build_object('x', 4, 'y', 3, 'w', 4, 'h', 1),
      jsonb_build_object('description', 'Total items shipped today'),
      60,
      'system',
      'system'
    ),
    (
      gen_random_uuid(),
      'default-tenant',
      dashboard_uuid,
      'flow_adjustments_today',
      'Adjustments Today',
      jsonb_build_object('x', 8, 'y', 3, 'w', 4, 'h', 1),
      jsonb_build_object('description', 'Total adjustments made today'),
      60,
      'system',
      'system'
    );

END $$;

COMMIT;
