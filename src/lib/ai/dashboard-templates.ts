/**
 * AI Dashboard Templates
 *
 * Pre-configured widget collections that map to existing widget_keys.
 * The AI picks the right template based on user intent.
 */

export interface DashboardTemplateWidget {
  widget_key: string;
  title: string;
  layout: { x: number; y: number; w: number; h: number };
  config: Record<string, any>;
}

export interface DashboardTemplate {
  name: string;
  description: string;
  widgets: DashboardTemplateWidget[];
}

export const DASHBOARD_TEMPLATES: Record<string, DashboardTemplate> = {
  executive: {
    name: 'Executive Overview',
    description: 'High-level KPIs for leadership — health score, turnover, carrying cost, and stock accuracy with value breakdowns.',
    widgets: [
      {
        widget_key: 'exec.widget.inventory_health_score',
        title: 'Inventory Health Score',
        layout: { x: 0, y: 0, w: 3, h: 4 },
        config: { display: 'metric' },
      },
      {
        widget_key: 'exec.widget.inventory_turnover',
        title: 'Inventory Turnover',
        layout: { x: 3, y: 0, w: 3, h: 4 },
        config: { display: 'metric' },
      },
      {
        widget_key: 'exec.widget.carrying_cost',
        title: 'Carrying Cost',
        layout: { x: 6, y: 0, w: 3, h: 4 },
        config: { display: 'metric' },
      },
      {
        widget_key: 'exec.widget.stock_accuracy',
        title: 'Stock Accuracy',
        layout: { x: 9, y: 0, w: 3, h: 4 },
        config: { display: 'metric' },
      },
      {
        widget_key: 'inventory.widget.inventory_value_by_category',
        title: 'Value by Category',
        layout: { x: 0, y: 4, w: 6, h: 5 },
        config: { display: 'chart' },
      },
      {
        widget_key: 'inventory.widget.low_stock_alerts',
        title: 'Low Stock Alerts',
        layout: { x: 6, y: 4, w: 6, h: 5 },
        config: { display: 'table', limit: 10 },
      },
    ],
  },

  operations: {
    name: 'Daily Operations',
    description: 'Day-to-day operational view — receiving activity, pending transfers, recent receipts and issues.',
    widgets: [
      {
        widget_key: 'flow.widget.receiving_today',
        title: 'Receiving Today',
        layout: { x: 0, y: 0, w: 6, h: 4 },
        config: { display: 'table' },
      },
      {
        widget_key: 'flow.widget.transfers_pending',
        title: 'Transfers Pending',
        layout: { x: 6, y: 0, w: 6, h: 4 },
        config: { display: 'table' },
      },
      {
        widget_key: 'flow.widget.recent_receipts_realtime',
        title: 'Recent Receipts',
        layout: { x: 0, y: 4, w: 6, h: 5 },
        config: { display: 'table', limit: 10 },
      },
      {
        widget_key: 'flow.widget.recent_issues',
        title: 'Recent Issues',
        layout: { x: 6, y: 4, w: 6, h: 5 },
        config: { display: 'table', limit: 10 },
      },
      {
        widget_key: 'flow.widget.cycle_count_status',
        title: 'Cycle Count Status',
        layout: { x: 0, y: 9, w: 4, h: 4 },
        config: { display: 'metric' },
      },
      {
        widget_key: 'flow.widget.pending_approvals',
        title: 'Pending Approvals',
        layout: { x: 4, y: 9, w: 8, h: 4 },
        config: { display: 'table' },
      },
    ],
  },

  procurement: {
    name: 'Procurement',
    description: 'Purchase order tracking — open POs, late deliveries, supplier spend, and PO aging.',
    widgets: [
      {
        widget_key: 'procurement.widget.open_purchase_orders_realtime',
        title: 'Open Purchase Orders',
        layout: { x: 0, y: 0, w: 8, h: 5 },
        config: { display: 'table', limit: 10 },
      },
      {
        widget_key: 'procurement.widget.late_deliveries',
        title: 'Late Deliveries',
        layout: { x: 8, y: 0, w: 4, h: 5 },
        config: { display: 'table', limit: 10 },
      },
      {
        widget_key: 'procurement.widget.supplier_spend',
        title: 'Supplier Spend',
        layout: { x: 0, y: 5, w: 6, h: 5 },
        config: { display: 'chart' },
      },
      {
        widget_key: 'procurement.widget.po_aging',
        title: 'PO Aging',
        layout: { x: 6, y: 5, w: 6, h: 5 },
        config: { display: 'table' },
      },
    ],
  },

  inventory_health: {
    name: 'Inventory Health',
    description: 'Stock health analysis — low stock items, dead stock, overstocked items, and inventory forecast.',
    widgets: [
      {
        widget_key: 'inventory.widget.low_stock_alerts',
        title: 'Low Stock Alerts',
        layout: { x: 0, y: 0, w: 6, h: 5 },
        config: { display: 'table', limit: 10 },
      },
      {
        widget_key: 'inventory.widget.dead_stock',
        title: 'Dead Stock',
        layout: { x: 6, y: 0, w: 6, h: 5 },
        config: { display: 'table', limit: 10 },
      },
      {
        widget_key: 'inventory.widget.overstocked_items',
        title: 'Overstocked Items',
        layout: { x: 0, y: 5, w: 6, h: 5 },
        config: { display: 'table', limit: 10 },
      },
      {
        widget_key: 'inventory.widget.inventory_forecast',
        title: 'Inventory Forecast',
        layout: { x: 6, y: 5, w: 6, h: 5 },
        config: { display: 'table', limit: 10 },
      },
      {
        widget_key: 'inventory.widget.replenishment_suggestions',
        title: 'Replenishment Suggestions',
        layout: { x: 0, y: 10, w: 12, h: 5 },
        config: { display: 'table', limit: 10 },
      },
    ],
  },

  alerts: {
    name: 'Alerts & Risks',
    description: 'Risk monitoring — stockout forecasts, jobs at risk, critical stock levels, and cycle count variances.',
    widgets: [
      {
        widget_key: 'alerts.widget.stockout_forecast',
        title: 'Stockout Forecast',
        layout: { x: 0, y: 0, w: 6, h: 5 },
        config: { display: 'table', limit: 10 },
      },
      {
        widget_key: 'alerts.widget.jobs_at_risk_due_to_stock',
        title: 'Jobs at Risk',
        layout: { x: 6, y: 0, w: 6, h: 5 },
        config: { display: 'table', limit: 10 },
      },
      {
        widget_key: 'inventory.widget.critical_stock_alerts',
        title: 'Critical Stock Alerts',
        layout: { x: 0, y: 5, w: 6, h: 5 },
        config: { display: 'table', limit: 10 },
      },
      {
        widget_key: 'flow.widget.cycle_count_variances',
        title: 'Cycle Count Variances',
        layout: { x: 6, y: 5, w: 6, h: 5 },
        config: { display: 'table', limit: 10 },
      },
    ],
  },

  asset_tracking: {
    name: 'Asset Tracking',
    description: 'Equipment and asset monitoring — inventory summary, location capacity, and transfer activity.',
    widgets: [
      {
        widget_key: 'inventory.widget.inventory_summary',
        title: 'Inventory Summary',
        layout: { x: 0, y: 0, w: 4, h: 4 },
        config: { display: 'metric' },
      },
      {
        widget_key: 'inventory.widget.total_inventory_value',
        title: 'Total Inventory Value',
        layout: { x: 4, y: 0, w: 4, h: 4 },
        config: { display: 'metric' },
      },
      {
        widget_key: 'inventory.widget.location_capacity',
        title: 'Location Capacity',
        layout: { x: 8, y: 0, w: 4, h: 4 },
        config: { display: 'table' },
      },
      {
        widget_key: 'flow.widget.transfers_in_transit',
        title: 'Transfers In Transit',
        layout: { x: 0, y: 4, w: 6, h: 5 },
        config: { display: 'table', limit: 10 },
      },
      {
        widget_key: 'inventory.widget.transfer_suggestions',
        title: 'Transfer Suggestions',
        layout: { x: 6, y: 4, w: 6, h: 5 },
        config: { display: 'table', limit: 10 },
      },
    ],
  },
};

export function getTemplate(name: string): DashboardTemplate | null {
  return DASHBOARD_TEMPLATES[name] || null;
}

export function getTemplateNames(): string[] {
  return Object.keys(DASHBOARD_TEMPLATES);
}
