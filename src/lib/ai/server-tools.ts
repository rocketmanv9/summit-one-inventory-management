/**
 * Server-Side Tool Executor
 *
 * Executes query_*, create_dashboard, and workflow_* tools on the server
 * using the authenticated Supabase client from the session.
 * Returns { text, dataDisplay } for the chat route to feed back to OpenAI
 * and ultimately to the client.
 */

import type { AiDataDisplay } from './types';

// ─── Context ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = any;

export interface ServerToolContext {
  /** Tenant-scoped Supabase client (service role with RLS via tenantId) */
  supabase: SupabaseClientLike;
  tenantId: string;
  userId: string;
  /** Cookie header string for forwarding auth to internal endpoints */
  cookieHeader: string;
  /** Base URL for internal API calls (e.g. http://localhost:3000) */
  baseUrl: string;
}

export interface ServerToolResult {
  /** Raw text summary of the data (fed back to OpenAI for NL summary) */
  text: string;
  /** Structured display data for rich UI rendering */
  dataDisplay: AiDataDisplay;
}

// ─── Registry ─────────────────────────────────────────────────────────

const SERVER_TOOLS = new Set([
  'query_inventory_summary',
  'query_stock_valuation',
  'query_low_stock_report',
  'query_dead_stock',
  'query_velocity_analysis',
  'query_movement_summary',
  'query_reorder_suggestions',
  'query_forecast',
  'query_inventory_turnover',
  'query_po_status',
  'create_dashboard',
  'list_dashboards',
  'list_available_widgets',
  'add_dashboard_widget',
  'remove_dashboard_widget',
  'update_dashboard',
  'delete_dashboard',
  'workflow_auto_reorder',
  'workflow_stock_rebalance',
  'smart_stock_receive',
  'smart_add_location',
  'smart_register_asset',
  'search_vendors_online',
  'set_preferred_vendor',
]);

export function isServerTool(name: string): boolean {
  return SERVER_TOOLS.has(name);
}

// ─── Executor ─────────────────────────────────────────────────────────

export async function executeServerTool(
  toolName: string,
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  switch (toolName) {
    case 'query_inventory_summary':
      return queryInventorySummary(ctx);
    case 'query_stock_valuation':
      return queryStockValuation(ctx);
    case 'query_low_stock_report':
      return queryLowStockReport(ctx);
    case 'query_dead_stock':
      return queryDeadStock(ctx);
    case 'query_velocity_analysis':
      return queryVelocityAnalysis(ctx);
    case 'query_movement_summary':
      return queryMovementSummary(params, ctx);
    case 'query_reorder_suggestions':
      return queryReorderSuggestions(ctx);
    case 'query_forecast':
      return queryForecast(ctx);
    case 'query_inventory_turnover':
      return queryInventoryTurnover(ctx);
    case 'query_po_status':
      return queryPoStatus(ctx);
    case 'create_dashboard':
      return createDashboard(params, ctx);
    case 'list_dashboards':
      return listDashboards(ctx);
    case 'list_available_widgets':
      return listAvailableWidgets(ctx);
    case 'add_dashboard_widget':
      return addDashboardWidget(params, ctx);
    case 'remove_dashboard_widget':
      return removeDashboardWidget(params, ctx);
    case 'update_dashboard':
      return updateDashboardTool(params, ctx);
    case 'delete_dashboard':
      return deleteDashboardTool(params, ctx);
    case 'workflow_auto_reorder':
      return workflowAutoReorder(params, ctx);
    case 'workflow_stock_rebalance':
      return workflowStockRebalance(params, ctx);
    case 'smart_stock_receive':
      return smartStockReceive(params, ctx);
    case 'smart_add_location':
      return smartAddLocation(params, ctx);
    case 'smart_register_asset':
      return smartRegisterAsset(params, ctx);
    case 'search_vendors_online':
      return searchVendorsOnline(params, ctx);
    case 'set_preferred_vendor':
      return setPreferredVendor(params, ctx);
    default:
      return {
        text: `Unknown server tool: ${toolName}`,
        dataDisplay: { displayType: 'metric', label: 'Error', value: 'Unknown tool' },
      };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function inventorySchema(supabase: SupabaseClientLike) {
  return (supabase as any).schema('inventory');
}

function supplyChainSchema(supabase: SupabaseClientLike) {
  return (supabase as any).schema('supply_chain');
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
}

function formatNumber(val: number): string {
  return new Intl.NumberFormat('en-US').format(val);
}

// ─── Query Implementations ───────────────────────────────────────────

async function queryInventorySummary(ctx: ServerToolContext): Promise<ServerToolResult> {
  const { data, error } = await inventorySchema(ctx.supabase)
    .from('mv_inventory_summary')
    .select('*')
    .limit(1)
    .single();

  if (error || !data) {
    return {
      text: 'Failed to fetch inventory summary.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' },
    };
  }

  const row = data as any;
  return {
    text: `Inventory Summary: ${row.total_items ?? 0} items across ${row.total_locations ?? 0} locations. Total on hand: ${formatNumber(row.total_qty_on_hand ?? 0)}, reserved: ${formatNumber(row.total_qty_reserved ?? 0)}, available: ${formatNumber(row.total_qty_available ?? 0)}. ${row.negative_balance_count ?? 0} negative balances, ${row.zero_balance_count ?? 0} zero balances.`,
    dataDisplay: {
      displayType: 'metric',
      label: 'Total Inventory',
      value: formatNumber(row.total_qty_on_hand ?? 0),
      unit: 'units',
      secondaryMetrics: [
        { label: 'Items', value: formatNumber(row.total_items ?? 0) },
        { label: 'Locations', value: formatNumber(row.total_locations ?? 0) },
        { label: 'Reserved', value: formatNumber(row.total_qty_reserved ?? 0) },
        { label: 'Available', value: formatNumber(row.total_qty_available ?? 0) },
      ],
    },
  };
}

async function queryStockValuation(ctx: ServerToolContext): Promise<ServerToolResult> {
  const { data, error } = await inventorySchema(ctx.supabase)
    .rpc('rpc_report_stock_valuation');

  if (error || !data) {
    return {
      text: 'Failed to fetch stock valuation.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' },
    };
  }

  const rows = data as any[];
  const totalValue = rows.reduce((sum: number, r: any) => sum + (Number(r.total_value) || 0), 0);

  return {
    text: `Stock Valuation: Total inventory value is ${formatCurrency(totalValue)} across ${rows.length} location/category combinations. Top entries: ${rows.slice(0, 5).map((r: any) => `${r.location_name}/${r.category_name}: ${formatCurrency(Number(r.total_value) || 0)}`).join(', ')}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'location_name', label: 'Location' },
        { key: 'category_name', label: 'Category' },
        { key: 'item_count', label: 'Items' },
        { key: 'total_qty', label: 'Qty' },
        { key: 'avg_unit_cost', label: 'Avg Cost' },
        { key: 'total_value', label: 'Total Value' },
      ],
      rows: rows.slice(0, 20),
      totalRows: rows.length,
    },
  };
}

async function queryLowStockReport(ctx: ServerToolContext): Promise<ServerToolResult> {
  const { data, error } = await inventorySchema(ctx.supabase)
    .from('mv_low_stock_summary')
    .select('*')
    .limit(50);

  if (error || !data) {
    return {
      text: 'Failed to fetch low stock report.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' },
    };
  }

  const rows = data as any[];
  return {
    text: `Low Stock Report: ${rows.length} items below minimum stock levels. ${rows.slice(0, 5).map((r: any) => `${r.name} (${r.sku}): ${r.total_available} available vs ${r.min_stock_level} minimum`).join('; ')}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'name', label: 'Item' },
        { key: 'total_available', label: 'Available' },
        { key: 'min_stock_level', label: 'Min Stock' },
        { key: 'reorder_point', label: 'Reorder Pt' },
        { key: 'location_count', label: 'Locations' },
      ],
      rows: rows.slice(0, 20),
      totalRows: rows.length,
    },
  };
}

