'use client';

import type { DashboardWidget, WidgetData } from '@/types/dashboard';
import { BaseMetricWidget } from './BaseMetricWidget';
import { BaseTableWidget } from './BaseTableWidget';
import { BaseChartWidget } from './BaseChartWidget';

// Widget component registry - maps widget_key to React component
export const WIDGET_COMPONENTS: Record<string, React.ComponentType<{
  widget: DashboardWidget;
  data: WidgetData | null;
  isLoading: boolean;
}>> = {
  // Inventory domain - Metrics
  'inv_total_value': BaseMetricWidget,
  'inv_total_items': BaseMetricWidget,
  'inv_unique_skus': BaseMetricWidget,
  'inv_stockout_items': BaseMetricWidget,
  'inv_low_stock_items': BaseMetricWidget,
  'inv_overstock_items': BaseMetricWidget,
  'inv_avg_days_supply': BaseMetricWidget,
  'inv_turnover_ratio': BaseMetricWidget,
  
  // Inventory domain - Tables
  'inv_top_value_items': BaseTableWidget,
  'inv_slow_movers': BaseTableWidget,
  'inv_fast_movers': BaseTableWidget,
  'inv_negative_stock': BaseTableWidget,
  'inv_expiring_soon': BaseTableWidget,
  'inv_stock_alerts_list': BaseTableWidget,
  
  // Inventory domain - Charts
  'inv_value_by_category': BaseChartWidget,
  'inv_stock_trend_30d': BaseChartWidget,
  
  // Procurement domain
  'proc_open_pos': BaseMetricWidget,
  'proc_pending_receipts': BaseTableWidget,
  'proc_late_pos': BaseTableWidget,
  
  // Alerts domain
  'alert_critical_stockouts': BaseTableWidget,
  'alert_pending_actions': BaseTableWidget,
  
  // Executive domain
  'exec_stockout_forecast_7d': BaseMetricWidget,
  'exec_inventory_health_score': BaseMetricWidget,
  'exec_procurement_efficiency': BaseMetricWidget,
  'exec_fill_rate': BaseMetricWidget,
  
  // Flow domain
  'flow_receipts_today': BaseMetricWidget,
  'flow_shipments_today': BaseMetricWidget,
  'flow_adjustments_today': BaseMetricWidget,
  'flow_recent_transactions': BaseTableWidget,
};

export function getWidgetComponent(widgetKey: string) {
  return WIDGET_COMPONENTS[widgetKey] || BaseMetricWidget; // Fallback to metric widget
}
