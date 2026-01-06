// Widget type definitions
export interface WidgetConfig {
  display?: 'metric' | 'table' | 'chart' | 'pie_chart' | 'bar_chart' | 'line_chart' | 'gauge' | 'alert_list' | 'timeline' | 'progress' | 'percentage';
  filters?: Record<string, any>;
  limit?: number;
  period?: string;
  threshold?: number;
  [key: string]: any;
}

export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

export interface DashboardWidget {
  id: string;
  tenant_id: string;
  dashboard_id: string;
  widget_key: string;
  title: string | null;
  config: WidgetConfig;
  layout: WidgetLayout;
  refresh_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface Dashboard {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WidgetRegistryEntry {
  widget_key: string;
  domain: string;
  name: string;
  description: string | null;
  default_config: WidgetConfig;
  allowed_filters: string[];
  is_enabled: boolean;
}

export interface WidgetProps {
  widget: DashboardWidget;
  data?: any;
  loading?: boolean;
  error?: Error | null;
}

export interface WidgetData {
  widget_key: string;
  data: any;
  cached_at: string;
  expires_at: string;
}