async function queryDeadStock(ctx: ServerToolContext): Promise<ServerToolResult> {
  const { data, error } = await inventorySchema(ctx.supabase)
    .rpc('rpc_report_dead_stock');

  if (error || !data) {
    return {
      text: 'Failed to fetch dead stock report.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' },
    };
  }

  const rows = data as any[];
  const totalCapital = rows.reduce((sum: number, r: any) => sum + (Number(r.capital_locked) || 0), 0);

  return {
    text: `Dead Stock Report: ${rows.length} items with no recent movement, locking up ${formatCurrency(totalCapital)} in capital. ${rows.slice(0, 3).map((r: any) => `${r.item_name}: ${r.days_since_movement} days idle, ${formatCurrency(Number(r.capital_locked) || 0)} locked`).join('; ')}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'item_name', label: 'Item' },
        { key: 'location_name', label: 'Location' },
        { key: 'qty_on_hand', label: 'Qty' },
        { key: 'days_since_movement', label: 'Days Idle' },
        { key: 'capital_locked', label: 'Capital Locked' },
        { key: 'aging_status', label: 'Status' },
      ],
      rows: rows.slice(0, 20),
      totalRows: rows.length,
    },
  };
}

async function queryVelocityAnalysis(ctx: ServerToolContext): Promise<ServerToolResult> {
  const { data, error } = await inventorySchema(ctx.supabase)
    .rpc('rpc_report_velocity_analysis');

  if (error || !data) {
    return {
      text: 'Failed to fetch velocity analysis.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' },
    };
  }

  const rows = data as any[];
  // Build chart from top 10 by usage_30d
  const sorted = [...rows].sort((a: any, b: any) => (Number(b.usage_30d) || 0) - (Number(a.usage_30d) || 0));
  const top10 = sorted.slice(0, 10);

  return {
    text: `Velocity Analysis: ${rows.length} item/location pairs analyzed. Fastest movers (30d): ${top10.slice(0, 5).map((r: any) => `${r.item_name}: ${r.usage_30d} units`).join(', ')}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'item_name', label: 'Item' },
        { key: 'location_name', label: 'Location' },
        { key: 'qty_available', label: 'Available' },
        { key: 'usage_30d', label: '30d Usage' },
        { key: 'usage_60d', label: '60d Usage' },
        { key: 'usage_90d', label: '90d Usage' },
        { key: 'daily_rate', label: 'Daily Rate' },
        { key: 'days_of_stock', label: 'Days Left' },
      ],
      rows: rows.slice(0, 20),
      totalRows: rows.length,
    },
  };
}

async function queryMovementSummary(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const rpcParams: Record<string, string> = {};
  if (params.start_date) rpcParams.p_start_date = params.start_date;
  if (params.end_date) rpcParams.p_end_date = params.end_date;

  const { data, error } = await inventorySchema(ctx.supabase)
    .rpc('rpc_report_movement_summary', rpcParams);

  if (error || !data) {
    return {
      text: 'Failed to fetch movement summary.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' },
    };
  }

  const rows = data as any[];

  return {
    text: `Movement Summary: ${rows.map((r: any) => `${r.event_type}: ${r.event_count} events, ${formatNumber(r.total_qty_in || 0)} in / ${formatNumber(r.total_qty_out || 0)} out`).join('; ')}.`,
    dataDisplay: {
      displayType: 'chart',
      chartType: 'bar',
      labels: rows.map((r: any) => String(r.event_type)),
      datasets: [
        {
          label: 'Qty In',
          data: rows.map((r: any) => Number(r.total_qty_in) || 0),
          color: '#3b82f6',
        },
        {
          label: 'Qty Out',
          data: rows.map((r: any) => Number(r.total_qty_out) || 0),
          color: '#ef4444',
        },
      ],
    },
  };
}

async function queryReorderSuggestions(ctx: ServerToolContext): Promise<ServerToolResult> {
  const { data, error } = await inventorySchema(ctx.supabase)
    .rpc('rpc_report_reorder_suggestions');

  if (error || !data) {
    return {
      text: 'Failed to fetch reorder suggestions.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' },
    };
  }

  const rows = data as any[];
  return {
    text: `Reorder Suggestions: ${rows.length} items need reordering. ${rows.slice(0, 5).map((r: any) => `${r.item_name}: shortage of ${r.shortage}, suggest ordering ${r.suggested_order_qty} from ${r.preferred_vendor || 'no vendor set'}`).join('; ')}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'item_name', label: 'Item' },
        { key: 'location_name', label: 'Location' },
        { key: 'qty_on_hand', label: 'On Hand' },
        { key: 'reorder_point', label: 'Reorder Pt' },
        { key: 'shortage', label: 'Shortage' },
        { key: 'suggested_order_qty', label: 'Suggested Qty' },
        { key: 'preferred_vendor', label: 'Vendor' },
      ],
      rows: rows.slice(0, 20),
      totalRows: rows.length,
    },
  };
}

async function queryForecast(ctx: ServerToolContext): Promise<ServerToolResult> {
  const { data, error } = await inventorySchema(ctx.supabase)
    .rpc('rpc_report_forecast');

  if (error || !data) {
    return {
      text: 'Failed to fetch forecast.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' },
    };
  }

  const rows = data as any[];
  const atRisk = rows.filter((r: any) => (Number(r.net_position) || 0) < 0);

  return {
    text: `Inventory Forecast: ${rows.length} items analyzed. ${atRisk.length} items at risk (negative net position). ${atRisk.slice(0, 3).map((r: any) => `${r.item_name}: net position ${r.net_position}`).join('; ')}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'item_name', label: 'Item' },
        { key: 'total_on_hand', label: 'On Hand' },
        { key: 'total_reserved', label: 'Reserved' },
        { key: 'total_available', label: 'Available' },
        { key: 'qty_incoming_po', label: 'Incoming' },
        { key: 'future_demand', label: 'Demand' },
        { key: 'net_position', label: 'Net Position' },
      ],
      rows: rows.slice(0, 20),
      totalRows: rows.length,
    },
  };
}

