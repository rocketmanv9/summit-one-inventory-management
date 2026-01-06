-- =====================================================
-- SEED WIDGET REGISTRY
-- =====================================================
-- Initial catalog of dashboard widgets

-- Inventory Widgets
INSERT INTO public.widget_registry (widget_key, domain, name, description, default_config, allowed_filters) VALUES
('inventory.widget.total_inventory_value', 'inventory', 'Total Inventory Value', 'Displays current total value of all inventory', '{"display": "metric", "currency": "USD"}'::jsonb, '["yard_id", "category_id", "date_range"]'::jsonb),
('inventory.widget.inventory_value_by_category', 'inventory', 'Inventory Value by Category', 'Breakdown of inventory value by item category', '{"display": "pie_chart"}'::jsonb, '["yard_id", "date_range"]'::jsonb),
('inventory.widget.inventory_value_by_yard', 'inventory', 'Inventory Value by Yard', 'Breakdown of inventory value by storage location', '{"display": "bar_chart"}'::jsonb, '["category_id", "date_range"]'::jsonb),
('inventory.widget.items_below_reorder', 'inventory', 'Items Below Reorder Point', 'List of items that need reordering', '{"display": "table", "show_count": true}'::jsonb, '["yard_id", "category_id", "priority"]'::jsonb),
('inventory.widget.items_below_min_stock', 'inventory', 'Items Below Min Stock', 'Critical low stock alerts', '{"display": "table", "threshold": "min"}'::jsonb, '["yard_id", "category_id"]'::jsonb),
('inventory.widget.critical_stock_alerts', 'inventory', 'Critical Stock Alerts', 'High priority stockout warnings', '{"display": "alert_list", "severity": "critical"}'::jsonb, '["yard_id"]'::jsonb),
('inventory.widget.overstocked_items', 'inventory', 'Overstocked Items', 'Items exceeding max stock levels', '{"display": "table"}'::jsonb, '["yard_id", "category_id"]'::jsonb),
('inventory.widget.stock_received_timeseries', 'inventory', 'Stock Received Over Time', 'Chart showing inventory receipts', '{"display": "line_chart", "period": "30d"}'::jsonb, '["yard_id", "category_id", "date_range"]'::jsonb),
('inventory.widget.stock_issued_timeseries', 'inventory', 'Stock Issued Over Time', 'Chart showing inventory issues', '{"display": "line_chart", "period": "30d"}'::jsonb, '["yard_id", "category_id", "date_range"]'::jsonb),
('inventory.widget.stock_transfers', 'inventory', 'Stock Transfers', 'Recent inter-yard transfers', '{"display": "table", "limit": 10}'::jsonb, '["from_yard_id", "to_yard_id", "date_range"]'::jsonb),
('inventory.widget.stock_adjustments', 'inventory', 'Stock Adjustments', 'Recent manual adjustments', '{"display": "table", "limit": 10}'::jsonb, '["yard_id", "reason", "date_range"]'::jsonb),
('inventory.widget.damaged_inventory', 'inventory', 'Damaged Inventory', 'Items marked as damaged', '{"display": "table"}'::jsonb, '["yard_id", "category_id"]'::jsonb),
('inventory.widget.returns_to_stock', 'inventory', 'Returns to Stock', 'Recently returned items', '{"display": "table", "limit": 10}'::jsonb, '["yard_id", "date_range"]'::jsonb),
('inventory.widget.reservations_vs_available', 'inventory', 'Reservations vs Available', 'Comparison of reserved and available stock', '{"display": "bar_chart"}'::jsonb, '["yard_id", "category_id"]'::jsonb),
('inventory.widget.top_consumed_items', 'inventory', 'Top Consumed Items', 'Most frequently issued items', '{"display": "table", "limit": 10, "period": "30d"}'::jsonb, '["yard_id", "category_id", "date_range"]'::jsonb),
('inventory.widget.idle_inventory', 'inventory', 'Idle Inventory', 'Items with no movement', '{"display": "table", "idle_days": 90}'::jsonb, '["yard_id", "category_id"]'::jsonb)
ON CONFLICT (widget_key) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    default_config = EXCLUDED.default_config,
    allowed_filters = EXCLUDED.allowed_filters,
    updated_at = NOW();

