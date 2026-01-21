'use client';

import type { DashboardWidget, WidgetData } from '@/types/dashboard';
import { GenericMetricWidget } from './GenericMetricWidget';
import { GenericTableWidget } from './GenericTableWidget';
import { GenericChartWidget } from './GenericChartWidget';

// Import specific widget components
import { TotalInventoryValue } from './inventory/TotalInventoryValue';
import { ItemsBelowReorder } from './inventory/ItemsBelowReorder';
import { ItemsBelowMinStock } from './inventory/ItemsBelowMinStock';
import { TopConsumedItems } from './inventory/TopConsumedItems';
import { OpenPurchaseOrders } from './procurement/OpenPurchaseOrders';
import { OpenPurchaseOrdersRealtime } from './procurement/OpenPurchaseOrdersRealtime';
import { RecentReceipts } from './flow/RecentReceipts';
import { RecentReceiptsRealtime } from './flow/RecentReceiptsRealtime';
import { RecentIssues } from './flow/RecentIssues';
import { InventoryTurnover } from './exec/InventoryTurnover';
import { TransfersPending } from './flow/TransfersPending';
import { ReceivingToday } from './flow/ReceivingToday';
import { ReservationsUpcoming } from './inventory/ReservationsUpcoming';
import { CycleCountVariances } from './flow/CycleCountVariances';

// Widget component registry - maps widget_key to React component
export const WIDGET_COMPONENTS: Record<string, React.ComponentType<{
  widget: DashboardWidget;
}>> = {
  // Inventory Metrics
  'inventory.widget.total_inventory_value': TotalInventoryValue,
  'inventory.widget.inventory_value_by_category': GenericChartWidget,
  'inventory.widget.inventory_value_by_yard': GenericChartWidget,
  'inventory.widget.items_below_reorder': ItemsBelowReorder,
  'inventory.widget.items_below_min_stock': ItemsBelowMinStock,
  'inventory.widget.critical_stock_alerts': GenericTableWidget,
  'inventory.widget.overstocked_items': GenericTableWidget,
  'inventory.widget.stock_received_timeseries': GenericChartWidget,
  'inventory.widget.stock_issued_timeseries': GenericChartWidget,
  'inventory.widget.stock_transfers': GenericTableWidget,
  'inventory.widget.stock_adjustments': GenericTableWidget,
  'inventory.widget.damaged_inventory': GenericTableWidget,
  'inventory.widget.returns_to_stock': GenericTableWidget,
  'inventory.widget.reservations_vs_available': GenericChartWidget,
  'inventory.widget.top_consumed_items': TopConsumedItems,
  'inventory.widget.idle_inventory': GenericTableWidget,
  
  // Procurement Widgets
  'procurement.widget.open_purchase_orders': OpenPurchaseOrders,
  'procurement.widget.open_purchase_orders_realtime': OpenPurchaseOrdersRealtime, // ✅ NEW: Real-time via supply_chain.purchase_order.* events
  'procurement.widget.late_deliveries': GenericTableWidget,
  'procurement.widget.supplier_spend': GenericChartWidget,
  
  // Alerts Widgets
  'alerts.widget.jobs_at_risk_due_to_stock': GenericTableWidget,
  'alerts.widget.stockout_forecast': GenericTableWidget,
  
  // Executive Widgets
  'exec.widget.inventory_health_score': GenericMetricWidget,
  'exec.widget.inventory_turnover': InventoryTurnover,
  'exec.widget.carrying_cost': GenericMetricWidget,
  'exec.widget.stock_accuracy': GenericMetricWidget,
  
  // Flow Widgets
  'flow.widget.recent_receipts': RecentReceipts,
  'flow.widget.recent_receipts_realtime': RecentReceiptsRealtime, // ✅ NEW: Real-time via supply_chain.receipt.* events
  'flow.widget.recent_issues': RecentIssues,
  'flow.widget.cycle_count_status': GenericMetricWidget,
  'flow.widget.pending_approvals': GenericTableWidget,
  'flow.widget.transfers_pending': TransfersPending,
  'flow.widget.transfers_in_transit': TransfersPending,
  'flow.widget.receiving_today': ReceivingToday,
  'flow.widget.cycle_count_variances': CycleCountVariances,

  // Reservations
  'inventory.widget.reservations_upcoming': ReservationsUpcoming,
  'inventory.widget.reservations_overdue': GenericTableWidget,

  // Additional Epic Widgets
  'inventory.widget.stockouts_negative': GenericTableWidget,
  'inventory.widget.quarantine_hold': GenericTableWidget,
  'procurement.widget.po_aging': GenericTableWidget,
  'procurement.widget.vendor_lead_time': GenericChartWidget,
};

export function getWidgetComponent(widgetKey: string) {
  return WIDGET_COMPONENTS[widgetKey] || GenericMetricWidget; // Fallback to metric widget
}