async function queryInventoryTurnover(ctx: ServerToolContext): Promise<ServerToolResult> {
  const { data, error } = await inventorySchema(ctx.supabase)
    .from('mv_item_velocity')
    .select('*')
    .limit(200);

  if (error || !data) {
    return {
      text: 'Failed to fetch inventory turnover.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' },
    };
  }

  const rows = data as any[];
  // Calculate aggregate turnover: sum(usage_30d * 12) / sum(qty_available)
  const totalUsage30d = rows.reduce((sum: number, r: any) => sum + (Number(r.usage_30d) || 0), 0);
  const totalAvailable = rows.reduce((sum: number, r: any) => sum + (Number(r.qty_available) || 0), 0);
  const annualizedUsage = totalUsage30d * 12;
  const turnoverRatio = totalAvailable > 0 ? (annualizedUsage / totalAvailable).toFixed(1) : '0';
  const avgDailyRate = rows.length > 0
    ? (rows.reduce((sum: number, r: any) => sum + (Number(r.daily_rate_30d) || 0), 0) / rows.length).toFixed(1)
    : '0';

  return {
    text: `Inventory Turnover: Annualized turnover ratio is ${turnoverRatio}x (based on 30-day usage extrapolated to 12 months). Average daily consumption rate: ${avgDailyRate} units. ${rows.length} item/location pairs analyzed.`,
    dataDisplay: {
      displayType: 'metric',
      label: 'Inventory Turnover',
      value: `${turnoverRatio}x`,
      unit: 'annual',
      secondaryMetrics: [
        { label: 'Monthly Usage', value: formatNumber(totalUsage30d) },
        { label: 'On Hand', value: formatNumber(totalAvailable) },
        { label: 'Avg Daily Rate', value: avgDailyRate },
      ],
    },
  };
}

async function queryPoStatus(ctx: ServerToolContext): Promise<ServerToolResult> {
  const { data, error } = await supplyChainSchema(ctx.supabase)
    .from('purchase_orders')
    .select('id, po_number, vendor_name, status, total_amount, expected_date, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !data) {
    return {
      text: 'Failed to fetch PO status.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' },
    };
  }

  const rows = data as any[];
  const statusCounts: Record<string, number> = {};
  let totalAmount = 0;
  for (const r of rows) {
    const s = r.status || 'unknown';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
    totalAmount += Number(r.total_amount) || 0;
  }

  const statusSummary = Object.entries(statusCounts)
    .map(([s, c]) => `${c} ${s}`)
    .join(', ');

  return {
    text: `PO Status: ${rows.length} purchase orders totaling ${formatCurrency(totalAmount)}. Breakdown: ${statusSummary}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'po_number', label: 'PO #' },
        { key: 'vendor_name', label: 'Vendor' },
        { key: 'status', label: 'Status' },
        { key: 'total_amount', label: 'Amount' },
        { key: 'expected_date', label: 'Expected' },
      ],
      rows: rows.slice(0, 20),
      totalRows: rows.length,
    },
  };
}

// ─── Dashboard Creation ──────────────────────────────────────────────

async function createDashboard(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  // Forward to internal API route which handles idempotency + events
  const template = params.template || 'executive';
  const name = params.name || undefined;

  try {
    const idempotencyKey = `ai-dashboard-${template}-${ctx.tenantId}-${Date.now()}`;
    const res = await fetch(`${ctx.baseUrl}/api/ai/create-dashboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': ctx.cookieHeader,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ template, name }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      return {
        text: `Failed to create dashboard: ${err.error || res.statusText}`,
        dataDisplay: { displayType: 'metric', label: 'Error', value: 'Creation failed' },
      };
    }

    const result = await res.json();
    return {
      text: `Dashboard "${result.data.name}" created successfully with ${result.data.widgetCount} widgets.`,
      dataDisplay: {
        displayType: 'dashboard_link',
        dashboardId: result.data.id,
        dashboardName: result.data.name,
      },
    };
  } catch (err: any) {
    return {
      text: `Failed to create dashboard: ${err.message}`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Creation failed' },
    };
  }
}

// ─── Dashboard Management ────────────────────────────────────────────

function fuzzyMatchDashboard(dashboards: any[], query: string): any | null {
  const q = query.toLowerCase();
  return (
    dashboards.find((d: any) => d.name.toLowerCase() === q) ||
    dashboards.find((d: any) => d.name.toLowerCase().includes(q)) ||
    dashboards.find((d: any) => q.includes(d.name.toLowerCase())) ||
    null
  );
}

function fuzzyMatchWidget(widgets: any[], query: string): any | null {
  const q = query.toLowerCase();
  return (
    widgets.find((w: any) => w.name.toLowerCase() === q) ||
    widgets.find((w: any) => w.widget_key.toLowerCase() === q) ||
    widgets.find((w: any) => w.name.toLowerCase().includes(q)) ||
    widgets.find((w: any) => w.widget_key.toLowerCase().includes(q)) ||
    null
  );
}

