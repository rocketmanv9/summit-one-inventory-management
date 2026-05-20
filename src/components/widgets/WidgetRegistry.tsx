'use client';

import type { DashboardWidget, WidgetData } from '@/types/dashboard';
import { GenericMetricWidget } from './GenericMetricWidget';
import { GenericTableWidget } from './GenericTableWidget';
import { GenericChartWidget } from './GenericChartWidget';

// Import specific widget components
import { RecentReceiptsRealtime } from './flow/RecentReceiptsRealtime';
import { DeadStockWidget } from './inventory/DeadStockWidget';
import { InventoryForecastWidget } from './inventory/InventoryForecastWidget';
import { ReplenishmentSuggestions } from './inventory/ReplenishmentSuggestions';
import { TransferSuggestions } from './inventory/TransferSuggestions';
import { LocationCapacity } from './inventory/LocationCapacity';
import { CycleCountSuggestions } from './inventory/CycleCountSuggestions';
import { LowStockWidget } from './inventory/LowStockWidget';
import { InventorySummaryWidget } from './inventory/InventorySummaryWidget';

// Widget component registry - maps widget_key to React component
export const WIDGET_COMPONENTS: Record<string, React.ComponentType<{
  widget: DashboardWidget;
}>> = {
  // Inventory Metrics
  'inventory.widget.total_inventory_value': GenericMetricWidget,
  'inventory.widget.inventory_value_by_category': GenericChartWidget,
  'inventory.widget.inventory_value_by_yard': GenericChartWidget,
  'inventory.widget.items_below_reorder': GenericTableWidget,
  'inventory.widget.items_below_min_stock': GenericTableWidget,
  'inventory.widget.critical_stock_alerts': GenericTableWidget,
  'inventory.widget.overstocked_items': GenericTableWidget,
  'inventory.widget.stock_received_timeseries': GenericChartWidget,
  'inventory.widget.stock_issued_timeseries': GenericChartWidget,
  'inventory.widget.stock_transfers': GenericTableWidget,
  'inventory.widget.stock_adjustments': GenericTableWidget,
  'inventory.widget.damaged_inventory': GenericTableWidget,
  'inventory.widget.returns_to_stock': GenericTableWidget,
  'inventory.widget.reservations_vs_available': GenericChartWidget,
  'inventory.widget.top_consumed_items': GenericTableWidget,
  'inventory.widget.idle_inventory': GenericTableWidget,
  'inventory.widget.low_stock_alerts': LowStockWidget,
  'inventory.widget.inventory_summary': InventorySummaryWidget,

  // Alerts Widgets
  'alerts.widget.jobs_at_risk_due_to_stock': GenericTableWidget,
  'alerts.widget.stockout_forecast': GenericTableWidget,

  // Executive Widgets
  'exec.widget.inventory_health_score': GenericMetricWidget,
  'exec.widget.inventory_turnover': GenericMetricWidget,
  'exec.widget.carrying_cost': GenericMetricWidget,
  'exec.widget.stock_accuracy': GenericMetricWidget,

  // Flow Widgets
  'flow.widget.recent_receipts': GenericTableWidget,
  'flow.widget.recent_receipts_realtime': RecentReceiptsRealtime,
  'flow.widget.recent_issues': GenericTableWidget,
  'flow.widget.cycle_count_status': GenericMetricWidget,
  'flow.widget.pending_approvals': GenericTableWidget,
  'flow.widget.transfers_pending': GenericTableWidget,
  'flow.widget.transfers_in_transit': GenericTableWidget,
  'flow.widget.receiving_today': GenericTableWidget,
  'flow.widget.cycle_count_variances': GenericTableWidget,

  // Reservations
  'inventory.widget.reservations_upcoming': GenericTableWidget,
  'inventory.widget.reservations_overdue': GenericTableWidget,

  // Additional Epic Widgets
  'inventory.widget.stockouts_negative': GenericTableWidget,
  'inventory.widget.quarantine_hold': GenericTableWidget,

  // Feature Expansion Widgets
  'inventory.widget.dead_stock': DeadStockWidget,
  'inventory.widget.inventory_forecast': InventoryForecastWidget,
  'inventory.widget.replenishment_suggestions': ReplenishmentSuggestions,
  'inventory.widget.transfer_suggestions': TransferSuggestions,
  'inventory.widget.location_capacity': LocationCapacity,
  'flow.widget.cycle_count_suggestions': CycleCountSuggestions,
};

export function getWidgetComponent(widgetKey: string) {
  return WIDGET_COMPONENTS[widgetKey] || GenericMetricWidget; // Fallback to metric widget
}
