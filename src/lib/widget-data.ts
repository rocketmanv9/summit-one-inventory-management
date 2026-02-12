import { createBrowserAuthedClient } from '@/supabase/client';
import { getStoredAccessToken, getTenantIdFromToken, handleSupabaseAuthError } from '@/lib/auth-token';

type WidgetDataRequest = {
  widget_key?: string;
  config?: Record<string, any>;
};

type WidgetDataResponse = {
  value?: string | number;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  columns?: { key: string; label: string }[];
  rows?: Record<string, any>[];
  labels?: string[];
  datasets?: { label: string; data: number[]; color?: string }[];
};

type DashboardStatsRow = {
  total_inventory?: number | null;
  low_stock_items?: number | null;
  pending_orders?: number | null;
};

function buildMetric(value: number | null | undefined): WidgetDataResponse {
  return { value: value ?? 0, trend: 'neutral' };
}

function buildTable(rows: Record<string, any>[], columns: { key: string; label: string }[]): WidgetDataResponse {
  return { rows, columns };
}

function buildChart(stats: DashboardStatsRow | null): WidgetDataResponse {
  const total = stats?.total_inventory ?? 0;
  const lowStock = stats?.low_stock_items ?? 0;
  const pending = stats?.pending_orders ?? 0;

  return {
    labels: ['Total', 'Low Stock', 'Pending'],
    datasets: [
      {
        label: 'Count',
        data: [total, lowStock, pending],
        color: '#2563eb',
      },
    ],
  };
}

function buildDefaultTable(stats: DashboardStatsRow | null): WidgetDataResponse {
  return buildTable(
    [
      { metric: 'Total Inventory', value: stats?.total_inventory ?? 0 },
      { metric: 'Low Stock Items', value: stats?.low_stock_items ?? 0 },
      { metric: 'Pending Orders', value: stats?.pending_orders ?? 0 },
    ],
    [
      { key: 'metric', label: 'Metric' },
      { key: 'value', label: 'Value' },
    ]
  );
}

async function fetchDashboardStats(): Promise<DashboardStatsRow | null> {
  const accessToken = getStoredAccessToken();
  const tenantId = accessToken ? getTenantIdFromToken(accessToken) : null;
  if (!tenantId) {
    console.warn('[WidgetData] Missing tenant context; skipping dashboard_stats lookup.');
    return null;
  }

  const supabase = createBrowserAuthedClient();
  const { data, error } = await supabase
    .from('dashboard_stats')
    .select('total_inventory, low_stock_items, pending_orders')
    .eq('tenant_id', tenantId)
    .single();

  if (error) {
    handleSupabaseAuthError(error);
    console.warn('[WidgetData] Failed to fetch dashboard_stats:', error.message);
    return null;
  }

  return data as DashboardStatsRow;
}

export async function fetchWidgetData(request: WidgetDataRequest): Promise<WidgetDataResponse> {
  const widgetKey = request.widget_key || '';
  const display = request.config?.display as string | undefined;
  const stats = await fetchDashboardStats();

  if (widgetKey.includes('total_inventory')) {
    return buildMetric(stats?.total_inventory);
  }

  if (widgetKey.includes('low_stock') || widgetKey.includes('below_reorder') || widgetKey.includes('below_min')) {
    return buildTable(
      [
        { metric: 'Low Stock Items', value: stats?.low_stock_items ?? 0 },
      ],
      [
        { key: 'metric', label: 'Metric' },
        { key: 'value', label: 'Value' },
      ]
    );
  }

  if (widgetKey.includes('purchase_orders') || widgetKey.includes('pending')) {
    return buildTable(
      [
        { metric: 'Pending Orders', value: stats?.pending_orders ?? 0 },
      ],
      [
        { key: 'metric', label: 'Metric' },
        { key: 'value', label: 'Value' },
      ]
    );
  }

  if (display === 'chart' || display === 'pie_chart' || display === 'bar_chart' || display === 'line_chart') {
    return buildChart(stats);
  }

  if (display === 'table' || display === 'alert_list' || display === 'timeline') {
    return buildDefaultTable(stats);
  }

  return buildMetric(stats?.total_inventory);
}