async function listDashboards(ctx: ServerToolContext): Promise<ServerToolResult> {
  const { data, error } = await ctx.supabase
    .from('dashboards')
    .select('id, name, description, is_default, created_at, dashboard_widgets(id, title, widget_key, deleted_at)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !data) {
    return {
      text: 'Failed to fetch dashboards.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' },
    };
  }

  const rows = (data as any[]).map((d) => {
    const activeWidgets = (d.dashboard_widgets || []).filter((w: any) => !w.deleted_at);
    return {
      name: d.name,
      description: d.description || '',
      is_default: d.is_default ? 'Yes' : 'No',
      widget_count: activeWidgets.length,
      widget_list: activeWidgets.map((w: any) => w.title || w.widget_key).join(', '),
      id: d.id,
    };
  });

  if (rows.length === 0) {
    return {
      text: 'No dashboards found. You can create one — try "create an executive dashboard".',
      dataDisplay: { displayType: 'metric', label: 'Dashboards', value: '0' },
    };
  }

  return {
    text: `Found ${rows.length} dashboard${rows.length === 1 ? '' : 's'}. ${rows.map((r) => `"${r.name}" (${r.widget_count} widgets: ${r.widget_list || 'none'}${r.is_default === 'Yes' ? ', default' : ''})`).join('; ')}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'description', label: 'Description' },
        { key: 'is_default', label: 'Default' },
        { key: 'widget_count', label: 'Widgets' },
        { key: 'widget_list', label: 'Widget List' },
      ],
      rows,
      totalRows: rows.length,
    },
  };
}

async function listAvailableWidgets(ctx: ServerToolContext): Promise<ServerToolResult> {
  const { data, error } = await ctx.supabase
    .from('widget_registry')
    .select('widget_key, name, domain, description, default_width, default_height')
    .eq('is_enabled', true)
    .order('domain')
    .limit(200);

  if (error || !data) {
    return {
      text: 'Failed to fetch widget registry.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' },
    };
  }

  const rows = data as any[];
  const byDomain: Record<string, string[]> = {};
  for (const w of rows) {
    const d = w.domain || 'other';
    if (!byDomain[d]) byDomain[d] = [];
    byDomain[d].push(w.name);
  }

  const domainSummary = Object.entries(byDomain)
    .map(([d, names]) => `${d}: ${names.join(', ')}`)
    .join('. ');

  return {
    text: `${rows.length} widgets available. ${domainSummary}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'domain', label: 'Domain' },
        { key: 'name', label: 'Widget Name' },
        { key: 'description', label: 'Description' },
        { key: 'default_width', label: 'Width' },
        { key: 'default_height', label: 'Height' },
        { key: 'widget_key', label: 'Key' },
      ],
      rows,
      totalRows: rows.length,
    },
  };
}

async function addDashboardWidget(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const dashboardQuery = params.dashboard;
  const widgetQuery = params.widget;

  if (!dashboardQuery || !widgetQuery) {
    return {
      text: 'Please specify both a dashboard name and a widget to add.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing parameters' },
    };
  }

  // Find the dashboard
  const { data: dashboards, error: dashError } = await ctx.supabase
    .from('dashboards')
    .select('id, name')
    .is('deleted_at', null)
    .limit(50);

  if (dashError || !dashboards?.length) {
    return {
      text: 'No dashboards found. Create one first — try "create an executive dashboard".',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'No dashboards' },
    };
  }

  const dashboard = fuzzyMatchDashboard(dashboards, dashboardQuery);
  if (!dashboard) {
    return {
      text: `Dashboard "${dashboardQuery}" not found. Available: ${dashboards.map((d: any) => d.name).join(', ')}.`,
      dataDisplay: { displayType: 'metric', label: 'Not Found', value: dashboardQuery },
    };
  }

  // Find the widget in registry
  const { data: registryWidgets, error: wError } = await ctx.supabase
    .from('widget_registry')
    .select('widget_key, name, default_width, default_height, default_config')
    .eq('is_enabled', true)
    .limit(200);

  if (wError || !registryWidgets?.length) {
    return {
      text: 'Failed to load widget registry.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Registry failed' },
    };
  }

  const widget = fuzzyMatchWidget(registryWidgets, widgetQuery);
  if (!widget) {
    return {
      text: `Widget "${widgetQuery}" not found in registry. Available: ${registryWidgets.map((w: any) => w.name).join(', ')}.`,
      dataDisplay: { displayType: 'metric', label: 'Not Found', value: widgetQuery },
    };
  }

  // Get existing widgets to calculate next Y position
  const { data: existing } = await ctx.supabase
    .from('dashboard_widgets')
    .select('layout')
    .eq('dashboard_id', dashboard.id)
    .is('deleted_at', null);

  let nextY = 0;
  if (existing?.length) {
    nextY = Math.max(
      ...existing.map((w: any) => {
        const layout = typeof w.layout === 'string' ? JSON.parse(w.layout) : w.layout;
        return (layout.y || 0) + (layout.h || 4);
      })
    );
  }

  const eventId = `ai_add_widget_${dashboard.id}_${widget.widget_key}_${Date.now()}`;

  const { error: insertError } = await ctx.supabase
    .from('dashboard_widgets')
    .upsert(
      {
        dashboard_id: dashboard.id,
        tenant_id: ctx.tenantId,
        widget_key: widget.widget_key,
        title: widget.name,
        config: widget.default_config || {},
        layout: { x: 0, y: nextY, w: widget.default_width || 6, h: widget.default_height || 4 },
        refresh_seconds: 300,
        last_event_id: eventId,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      },
      { onConflict: 'last_event_id' }
    );

  if (insertError) {
    return {
      text: `Failed to add widget: ${insertError.message}`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Insert failed' },
    };
  }

  return {
    text: `Added "${widget.name}" widget to dashboard "${dashboard.name}".`,
    dataDisplay: {
      displayType: 'dashboard_link',
      dashboardId: dashboard.id,
      dashboardName: dashboard.name,
    },
  };
}