-- Procurement Widgets
INSERT INTO public.widget_registry (widget_key, domain, name, description, default_config, allowed_filters) VALUES
('procurement.widget.open_purchase_orders', 'procurement', 'Open Purchase Orders', 'Active POs awaiting delivery', '{"display": "table", "status": "open"}'::jsonb, '["supplier_id", "date_range"]'::jsonb),
('procurement.widget.late_deliveries', 'procurement', 'Late Deliveries', 'Overdue purchase orders', '{"display": "table", "threshold_days": 0}'::jsonb, '["supplier_id", "priority"]'::jsonb),
('procurement.widget.supplier_spend', 'procurement', 'Supplier Spend', 'Spending by supplier', '{"display": "bar_chart", "period": "30d"}'::jsonb, '["supplier_id", "date_range"]'::jsonb)
ON CONFLICT (widget_key) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    default_config = EXCLUDED.default_config,
    allowed_filters = EXCLUDED.allowed_filters,
    updated_at = NOW();

-- Alerts Widgets
INSERT INTO public.widget_registry (widget_key, domain, name, description, default_config, allowed_filters) VALUES
('alerts.widget.jobs_at_risk_due_to_stock', 'alerts', 'Jobs at Risk (Stock)', 'Jobs that may be delayed due to stockouts', '{"display": "alert_list", "look_ahead_days": 7}'::jsonb, '["yard_id", "priority"]'::jsonb),
('alerts.widget.stockout_forecast', 'alerts', 'Stockout Forecast', 'Predicted stockouts based on usage', '{"display": "table", "forecast_days": 14}'::jsonb, '["yard_id", "category_id"]'::jsonb)
ON CONFLICT (widget_key) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    default_config = EXCLUDED.default_config,
    allowed_filters = EXCLUDED.allowed_filters,
    updated_at = NOW();

-- Executive Widgets
INSERT INTO public.widget_registry (widget_key, domain, name, description, default_config, allowed_filters) VALUES
('exec.widget.inventory_health_score', 'exec', 'Inventory Health Score', 'Overall inventory performance metric', '{"display": "gauge", "scale": 100}'::jsonb, '["yard_id"]'::jsonb),
('exec.widget.inventory_turnover', 'exec', 'Inventory Turnover Rate', 'Inventory turnover calculation', '{"display": "metric", "period": "30d"}'::jsonb, '["yard_id", "category_id", "date_range"]'::jsonb),
('exec.widget.carrying_cost', 'exec', 'Carrying Cost', 'Estimated cost of holding inventory', '{"display": "metric", "currency": "USD", "period": "30d"}'::jsonb, '["yard_id", "date_range"]'::jsonb),
('exec.widget.stock_accuracy', 'exec', 'Stock Accuracy', 'Physical vs system inventory accuracy', '{"display": "percentage", "threshold": 95}'::jsonb, '["yard_id"]'::jsonb)
ON CONFLICT (widget_key) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    default_config = EXCLUDED.default_config,
    allowed_filters = EXCLUDED.allowed_filters,
    updated_at = NOW();

-- Flow/Operations Widgets
INSERT INTO public.widget_registry (widget_key, domain, name, description, default_config, allowed_filters) VALUES
('flow.widget.recent_receipts', 'flow', 'Recent Receipts', 'Latest inventory receipts', '{"display": "timeline", "limit": 20}'::jsonb, '["yard_id", "date_range"]'::jsonb),
('flow.widget.recent_issues', 'flow', 'Recent Issues', 'Latest inventory issues', '{"display": "timeline", "limit": 20}'::jsonb, '["yard_id", "date_range"]'::jsonb),
('flow.widget.cycle_count_status', 'flow', 'Cycle Count Status', 'Progress of ongoing cycle counts', '{"display": "progress"}'::jsonb, '["yard_id", "status"]'::jsonb),
('flow.widget.pending_approvals', 'flow', 'Pending Approvals', 'Transactions awaiting approval', '{"display": "table"}'::jsonb, '["type", "user_id"]'::jsonb)
ON CONFLICT (widget_key) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    default_config = EXCLUDED.default_config,
    allowed_filters = EXCLUDED.allowed_filters,
    updated_at = NOW();