async function removeDashboardWidget(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const dashboardQuery = params.dashboard;
  const widgetQuery = params.widget;

  if (!dashboardQuery || !widgetQuery) {
    return {
      text: 'Please specify both a dashboard name and the widget to remove.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing parameters' },
    };
  }

  // Find dashboard
  const { data: dashboards } = await ctx.supabase
    .from('dashboards')
    .select('id, name')
    .is('deleted_at', null)
    .limit(50);

  const dashboard = fuzzyMatchDashboard(dashboards || [], dashboardQuery);
  if (!dashboard) {
    const available = (dashboards || []).map((d: any) => d.name).join(', ');
    return {
      text: `Dashboard "${dashboardQuery}" not found.${available ? ` Available: ${available}.` : ''}`,
      dataDisplay: { displayType: 'metric', label: 'Not Found', value: dashboardQuery },
    };
  }

  // Find widget on this dashboard
  const { data: widgets } = await ctx.supabase
    .from('dashboard_widgets')
    .select('id, title, widget_key')
    .eq('dashboard_id', dashboard.id)
    .is('deleted_at', null);

  if (!widgets?.length) {
    return {
      text: `Dashboard "${dashboard.name}" has no widgets to remove.`,
      dataDisplay: { displayType: 'metric', label: 'Empty', value: '0 widgets' },
    };
  }

  const q = widgetQuery.toLowerCase();
  const match = widgets.find(
    (w: any) =>
      w.title?.toLowerCase().includes(q) || w.widget_key?.toLowerCase().includes(q)
  );

  if (!match) {
    return {
      text: `Widget "${widgetQuery}" not found on "${dashboard.name}". Current widgets: ${widgets.map((w: any) => w.title || w.widget_key).join(', ')}.`,
      dataDisplay: { displayType: 'metric', label: 'Not Found', value: widgetQuery },
    };
  }

  // Soft-delete the widget
  const { error } = await ctx.supabase
    .from('dashboard_widgets')
    .update({ deleted_at: new Date().toISOString(), updated_by: ctx.userId })
    .eq('id', match.id);

  if (error) {
    return {
      text: `Failed to remove widget: ${error.message}`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Remove failed' },
    };
  }

  return {
    text: `Removed "${match.title || match.widget_key}" from dashboard "${dashboard.name}".`,
    dataDisplay: {
      displayType: 'dashboard_link',
      dashboardId: dashboard.id,
      dashboardName: dashboard.name,
    },
  };
}

async function updateDashboardTool(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const dashboardQuery = params.dashboard;

  if (!dashboardQuery) {
    return {
      text: 'Please specify which dashboard to update.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing parameter' },
    };
  }

  const { data: dashboards } = await ctx.supabase
    .from('dashboards')
    .select('id, name')
    .is('deleted_at', null)
    .limit(50);

  const dashboard = fuzzyMatchDashboard(dashboards || [], dashboardQuery);
  if (!dashboard) {
    const available = (dashboards || []).map((d: any) => d.name).join(', ');
    return {
      text: `Dashboard "${dashboardQuery}" not found.${available ? ` Available: ${available}.` : ''}`,
      dataDisplay: { displayType: 'metric', label: 'Not Found', value: dashboardQuery },
    };
  }

  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  const changes: string[] = [];

  if (params.name) {
    updates.name = params.name;
    changes.push(`renamed to "${params.name}"`);
  }
  if (params.description !== undefined) {
    updates.description = params.description;
    changes.push('description updated');
  }
  if (params.is_default !== undefined) {
    const isDefault = params.is_default === true || params.is_default === 'true';

    // If setting as default, unset other defaults first
    if (isDefault) {
      await ctx.supabase
        .from('dashboards')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('is_default', true)
        .neq('id', dashboard.id);
    }

    updates.is_default = isDefault;
    changes.push(isDefault ? 'set as default' : 'removed as default');
  }

  if (changes.length === 0) {
    return {
      text: 'No changes specified. You can update: name, description, or is_default.',
      dataDisplay: { displayType: 'metric', label: 'No Changes', value: '—' },
    };
  }

  const { error } = await ctx.supabase
    .from('dashboards')
    .update(updates)
    .eq('id', dashboard.id);

  if (error) {
    return {
      text: `Failed to update dashboard: ${error.message}`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Update failed' },
    };
  }

  return {
    text: `Dashboard "${dashboard.name}" updated: ${changes.join(', ')}.`,
    dataDisplay: {
      displayType: 'dashboard_link',
      dashboardId: dashboard.id,
      dashboardName: params.name || dashboard.name,
    },
  };
}

async function deleteDashboardTool(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const dashboardQuery = params.dashboard;

  if (!dashboardQuery) {
    return {
      text: 'Please specify which dashboard to delete.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing parameter' },
    };
  }

  const { data: dashboards } = await ctx.supabase
    .from('dashboards')
    .select('id, name')
    .is('deleted_at', null)
    .limit(50);

  const dashboard = fuzzyMatchDashboard(dashboards || [], dashboardQuery);
  if (!dashboard) {
    const available = (dashboards || []).map((d: any) => d.name).join(', ');
    return {
      text: `Dashboard "${dashboardQuery}" not found.${available ? ` Available: ${available}.` : ''}`,
      dataDisplay: { displayType: 'metric', label: 'Not Found', value: dashboardQuery },
    };
  }

  const { error } = await ctx.supabase
    .from('dashboards')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', dashboard.id);

  if (error) {
    return {
      text: `Failed to delete dashboard: ${error.message}`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Delete failed' },
    };
  }

  return {
    text: `Dashboard "${dashboard.name}" has been deleted.`,
    dataDisplay: {
      displayType: 'metric',
      label: 'Deleted',
      value: dashboard.name,
    },
  };
}

// ─── Workflow: Auto-Reorder ──────────────────────────────────────────

async function workflowAutoReorder(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const dryRun = params.dry_run !== false && params.dry_run !== 'false';

  try {
    const res = await fetch(`${ctx.baseUrl}/api/ai/workflows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': ctx.cookieHeader,
      },
      body: JSON.stringify({ workflow: 'auto_reorder', dry_run: dryRun }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      return {
        text: `Workflow failed: ${err.error || res.statusText}`,
        dataDisplay: { displayType: 'metric', label: 'Error', value: 'Workflow failed' },
      };
    }

    const result = await res.json();
    const data = result.data;

    if (dryRun) {
      return {
        text: `Auto-Reorder Preview: ${data.suggestions?.length || 0} draft POs would be created across ${data.vendorCount || 0} vendors, totaling ${formatCurrency(data.totalAmount || 0)}. Say "confirm" or "go ahead" to create them.`,
        dataDisplay: {
          displayType: 'table',
          columns: [
            { key: 'vendor', label: 'Vendor' },
            { key: 'itemCount', label: 'Items' },
            { key: 'totalQty', label: 'Total Qty' },
            { key: 'estimatedAmount', label: 'Est. Amount' },
          ],
          rows: data.suggestions || [],
          totalRows: data.suggestions?.length || 0,
        },
      };
    }

    return {
      text: `Auto-Reorder Complete: Created ${data.posCreated || 0} draft purchase orders totaling ${formatCurrency(data.totalAmount || 0)}.`,
      dataDisplay: {
        displayType: 'table',
        columns: [
          { key: 'poNumber', label: 'PO #' },
          { key: 'vendor', label: 'Vendor' },
          { key: 'itemCount', label: 'Items' },
          { key: 'totalAmount', label: 'Amount' },
        ],
        rows: data.createdPOs || [],
        totalRows: data.posCreated || 0,
      },
    };
  } catch (err: any) {
    return {
      text: `Workflow failed: ${err.message}`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Workflow failed' },
    };
  }
}

// ─── Workflow: Stock Rebalance ───────────────────────────────────────

async function workflowStockRebalance(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const dryRun = params.dry_run !== false && params.dry_run !== 'false';

  try {
    const res = await fetch(`${ctx.baseUrl}/api/ai/workflows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': ctx.cookieHeader,
      },
      body: JSON.stringify({ workflow: 'stock_rebalance', dry_run: dryRun }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      return {
        text: `Workflow failed: ${err.error || res.statusText}`,
        dataDisplay: { displayType: 'metric', label: 'Error', value: 'Workflow failed' },
      };
    }

    const result = await res.json();
    const data = result.data;

    if (dryRun) {
      return {
        text: `Stock Rebalance Preview: ${data.transfers?.length || 0} transfers suggested to balance inventory across locations. Say "confirm" or "go ahead" to create them.`,
        dataDisplay: {
          displayType: 'table',
          columns: [
            { key: 'item', label: 'Item' },
            { key: 'fromLocation', label: 'From' },
            { key: 'toLocation', label: 'To' },
            { key: 'quantity', label: 'Qty' },
            { key: 'reason', label: 'Reason' },
          ],
          rows: data.transfers || [],
          totalRows: data.transfers?.length || 0,
        },
      };
    }

    return {
      text: `Stock Rebalance Complete: Created ${data.transfersCreated || 0} transfer orders.`,
      dataDisplay: {
        displayType: 'table',
        columns: [
          { key: 'transferId', label: 'Transfer #' },
          { key: 'item', label: 'Item' },
          { key: 'fromLocation', label: 'From' },
          { key: 'toLocation', label: 'To' },
          { key: 'quantity', label: 'Qty' },
        ],
        rows: data.createdTransfers || [],
        totalRows: data.transfersCreated || 0,
      },
    };
  } catch (err: any) {
    return {
      text: `Workflow failed: ${err.message}`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Workflow failed' },
    };
  }
}

// ─── Smart Stock Receive ────────────────────────────────────────────

async function smartStockReceive(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  try {
    const res = await fetch(`${ctx.baseUrl}/api/ai/stock-receive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': ctx.cookieHeader,
      },
      body: JSON.stringify({
        item_name: params.item_name,
        item_description: params.item_description,
        location_name: params.location_name,
        quantity: params.quantity,
        unit_of_measure: params.unit_of_measure,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      return {
        text: `Stock receive failed: ${err.error || res.statusText}`,
        dataDisplay: { displayType: 'metric', label: 'Error', value: 'Stock receive failed' },
      };
    }

    const result = await res.json();
    const d = result.data;

    return {
      text: `${d.item_created ? 'Created' : 'Found'} item "${d.item_name}" and added ${d.quantity_added} units at ${d.location_name}. Previous qty: ${d.previous_qty}, new qty: ${d.new_qty}.`,
      dataDisplay: {
        displayType: 'metric',
        label: 'Stock Received',
        value: `+${d.quantity_added}`,
        unit: d.unit_of_measure || 'units',
        secondaryMetrics: [
          { label: 'Item', value: d.item_name },
          { label: 'Location', value: d.location_name },
          { label: 'Previous Qty', value: formatNumber(d.previous_qty) },
          { label: 'New Qty', value: formatNumber(d.new_qty) },
        ],
      },
    };
  } catch (err: any) {
    return {
      text: `Stock receive failed: ${err.message}`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Stock receive failed' },
    };
  }
}

// ─── Smart Add Location ─────────────────────────────────────────────

async function smartAddLocation(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const name = typeof params.name === 'string' ? params.name.trim() : '';
  if (!name) {
    return {
      text: 'Please provide a location name.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing name' },
    };
  }

  const address = typeof params.address === 'string' ? params.address.trim() : '';
  const locationTypeHint = typeof params.location_type === 'string' ? params.location_type.trim() : '';

  // 1. Fuzzy-match location type
  let locationTypeId: string | null = null;
  let locationTypeName = '';

  const { data: locationTypes } = await ctx.supabase
    .from('location_types')
    .select('id, name')
    .limit(50);

  if (locationTypes?.length && locationTypeHint) {
    const q = locationTypeHint.toLowerCase();
    const match =
      locationTypes.find((lt: any) => lt.name.toLowerCase() === q) ||
      locationTypes.find((lt: any) => lt.name.toLowerCase().includes(q)) ||
      locationTypes.find((lt: any) => q.includes(lt.name.toLowerCase()));

    if (match) {
      locationTypeId = match.id;
      locationTypeName = match.name;
    }
  }

  // If no hint but name contains clues, try to infer type
  if (!locationTypeId && locationTypes?.length) {
    const nameLower = name.toLowerCase();
    const typeKeywords: Record<string, string[]> = {
      warehouse: ['warehouse', 'wh'],
      yard: ['yard'],
      'job site': ['job site', 'jobsite', 'job'],
      office: ['office', 'hq', 'headquarters'],
      shop: ['shop'],
      truck: ['truck'],
    };

    for (const [typeLabel, keywords] of Object.entries(typeKeywords)) {
      if (keywords.some((kw) => nameLower.includes(kw))) {
        const match = locationTypes.find(
          (lt: any) => lt.name.toLowerCase() === typeLabel || lt.name.toLowerCase().includes(typeLabel)
        );
        if (match) {
          locationTypeId = match.id;
          locationTypeName = match.name;
          break;
        }
      }
    }
  }

  // 2. Validate/standardize address via OpenAI web search if provided
  let validatedAddress = address;
  if (address) {
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (apiKey) {
        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey });

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          web_search_options: { search_context_size: 'medium' },
          messages: [
            {
              role: 'system',
              content: [
                'You are an address validation assistant.',
                'Given an address, search the web to validate and standardize it.',
                'Return ONLY a valid JSON object with these fields:',
                '  formatted_address — the full standardized address (street, city, state, zip)',
                '  valid — true if the address appears to be a real location, false otherwise',
                'Do NOT wrap the JSON in markdown code fences.',
              ].join('\n'),
            },
            { role: 'user', content: `Validate this address: "${address}"` },
          ],
          temperature: 0.2,
          max_tokens: 300,
        } as any);

        const content = completion.choices?.[0]?.message?.content;
        if (content) {
          let jsonStr = content.trim();
          const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (fenceMatch) jsonStr = fenceMatch[1].trim();

          const parsed = JSON.parse(jsonStr);
          if (parsed.formatted_address && parsed.valid !== false) {
            validatedAddress = parsed.formatted_address;
          }
        }
      }
    } catch {
      // Address validation failed — use the original address
    }
  }

  // 3. Create the location
  const insertData: Record<string, any> = {
    name,
    tenant_id: ctx.tenantId,
    is_active: true,
  };
  if (locationTypeId) insertData.location_type_id = locationTypeId;
  if (validatedAddress) insertData.address = validatedAddress;

  const { data: location, error } = await ctx.supabase
    .from('locations')
    .upsert(insertData, { onConflict: 'tenant_id,name' })
    .select('id, name, address, location_type_id')
    .single();

  if (error) {
    return {
      text: `Failed to create location: ${error.message}`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Creation failed' },
    };
  }

  const details: Array<{ label: string; value: string | number }> = [
    { label: 'Name', value: location.name },
  ];
  if (locationTypeName) details.push({ label: 'Type', value: locationTypeName });
  if (validatedAddress) details.push({ label: 'Address', value: validatedAddress });

  return {
    text: `Location "${location.name}" created${locationTypeName ? ` as ${locationTypeName}` : ''}${validatedAddress ? ` at ${validatedAddress}` : ''}.`,
    dataDisplay: {
      displayType: 'metric',
      label: 'Location Created',
      value: location.name,
      secondaryMetrics: details,
    },
  };
}

// ─── Smart Register Asset ───────────────────────────────────────────

async function smartRegisterAsset(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const name = typeof params.name === 'string' ? params.name.trim() : '';
  if (!name) {
    return {
      text: 'Please provide a name or description of the asset.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing name' },
    };
  }

  const description = typeof params.description === 'string' ? params.description.trim() : '';
  const locationHint = typeof params.location === 'string' ? params.location.trim() : '';
  const serialNumber = typeof params.serial_number === 'string' ? params.serial_number.trim() : '';
  let assetTag = typeof params.asset_tag === 'string' ? params.asset_tag.trim() : '';

  // 1. Find or create catalog item with tracking_mode='serialized'
  const nameLower = name.toLowerCase();

  // Search existing catalog items
  const { data: existingItems } = await inventorySchema(ctx.supabase)
    .from('catalog_items')
    .select('id, name, sku')
    .or(`name.ilike.%${nameLower}%,sku.ilike.%${nameLower}%`)
    .limit(10);

  let catalogItemId: string | null = null;
  let catalogItemName = '';
  let itemCreated = false;

  if (existingItems?.length) {
    // Fuzzy match: exact → contains → reverse contains
    const match =
      existingItems.find((i: any) => i.name.toLowerCase() === nameLower) ||
      existingItems.find((i: any) => i.name.toLowerCase().includes(nameLower)) ||
      existingItems.find((i: any) => nameLower.includes(i.name.toLowerCase())) ||
      existingItems[0];

    catalogItemId = match.id;
    catalogItemName = match.name;
  }

  if (!catalogItemId) {
    // Create a new catalog item with serialized tracking
    const sku = `AST-${name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase()}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const { data: newItem, error: itemError } = await inventorySchema(ctx.supabase)
      .from('catalog_items')
      .upsert(
        {
          name,
          sku,
          description: description || name,
          tracking_mode: 'serialized',
          unit_of_measure: 'each',
          tenant_id: ctx.tenantId,
        },
        { onConflict: 'tenant_id,sku' }
      )
      .select('id, name')
      .single();

    if (itemError || !newItem) {
      return {
        text: `Failed to create catalog item for asset: ${itemError?.message || 'Unknown error'}`,
        dataDisplay: { displayType: 'metric', label: 'Error', value: 'Item creation failed' },
      };
    }

    catalogItemId = newItem.id;
    catalogItemName = newItem.name;
    itemCreated = true;
  }

  // 2. Find location if specified
  let locationId: string | null = null;
  let locationName = '';

  if (locationHint) {
    const { data: locations } = await ctx.supabase
      .from('locations')
      .select('id, name')
      .ilike('name', `%${locationHint}%`)
      .limit(5);

    if (locations?.length) {
      const locLower = locationHint.toLowerCase();
      const match =
        locations.find((l: any) => l.name.toLowerCase() === locLower) ||
        locations.find((l: any) => l.name.toLowerCase().includes(locLower)) ||
        locations[0];

      locationId = match.id;
      locationName = match.name;
    }
  }

  // 3. Auto-generate asset tag if not provided
  if (!assetTag) {
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    assetTag = `AST-${rand}`;
  }

  // 4. Create the asset record
  const assetData: Record<string, any> = {
    asset_tag: assetTag,
    catalog_item_id: catalogItemId,
    tenant_id: ctx.tenantId,
    status: 'available',
  };
  if (locationId) assetData.location_id = locationId;
  if (serialNumber) assetData.serial_number = serialNumber;

  const { data: asset, error: assetError } = await inventorySchema(ctx.supabase)
    .from('assets')
    .upsert(assetData, { onConflict: 'tenant_id,asset_tag' })
    .select('id, asset_tag, serial_number')
    .single();

  if (assetError) {
    return {
      text: `Failed to register asset: ${assetError.message}`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Asset creation failed' },
    };
  }

  const details: Array<{ label: string; value: string | number }> = [
    { label: 'Asset Tag', value: asset.asset_tag },
    { label: 'Catalog Item', value: `${catalogItemName}${itemCreated ? ' (new)' : ''}` },
  ];
  if (locationName) details.push({ label: 'Location', value: locationName });
  if (serialNumber) details.push({ label: 'Serial #', value: serialNumber });

  return {
    text: `Registered asset "${catalogItemName}" with tag ${asset.asset_tag}${locationName ? ` at ${locationName}` : ''}${itemCreated ? ' (created new catalog item with serialized tracking)' : ''}.`,
    dataDisplay: {
      displayType: 'metric',
      label: 'Asset Registered',
      value: asset.asset_tag,
      secondaryMetrics: details,
    },
  };
}

// ─── Search Vendors Online ──────────────────────────────────────────

async function searchVendorsOnline(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const query = typeof params.query === 'string' ? params.query.trim() : '';
  if (!query) {
    return {
      text: 'Please specify what product or service you need a vendor for.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing query' },
    };
  }

  const location = typeof params.location === 'string' ? params.location.trim() : '';

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      text: 'Vendor search is not available — OpenAI API key is not configured.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'No API key' },
    };
  }

  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey });

    const searchQuery = location
      ? `${query} suppliers/vendors near ${location}`
      : `${query} suppliers/vendors`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      web_search_options: { search_context_size: 'medium' },
      messages: [
        {
          role: 'system',
          content: [
            'You are a vendor/supplier research assistant for a construction and materials company.',
            `Search the web for companies that sell or supply: "${query}"${location ? ` in or near ${location}` : ''}.`,
            'Find 3-5 real vendors with actual contact details.',
            'Return ONLY a valid JSON array of objects, each with these fields (omit any you cannot find):',
            '  name           — company name',
            '  website        — company website URL',
            '  phone          — phone number',
            '  email          — contact email',
            '  address        — business address',
            '  description    — brief description of what they offer (1 sentence)',
            'Do NOT wrap the JSON in markdown code fences.',
            'If you cannot find any vendors, return: []',
          ].join('\n'),
        },
        { role: 'user', content: `Find vendors for: ${searchQuery}` },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    } as any);

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      return {
        text: 'No vendor results found. Try broadening your search.',
        dataDisplay: { displayType: 'metric', label: 'Vendors Found', value: '0' },
      };
    }

    let jsonStr = content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const vendors = JSON.parse(jsonStr);

    if (!Array.isArray(vendors) || vendors.length === 0) {
      return {
        text: `No vendors found for "${query}"${location ? ` near ${location}` : ''}. Try different search terms.`,
        dataDisplay: { displayType: 'metric', label: 'Vendors Found', value: '0' },
      };
    }

    // Clean up results
    const cleaned = vendors.slice(0, 5).map((v: any) => ({
      name: v.name || 'Unknown',
      website: v.website || '',
      phone: v.phone || '',
      email: v.email || '',
      address: v.address || '',
      description: v.description || '',
    }));

    const summary = cleaned.map((v: any) => v.name).join(', ');

    return {
      text: `Found ${cleaned.length} vendor${cleaned.length === 1 ? '' : 's'} for "${query}"${location ? ` near ${location}` : ''}: ${summary}. Would you like me to add any of these as vendors in your system?`,
      dataDisplay: {
        displayType: 'table',
        columns: [
          { key: 'name', label: 'Vendor' },
          { key: 'description', label: 'Description' },
          { key: 'phone', label: 'Phone' },
          { key: 'email', label: 'Email' },
          { key: 'website', label: 'Website' },
          { key: 'address', label: 'Address' },
        ],
        rows: cleaned,
        totalRows: cleaned.length,
      },
    };
  } catch (err: any) {
    return {
      text: `Vendor search failed: ${err.message}`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Search failed' },
    };
  }
}

// ─── Set Preferred Vendor ───────────────────────────────────────────

async function setPreferredVendor(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const vendorHint = typeof params.vendor === 'string' ? params.vendor.trim() : '';
  const itemHint = typeof params.item === 'string' ? params.item.trim() : '';

  if (!vendorHint || !itemHint) {
    return {
      text: 'Please specify both a vendor name and a catalog item.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing parameters' },
    };
  }

  const unitCost = typeof params.unit_cost === 'number' ? params.unit_cost : null;
  const leadTimeDays = typeof params.lead_time_days === 'number' ? params.lead_time_days : null;

  // 1. Fuzzy-match vendor
  const { data: vendors } = await supplyChainSchema(ctx.supabase)
    .from('vendors')
    .select('id, name')
    .or(`name.ilike.%${vendorHint}%`)
    .limit(10);

  if (!vendors?.length) {
    return {
      text: `Vendor "${vendorHint}" not found. Add them first with "add vendor ${vendorHint}".`,
      dataDisplay: { displayType: 'metric', label: 'Not Found', value: vendorHint },
    };
  }

  const vendorLower = vendorHint.toLowerCase();
  const vendor =
    vendors.find((v: any) => v.name.toLowerCase() === vendorLower) ||
    vendors.find((v: any) => v.name.toLowerCase().includes(vendorLower)) ||
    vendors.find((v: any) => vendorLower.includes(v.name.toLowerCase())) ||
    vendors[0];

  // 2. Fuzzy-match catalog item
  const { data: items } = await inventorySchema(ctx.supabase)
    .from('catalog_items')
    .select('id, name, sku')
    .or(`name.ilike.%${itemHint}%,sku.ilike.%${itemHint}%`)
    .limit(10);

  if (!items?.length) {
    return {
      text: `Item "${itemHint}" not found in catalog. Add it first.`,
      dataDisplay: { displayType: 'metric', label: 'Not Found', value: itemHint },
    };
  }

  const itemLower = itemHint.toLowerCase();
  const item =
    items.find((i: any) => i.name.toLowerCase() === itemLower) ||
    items.find((i: any) => i.name.toLowerCase().includes(itemLower)) ||
    items.find((i: any) => itemLower.includes(i.name.toLowerCase())) ||
    items[0];

  // 3. Upsert vendor_items row with is_preferred=true
  const vendorItemData: Record<string, any> = {
    vendor_id: vendor.id,
    catalog_item_id: item.id,
    tenant_id: ctx.tenantId,
    is_preferred: true,
  };
  if (unitCost !== null) vendorItemData.unit_cost = unitCost;
  if (leadTimeDays !== null) vendorItemData.lead_time_days = leadTimeDays;

  const { error: viError } = await supplyChainSchema(ctx.supabase)
    .from('vendor_items')
    .upsert(vendorItemData, { onConflict: 'tenant_id,vendor_id,catalog_item_id' })
    .select()
    .single();

  if (viError) {
    return {
      text: `Failed to link vendor to item: ${viError.message}`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Link failed' },
    };
  }

  // 4. Update catalog_items.preferred_vendor_id
  const { error: updateError } = await inventorySchema(ctx.supabase)
    .from('catalog_items')
    .update({ preferred_vendor_id: vendor.id })
    .eq('id', item.id);

  if (updateError) {
    // Non-fatal — the vendor_items link was created, just couldn't set preferred
  }

  const details: Array<{ label: string; value: string | number }> = [
    { label: 'Vendor', value: vendor.name },
    { label: 'Item', value: item.name },
  ];
  if (unitCost !== null) details.push({ label: 'Unit Cost', value: formatCurrency(unitCost) });
  if (leadTimeDays !== null) details.push({ label: 'Lead Time', value: `${leadTimeDays} days` });

  return {
    text: `Set ${vendor.name} as preferred vendor for ${item.name}${unitCost !== null ? ` at ${formatCurrency(unitCost)}/unit` : ''}${leadTimeDays !== null ? `, ${leadTimeDays}-day lead time` : ''}.`,
    dataDisplay: {
      displayType: 'metric',
      label: 'Preferred Vendor Set',
      value: vendor.name,
      secondaryMetrics: details,
    },
  };
}
