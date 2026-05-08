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
  'enrich_vendor',
  'enrich_item',
  'query_reservations',
  'query_asset_value',
  'draft_purchase_request',
  'extract_document',
  'list_pending_apparel_orders',
  'approve_apparel_order',
  'reject_apparel_order',
  'semantic_search',
  'purchasing_assistant',
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
    case 'enrich_vendor':
      return enrichVendor(params, ctx);
    case 'enrich_item':
      return enrichItem(params, ctx);
    case 'query_reservations':
      return queryReservations(params, ctx);
    case 'query_asset_value':
      return queryAssetValue(params, ctx);
    case 'draft_purchase_request':
      return draftPurchaseRequest(params, ctx);
    case 'extract_document':
      return extractDocument(params, ctx);
    case 'list_pending_apparel_orders':
      return listPendingApparelOrders(params, ctx);
    case 'approve_apparel_order':
      return approveApparelOrder(params, ctx);
    case 'reject_apparel_order':
      return rejectApparelOrder(params, ctx);
    case 'semantic_search':
      return semanticSearchItems(params, ctx);
    case 'purchasing_assistant':
      return purchasingAssistant(params, ctx);
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

  // Read-after-write: verify widget was added
  const { data: verifyWidgets } = await ctx.supabase
    .from('dashboard_widgets')
    .select('id')
    .eq('dashboard_id', dashboard.id)
    .is('deleted_at', null);
  const widgetCount = verifyWidgets?.length || 0;

  return {
    text: `Added "${widget.name}" widget to dashboard "${dashboard.name}" (now ${widgetCount} widget${widgetCount !== 1 ? 's' : ''}).`,
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

  // Read-after-write: verify widget was removed
  const { data: remainingWidgets } = await ctx.supabase
    .from('dashboard_widgets')
    .select('id')
    .eq('dashboard_id', dashboard.id)
    .is('deleted_at', null);
  const remainingCount = remainingWidgets?.length || 0;

  return {
    text: `Removed "${match.title || match.widget_key}" from dashboard "${dashboard.name}" (${remainingCount} widget${remainingCount !== 1 ? 's' : ''} remaining).`,
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
    const idempotencyKey = `ai-auto-reorder-${ctx.tenantId}-${Date.now()}`;
    const res = await fetch(`${ctx.baseUrl}/api/ai/workflows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': ctx.cookieHeader,
        'Idempotency-Key': idempotencyKey,
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
    const idempotencyKey = `ai-stock-rebalance-${ctx.tenantId}-${Date.now()}`;
    const res = await fetch(`${ctx.baseUrl}/api/ai/workflows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': ctx.cookieHeader,
        'Idempotency-Key': idempotencyKey,
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
    const idempotencyKey = `ai-stock-receive-${ctx.tenantId}-${Date.now()}`;
    const res = await fetch(`${ctx.baseUrl}/api/ai/stock-receive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': ctx.cookieHeader,
        'Idempotency-Key': idempotencyKey,
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
    const userMsg = error.code === '23505'
      ? `A location named "${params.name}" already exists.`
      : `Failed to create location: ${error.message}`;
    return {
      text: userMsg,
      dataDisplay: { displayType: 'metric', label: 'Error', value: error.code === '23505' ? 'Already exists' : error.message },
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
  const assetTag = typeof params.asset_tag === 'string' ? params.asset_tag.trim() : '';
  const quantity = Math.min(Math.max(Number(params.quantity) || 1, 1), 20);

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

  // 3. Create asset(s)
  const createdAssets: Array<{ tag: string; serial?: string }> = [];

  for (let i = 0; i < quantity; i++) {
    const tag = assetTag && quantity === 1
      ? assetTag
      : `AST-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const assetData: Record<string, any> = {
      asset_tag: tag,
      catalog_item_id: catalogItemId,
      tenant_id: ctx.tenantId,
      status: 'available',
    };
    if (locationId) assetData.location_id = locationId;
    if (serialNumber && quantity === 1) assetData.serial_number = serialNumber;

    const { data: asset, error: assetError } = await inventorySchema(ctx.supabase)
      .from('assets')
      .upsert(assetData, { onConflict: 'tenant_id,asset_tag' })
      .select('id, asset_tag, serial_number')
      .single();

    if (assetError) {
      return {
        text: `Failed to register asset ${i + 1} of ${quantity}: ${assetError.message}`,
        dataDisplay: { displayType: 'metric', label: 'Error', value: `Asset ${i + 1} failed: ${assetError.code === '23505' ? 'Duplicate asset tag' : assetError.message}` },
      };
    }

    createdAssets.push({ tag: asset.asset_tag, serial: asset.serial_number || undefined });
  }

  const tagList = createdAssets.map((a) => a.tag).join(', ');

  const details: Array<{ label: string; value: string | number }> = [];
  if (quantity > 1) {
    details.push({ label: 'Count', value: quantity });
    details.push({ label: 'Asset Tags', value: tagList });
  } else {
    details.push({ label: 'Asset Tag', value: createdAssets[0].tag });
  }
  details.push({ label: 'Catalog Item', value: `${catalogItemName}${itemCreated ? ' (new)' : ''}` });
  if (locationName) details.push({ label: 'Location', value: locationName });
  if (serialNumber && quantity === 1) details.push({ label: 'Serial #', value: serialNumber });

  const summary = quantity > 1
    ? `Registered ${quantity} "${catalogItemName}" assets: ${tagList}${locationName ? ` at ${locationName}` : ''}${itemCreated ? ' (created new catalog item with serialized tracking)' : ''}.`
    : `Registered asset "${catalogItemName}" with tag ${createdAssets[0].tag}${locationName ? ` at ${locationName}` : ''}${itemCreated ? ' (created new catalog item with serialized tracking)' : ''}.`;

  return {
    text: summary,
    dataDisplay: {
      displayType: 'metric',
      label: quantity > 1 ? `${quantity} Assets Registered` : 'Asset Registered',
      value: quantity > 1 ? tagList : createdAssets[0].tag,
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

// ─── Fuzzy Find Helper ──────────────────────────────────────────────

function fuzzyFind<T extends { name: string }>(items: T[], query: string): T | null {
  const q = query.toLowerCase();
  return (
    items.find((i) => i.name.toLowerCase() === q) ||
    items.find((i) => i.name.toLowerCase().includes(q)) ||
    items.find((i) => q.includes(i.name.toLowerCase())) ||
    null
  );
}

// ─── Enrich Vendor ──────────────────────────────────────────────────

async function enrichVendor(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const vendorHint = typeof params.vendor_name === 'string' ? params.vendor_name.trim() : '';
  if (!vendorHint) {
    return {
      text: 'Please specify a vendor name to enrich.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing vendor name' },
    };
  }

  // 1. Find existing vendor
  const { data: vendors } = await supplyChainSchema(ctx.supabase)
    .from('vendors')
    .select('id, name, code, contact_name, contact_email, contact_phone, address, website, payment_terms, notes')
    .or(`name.ilike.%${vendorHint}%`)
    .limit(10);

  if (!vendors?.length) {
    return {
      text: `Vendor "${vendorHint}" not found. Add them first with "add vendor ${vendorHint}".`,
      dataDisplay: { displayType: 'metric', label: 'Not Found', value: vendorHint },
    };
  }

  const vendor = fuzzyFind(vendors, vendorHint) || vendors[0];

  // 2. Search web for vendor info
  const { getSearchProvider } = await import('./search-provider');
  const provider = getSearchProvider();

  if (!provider) {
    return {
      text: 'Enrichment is not available — no search provider configured (needs OPENAI_API_KEY).',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'No search provider' },
    };
  }

  // Use OpenAI directly for structured vendor research
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      text: 'Enrichment is not available — OPENAI_API_KEY not configured.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'No API key' },
    };
  }

  const suggestedFields: Record<string, { current: string; suggested: string; confidence: number; source?: string }> = {};

  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      web_search_options: { search_context_size: 'medium' },
      messages: [
        {
          role: 'system',
          content: [
            'You are a company research assistant for a construction materials inventory system.',
            `Research the company "${vendor.name}" and return updated contact details.`,
            'Return ONLY a valid JSON object with these fields (include all you can find):',
            '  contact_name   — key contact person (CEO, sales manager, account rep)',
            '  contact_email  — main contact or sales email',
            '  contact_phone  — main phone number',
            '  address        — full business address',
            '  website        — company website URL',
            '  payment_terms  — standard payment terms if known (e.g. "Net 30")',
            '  confidence     — overall confidence score 0.0-1.0 that this is the right company',
            '  source_url     — the main source URL for this information',
            'Do NOT wrap the JSON in markdown code fences.',
          ].join('\n'),
        },
        { role: 'user', content: `Look up: "${vendor.name}"` },
      ],
      temperature: 0.2,
      max_tokens: 600,
    } as any);

    const content = completion.choices?.[0]?.message?.content;
    if (content) {
      let jsonStr = content.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();

      const parsed = JSON.parse(jsonStr);
      const sourceUrl = parsed.source_url || '';

      const enrichableFields = ['contact_name', 'contact_email', 'contact_phone', 'address', 'website', 'payment_terms'] as const;

      for (const field of enrichableFields) {
        const suggested = parsed[field];
        const current = (vendor as any)[field] || '';
        if (typeof suggested === 'string' && suggested.trim() && suggested.trim() !== current.trim()) {
          suggestedFields[field] = {
            current: current || '(empty)',
            suggested: suggested.trim(),
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
            source: sourceUrl,
          };
        }
      }
    }
  } catch {
    return {
      text: `Failed to search for vendor "${vendor.name}" online. Try again later.`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Search failed' },
    };
  }

  // 3. Log to enrichment_log
  if (Object.keys(suggestedFields).length > 0) {
    try {
      await inventorySchema(ctx.supabase)
        .from('enrichment_log')
        .upsert({
          tenant_id: ctx.tenantId,
          entity_type: 'vendor',
          entity_id: vendor.id,
          provider: 'openai',
          source_url: Object.values(suggestedFields)[0]?.source || null,
          fields_suggested: suggestedFields,
          status: 'suggested',
          confidence: Math.min(...Object.values(suggestedFields).map((f) => f.confidence)),
          requested_by: ctx.userId,
        }, { onConflict: 'id' });
    } catch {
      // Non-fatal — enrichment log insert failed but we still have the suggestions
    }
  }

  // 4. Return diff table
  if (Object.keys(suggestedFields).length === 0) {
    return {
      text: `No new information found for "${vendor.name}". Current records appear up-to-date.`,
      dataDisplay: { displayType: 'metric', label: 'Up to Date', value: vendor.name },
    };
  }

  const fieldLabels: Record<string, string> = {
    contact_name: 'Contact Name',
    contact_email: 'Contact Email',
    contact_phone: 'Contact Phone',
    address: 'Address',
    website: 'Website',
    payment_terms: 'Payment Terms',
  };

  const rows = Object.entries(suggestedFields).map(([field, info]) => ({
    field: fieldLabels[field] || field,
    current: info.current,
    suggested: info.suggested,
    confidence: `${Math.round(info.confidence * 100)}%`,
  }));

  return {
    text: `Found ${rows.length} potential update${rows.length === 1 ? '' : 's'} for "${vendor.name}". Review the suggestions below — say "apply those" to update, or pick specific fields.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'field', label: 'Field' },
        { key: 'current', label: 'Current' },
        { key: 'suggested', label: 'Suggested' },
        { key: 'confidence', label: 'Confidence' },
      ],
      rows,
      totalRows: rows.length,
    },
  };
}

// ─── Enrich Item ────────────────────────────────────────────────────

async function enrichItem(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const itemHint = typeof params.item_name === 'string' ? params.item_name.trim() : '';
  if (!itemHint) {
    return {
      text: 'Please specify an item name to enrich.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing item name' },
    };
  }

  // 1. Find existing item
  const { data: items } = await inventorySchema(ctx.supabase)
    .from('catalog_items')
    .select('id, name, sku, description, unit_of_measure, reorder_point, category_id, tracking_mode')
    .or(`name.ilike.%${itemHint}%,sku.ilike.%${itemHint}%`)
    .limit(10);

  if (!items?.length) {
    return {
      text: `Item "${itemHint}" not found in catalog.`,
      dataDisplay: { displayType: 'metric', label: 'Not Found', value: itemHint },
    };
  }

  const item = fuzzyFind(items, itemHint) || items[0];

  // 2. Get current category name if category_id exists
  let currentCategory = '';
  if (item.category_id) {
    const { data: cat } = await inventorySchema(ctx.supabase)
      .from('categories')
      .select('name')
      .eq('id', item.category_id)
      .limit(1)
      .single();
    if (cat) currentCategory = cat.name;
  }

  // 3. Use OpenAI reasoning to suggest fields
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      text: 'Enrichment is not available — OPENAI_API_KEY not configured.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'No API key' },
    };
  }

  const suggestedFields: Record<string, { current: string; suggested: string; confidence: number }> = {};

  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey });

    const barcodeContext = params.barcode ? `\nBarcode/UPC: ${params.barcode}` : '';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: [
            'You are a construction materials inventory specialist.',
            'Given an item name, suggest standardized field values based on industry conventions.',
            'Return ONLY a valid JSON object with these fields (omit any where you have low confidence):',
            '  category       — industry-standard category (e.g. "Concrete", "Steel", "Fasteners", "Safety Equipment", "Lumber")',
            '  unit_of_measure — standard UOM (e.g. "each", "ton", "bag", "gallon", "lb", "ft", "yd")',
            '  description    — concise professional description (1-2 sentences)',
            '  reorder_point  — suggested reorder point for a mid-size construction company (number)',
            '  confidence     — overall confidence 0.0-1.0',
            'Consider the barcode/UPC if provided to identify the exact product.',
            'Do NOT wrap the JSON in markdown code fences.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Item name: "${item.name}"${barcodeContext}\nCurrent description: "${item.description || ''}"`,
        },
      ],
      temperature: 0.3,
      max_tokens: 400,
    });

    const content = completion.choices?.[0]?.message?.content;
    if (content) {
      let jsonStr = content.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();

      const parsed = JSON.parse(jsonStr);
      const overallConfidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.7;

      if (parsed.category && parsed.category !== currentCategory) {
        suggestedFields['category'] = {
          current: currentCategory || '(none)',
          suggested: parsed.category,
          confidence: overallConfidence,
        };
      }
      if (parsed.unit_of_measure && parsed.unit_of_measure !== item.unit_of_measure) {
        suggestedFields['unit_of_measure'] = {
          current: item.unit_of_measure || '(none)',
          suggested: parsed.unit_of_measure,
          confidence: overallConfidence,
        };
      }
      if (parsed.description && parsed.description !== item.description) {
        suggestedFields['description'] = {
          current: item.description || '(none)',
          suggested: parsed.description,
          confidence: overallConfidence,
        };
      }
      if (parsed.reorder_point != null && parsed.reorder_point !== item.reorder_point) {
        suggestedFields['reorder_point'] = {
          current: item.reorder_point != null ? String(item.reorder_point) : '(not set)',
          suggested: String(parsed.reorder_point),
          confidence: overallConfidence,
        };
      }
    }
  } catch {
    return {
      text: `Failed to generate suggestions for "${item.name}". Try again later.`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'AI failed' },
    };
  }

  // 4. Log to enrichment_log
  if (Object.keys(suggestedFields).length > 0) {
    try {
      await inventorySchema(ctx.supabase)
        .from('enrichment_log')
        .upsert({
          tenant_id: ctx.tenantId,
          entity_type: 'item',
          entity_id: item.id,
          provider: 'openai',
          fields_suggested: suggestedFields,
          status: 'suggested',
          confidence: Math.min(...Object.values(suggestedFields).map((f) => f.confidence)),
          requested_by: ctx.userId,
        }, { onConflict: 'id' });
    } catch {
      // Non-fatal
    }
  }

  // 5. Return suggestions
  if (Object.keys(suggestedFields).length === 0) {
    return {
      text: `No improvements suggested for "${item.name}" (${item.sku}). Current data looks good.`,
      dataDisplay: { displayType: 'metric', label: 'Up to Date', value: item.name },
    };
  }

  const fieldLabels: Record<string, string> = {
    category: 'Category',
    unit_of_measure: 'Unit of Measure',
    description: 'Description',
    reorder_point: 'Reorder Point',
  };

  const rows = Object.entries(suggestedFields).map(([field, info]) => ({
    field: fieldLabels[field] || field,
    current: info.current,
    suggested: info.suggested,
    confidence: `${Math.round(info.confidence * 100)}%`,
  }));

  return {
    text: `Found ${rows.length} suggestion${rows.length === 1 ? '' : 's'} for "${item.name}" (${item.sku}). Review below — say "apply those" to update, or pick specific fields.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'field', label: 'Field' },
        { key: 'current', label: 'Current' },
        { key: 'suggested', label: 'Suggested' },
        { key: 'confidence', label: 'Confidence' },
      ],
      rows,
      totalRows: rows.length,
    },
  };
}

// ─── Query Reservations ─────────────────────────────────────────────

function parseDateRange(input: string): { start: Date; end: Date } | null {
  const now = new Date();
  const lower = input.toLowerCase().trim();

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  if (lower === 'today') {
    return { start: startOfDay(now), end: endOfDay(now) };
  }
  if (lower === 'tomorrow') {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { start: startOfDay(tomorrow), end: endOfDay(tomorrow) };
  }
  if (lower === 'yesterday') {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
  }
  if (lower === 'this week') {
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: startOfDay(monday), end: endOfDay(sunday) };
  }
  if (lower === 'next week') {
    const dayOfWeek = now.getDay();
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + (dayOfWeek === 0 ? 1 : 8 - dayOfWeek));
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);
    return { start: startOfDay(nextMonday), end: endOfDay(nextSunday) };
  }

  // Try "YYYY-MM-DD to YYYY-MM-DD" or "YYYY-MM-DD - YYYY-MM-DD"
  const rangeMatch = lower.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|-)\s*(\d{4}-\d{2}-\d{2})/);
  if (rangeMatch) {
    return { start: startOfDay(new Date(rangeMatch[1])), end: endOfDay(new Date(rangeMatch[2])) };
  }

  // Try single ISO date
  const isoMatch = lower.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (isoMatch) {
    const d = new Date(isoMatch[1]);
    return { start: startOfDay(d), end: endOfDay(d) };
  }

  // Try "Month Day" or "Month Day-Day"
  const monthDayMatch = lower.match(/^([a-z]+)\s+(\d{1,2})(?:\s*-\s*(\d{1,2}))?$/);
  if (monthDayMatch) {
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const monthIdx = months.findIndex((m) => m.startsWith(monthDayMatch[1]));
    if (monthIdx >= 0) {
      const year = now.getFullYear();
      const startDate = new Date(year, monthIdx, parseInt(monthDayMatch[2]));
      const endDate = monthDayMatch[3]
        ? new Date(year, monthIdx, parseInt(monthDayMatch[3]))
        : startDate;
      return { start: startOfDay(startDate), end: endOfDay(endDate) };
    }
  }

  return null;
}

async function queryReservations(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  let query = inventorySchema(ctx.supabase)
    .from('reservations')
    .select('id, catalog_item_id, location_id, quantity, allocation_type, job_ref, status, reserved_from, reserved_until, asset_tag, created_at');

  // Default to active if no status specified
  const statusFilter = typeof params.status === 'string' ? params.status : 'active';
  if (statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }

  // Date range filter
  if (params.date_range) {
    const range = parseDateRange(params.date_range);
    if (range) {
      query = query
        .or(`reserved_from.lte.${range.end.toISOString()},reserved_from.is.null`)
        .or(`reserved_until.gte.${range.start.toISOString()},reserved_until.is.null`);
    }
  }

  // Asset tag filter
  if (params.asset_tag) {
    query = query.ilike('asset_tag', `%${params.asset_tag}%`);
  }

  // Person/job filter
  if (params.person) {
    query = query.ilike('job_ref', `%${params.person}%`);
  }

  const { data: reservations, error } = await query.order('created_at', { ascending: false }).limit(50);

  if (error || !reservations) {
    return {
      text: 'Failed to query reservations.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' },
    };
  }

  // Resolve item names
  const itemIds = [...new Set(reservations.map((r: any) => r.catalog_item_id).filter(Boolean))];
  let itemMap: Record<string, string> = {};
  if (itemIds.length > 0) {
    const { data: itemData } = await inventorySchema(ctx.supabase)
      .from('catalog_items')
      .select('id, name')
      .in('id', itemIds)
      .limit(200);
    if (itemData) {
      itemMap = Object.fromEntries(itemData.map((i: any) => [i.id, i.name]));
    }
  }

  // Resolve location names
  const locIds = [...new Set(reservations.map((r: any) => r.location_id).filter(Boolean))];
  let locMap: Record<string, string> = {};
  if (locIds.length > 0) {
    const { data: locData } = await ctx.supabase
      .from('locations')
      .select('id, name')
      .in('id', locIds)
      .limit(200);
    if (locData) {
      locMap = Object.fromEntries(locData.map((l: any) => [l.id, l.name]));
    }
  }

  // Filter by item name if specified (post-query fuzzy filter)
  let filtered = reservations as any[];
  if (params.item_name) {
    const itemQ = params.item_name.toLowerCase();
    filtered = filtered.filter((r: any) => {
      const name = itemMap[r.catalog_item_id] || '';
      return name.toLowerCase().includes(itemQ);
    });
  }

  if (filtered.length === 0) {
    const filterDesc = [
      params.item_name && `item "${params.item_name}"`,
      params.date_range && `date "${params.date_range}"`,
      params.person && `person/job "${params.person}"`,
      params.asset_tag && `asset "${params.asset_tag}"`,
    ].filter(Boolean).join(', ');

    return {
      text: `No ${statusFilter} reservations found${filterDesc ? ` matching ${filterDesc}` : ''}.`,
      dataDisplay: { displayType: 'metric', label: 'Reservations', value: '0' },
    };
  }

  const rows = filtered.map((r: any) => ({
    item: itemMap[r.catalog_item_id] || '(unknown)',
    qty_or_asset: r.asset_tag || formatNumber(r.quantity || 0),
    reserved_from: r.reserved_from ? new Date(r.reserved_from).toLocaleDateString() : '—',
    reserved_until: r.reserved_until ? new Date(r.reserved_until).toLocaleDateString() : 'Open',
    job_person: r.job_ref || '—',
    location: locMap[r.location_id] || '—',
    status: r.status,
  }));

  return {
    text: `Found ${rows.length} reservation${rows.length === 1 ? '' : 's'}. ${rows.slice(0, 3).map((r) => `${r.item}: ${r.qty_or_asset} for ${r.job_person} (${r.reserved_from} → ${r.reserved_until})`).join('; ')}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'item', label: 'Item' },
        { key: 'qty_or_asset', label: 'Qty/Asset' },
        { key: 'reserved_from', label: 'From' },
        { key: 'reserved_until', label: 'Until' },
        { key: 'job_person', label: 'Job/Person' },
        { key: 'location', label: 'Location' },
        { key: 'status', label: 'Status' },
      ],
      rows,
      totalRows: rows.length,
    },
  };
}

// ─── Query Asset Value ──────────────────────────────────────────────

async function queryAssetValue(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const groupBy = typeof params.group_by === 'string' ? params.group_by : 'category';

  // Fetch assets with related data
  const { data: assets, error } = await inventorySchema(ctx.supabase)
    .from('assets')
    .select('id, asset_tag, status, purchase_cost, catalog_item_id, location_id')
    .limit(1000);

  if (error || !assets) {
    return {
      text: 'Failed to query assets.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' },
    };
  }

  if (assets.length === 0) {
    return {
      text: 'No assets registered. Register assets with "register a new [equipment name]".',
      dataDisplay: { displayType: 'metric', label: 'Assets', value: '0' },
    };
  }

  // Resolve item names and categories
  const itemIds = [...new Set(assets.map((a: any) => a.catalog_item_id).filter(Boolean))];
  let itemMap: Record<string, { name: string; category_id?: string }> = {};
  if (itemIds.length > 0) {
    const { data: itemData } = await inventorySchema(ctx.supabase)
      .from('catalog_items')
      .select('id, name, category_id')
      .in('id', itemIds)
      .limit(1000);
    if (itemData) {
      itemMap = Object.fromEntries(itemData.map((i: any) => [i.id, { name: i.name, category_id: i.category_id }]));
    }
  }

  // Resolve categories
  const catIds = [...new Set(Object.values(itemMap).map((i) => i.category_id).filter(Boolean))];
  let catMap: Record<string, string> = {};
  if (catIds.length > 0) {
    const { data: catData } = await inventorySchema(ctx.supabase)
      .from('categories')
      .select('id, name')
      .in('id', catIds as string[])
      .limit(200);
    if (catData) {
      catMap = Object.fromEntries(catData.map((c: any) => [c.id, c.name]));
    }
  }

  // Resolve locations
  const locIds = [...new Set(assets.map((a: any) => a.location_id).filter(Boolean))];
  let locMap: Record<string, string> = {};
  if (locIds.length > 0) {
    const { data: locData } = await ctx.supabase
      .from('locations')
      .select('id, name')
      .in('id', locIds)
      .limit(200);
    if (locData) {
      locMap = Object.fromEntries(locData.map((l: any) => [l.id, l.name]));
    }
  }

  // Calculate totals
  let totalValue = 0;
  let knownCount = 0;
  let unknownCount = 0;

  const groups: Record<string, { count: number; value: number; unknownCount: number }> = {};

  for (const asset of assets as any[]) {
    const cost = Number(asset.purchase_cost) || 0;
    if (cost > 0) {
      totalValue += cost;
      knownCount++;
    } else {
      unknownCount++;
    }

    let groupKey = 'Unknown';
    if (groupBy === 'category') {
      const itemInfo = itemMap[asset.catalog_item_id];
      groupKey = (itemInfo?.category_id ? catMap[itemInfo.category_id] : null) || 'Uncategorized';
    } else if (groupBy === 'location') {
      groupKey = locMap[asset.location_id] || 'Unassigned';
    } else if (groupBy === 'status') {
      groupKey = asset.status || 'unknown';
    }

    if (!groups[groupKey]) groups[groupKey] = { count: 0, value: 0, unknownCount: 0 };
    groups[groupKey].count++;
    if (cost > 0) {
      groups[groupKey].value += cost;
    } else {
      groups[groupKey].unknownCount++;
    }
  }

  const rows = Object.entries(groups)
    .sort((a, b) => b[1].value - a[1].value)
    .map(([group, info]) => ({
      group,
      count: info.count,
      value: formatCurrency(info.value),
      unknown_cost: info.unknownCount > 0 ? `${info.unknownCount} unknown` : '—',
    }));

  const groupLabel = groupBy === 'category' ? 'Category' : groupBy === 'location' ? 'Location' : 'Status';

  return {
    text: `Total asset value: ${formatCurrency(totalValue)} across ${assets.length} assets. ${knownCount} assets have purchase costs recorded${unknownCount > 0 ? `, ${unknownCount} assets have no purchase cost recorded` : ''}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'group', label: groupLabel },
        { key: 'count', label: 'Assets' },
        { key: 'value', label: 'Total Value' },
        { key: 'unknown_cost', label: 'Missing Cost' },
      ],
      rows,
      totalRows: rows.length,
    },
  };
}

// ─── Draft Purchase Request ─────────────────────────────────────────

async function draftPurchaseRequest(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const vendorHint = typeof params.vendor_name === 'string' ? params.vendor_name.trim() : '';
  if (!vendorHint) {
    return {
      text: 'Please specify a vendor name for the purchase request.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing vendor' },
    };
  }

  // 1. Find vendor
  const { data: vendors } = await supplyChainSchema(ctx.supabase)
    .from('vendors')
    .select('id, name, contact_name, contact_email, contact_phone, address, payment_terms')
    .or(`name.ilike.%${vendorHint}%`)
    .limit(10);

  if (!vendors?.length) {
    return {
      text: `Vendor "${vendorHint}" not found. Add them first with "add vendor ${vendorHint}".`,
      dataDisplay: { displayType: 'metric', label: 'Not Found', value: vendorHint },
    };
  }

  const vendor = fuzzyFind(vendors, vendorHint) || vendors[0];

  // 2. Get items to order
  let orderItems: Array<{ name: string; qty: number; unit?: string }> = [];

  if (params.items) {
    // User specified items
    const itemNames = String(params.items).split(',').map((s: string) => s.trim()).filter(Boolean);
    for (const itemName of itemNames) {
      orderItems.push({ name: itemName, qty: 0 });
    }
  } else {
    // Pull from reorder suggestions for this vendor
    const { data: reorderData } = await inventorySchema(ctx.supabase)
      .rpc('rpc_report_reorder_suggestions');

    if (reorderData?.length) {
      const vendorItems = (reorderData as any[]).filter(
        (r: any) => r.preferred_vendor?.toLowerCase().includes(vendor.name.toLowerCase())
      );
      orderItems = vendorItems.slice(0, 10).map((r: any) => ({
        name: r.item_name || r.sku,
        qty: Number(r.suggested_order_qty) || 0,
        unit: r.unit_of_measure,
      }));
    }
  }

  // 3. Generate the email using OpenAI
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      text: 'Email drafting is not available — OPENAI_API_KEY not configured.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'No API key' },
    };
  }

  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey });

    const itemList = orderItems.length > 0
      ? orderItems.map((i) => `- ${i.name}${i.qty ? `: ${i.qty} ${i.unit || 'units'}` : ''}`).join('\n')
      : '(No specific items — general inquiry)';

    const vendorInfo = [
      `Company: ${vendor.name}`,
      vendor.contact_name && `Contact: ${vendor.contact_name}`,
      vendor.contact_email && `Email: ${vendor.contact_email}`,
      vendor.payment_terms && `Terms: ${vendor.payment_terms}`,
    ].filter(Boolean).join('\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: [
            'You are a professional procurement assistant for a construction company.',
            'Draft a purchase request/RFQ email. Be concise and professional.',
            'Return ONLY a valid JSON object with:',
            '  subject — email subject line',
            '  body    — complete email body (include greeting, items, request for pricing/availability, closing)',
            'Do NOT wrap in markdown code fences.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Draft a purchase request for:\n\nVendor:\n${vendorInfo}\n\nItems:\n${itemList}${params.notes ? `\n\nAdditional notes: ${params.notes}` : ''}`,
        },
      ],
      temperature: 0.4,
      max_tokens: 800,
    });

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      return {
        text: 'Failed to generate email draft.',
        dataDisplay: { displayType: 'metric', label: 'Error', value: 'Draft failed' },
      };
    }

    let jsonStr = content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const parsed = JSON.parse(jsonStr);

    const emailTo = vendor.contact_email || '(no email on file)';
    const draftText = [
      `**To:** ${emailTo}`,
      `**Subject:** ${parsed.subject || 'Purchase Request'}`,
      '',
      parsed.body || 'Email body could not be generated.',
    ].join('\n');

    return {
      text: `Draft purchase request for ${vendor.name}:\n\n${draftText}\n\n---\nThis is a draft — copy and send when ready. Email is NOT sent automatically.`,
      dataDisplay: {
        displayType: 'metric',
        label: 'Draft Ready',
        value: vendor.name,
        secondaryMetrics: [
          { label: 'To', value: emailTo },
          { label: 'Items', value: orderItems.length > 0 ? String(orderItems.length) : 'General inquiry' },
        ],
      },
    };
  } catch {
    return {
      text: 'Failed to generate email draft. Try again.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Draft failed' },
    };
  }
}

// ─── Extract Document ───────────────────────────────────────────────

async function extractDocument(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const docType = typeof params.document_type === 'string' ? params.document_type : 'auto';

  // This tool relies on the image being in the OpenAI conversation context.
  // The chat route passes images via multimodal content. This tool returns
  // instructions + context (existing vendors/items) for the AI to use when
  // extracting data from the image in the next conversation turn.
  // No direct OpenAI call needed here — the chat loop handles it.
  // The tool returns instructions for the AI to extract data from the image
  // that's already in the multimodal conversation context.
  // The AI model in the chat loop will see the image and this tool result,
  // then generate a structured extraction.

  // Load existing vendors and items for fuzzy matching
  const { data: vendors } = await supplyChainSchema(ctx.supabase)
    .from('vendors')
    .select('id, name')
    .limit(200);

  const { data: items } = await inventorySchema(ctx.supabase)
    .from('catalog_items')
    .select('id, name, sku')
    .limit(500);

  const vendorNames = (vendors || []).map((v: any) => v.name).join(', ');
  const itemNames = (items || []).map((i: any) => `${i.name} (${i.sku})`).slice(0, 50).join(', ');

  return {
    text: [
      `DOCUMENT EXTRACTION MODE — Analyze the image in this conversation as a ${docType !== 'auto' ? docType : 'document (auto-detect type)'}.`,
      '',
      'Extract and return the following in your response:',
      '1. Document type (invoice, receipt, packing slip, quote, SDS)',
      '2. Vendor/company name — try to match to existing vendors: ' + (vendorNames || 'none on file'),
      '3. Document number/reference',
      '4. Date',
      '5. Line items as a table with columns: Item, Qty, Unit Price, Total',
      '6. For each line item, note if it matches an existing catalog item: ' + (itemNames || 'none on file'),
      '7. Subtotal, tax, and total',
      '',
      'Present the extracted data clearly. After showing the extraction, offer to:',
      '- "Add these items to inventory" (smart_stock_receive for each line)',
      '- "Create a PO from this" (create_po)',
      '- "Add vendor" if the vendor is not in the system',
    ].join('\n'),
    dataDisplay: {
      displayType: 'metric',
      label: 'Document Extraction',
      value: docType !== 'auto' ? docType : 'Auto-detect',
      secondaryMetrics: [
        { label: 'Known Vendors', value: (vendors || []).length },
        { label: 'Known Items', value: (items || []).length },
      ],
    },
  };
}

// ─── List Pending Apparel Orders ────────────────────────────────────

async function listPendingApparelOrders(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const status = typeof params.status === 'string' ? params.status : 'pending_approval';

  const { data: orders, error } = await inventorySchema(ctx.supabase)
    .from('apparel_orders')
    .select('id, status, trigger_event, items, total_estimated_cost, notes, created_at')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    return {
      text: `Failed to query apparel orders: ${error.message}`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' },
    };
  }

  if (!orders?.length) {
    return {
      text: `No apparel orders with status "${status}".`,
      dataDisplay: { displayType: 'metric', label: 'Apparel Orders', value: '0' },
    };
  }

  const rows = orders.map((o: any) => {
    const items = (o.items || []) as any[];
    const sizes = items.map((i: any) => `${i.size}×${i.quantity}`).join(', ');
    return {
      id: o.id.slice(0, 8),
      full_id: o.id,
      status: o.status,
      sizes,
      est_cost: o.total_estimated_cost ? formatCurrency(o.total_estimated_cost) : 'TBD',
      trigger: o.trigger_event || 'manual',
      created: new Date(o.created_at).toLocaleDateString(),
    };
  });

  return {
    text: `Found ${rows.length} apparel order${rows.length === 1 ? '' : 's'} with status "${status}". ${rows.map((r: any) => `${r.id}: ${r.sizes} (${r.est_cost})`).join('; ')}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'id', label: 'Order' },
        { key: 'sizes', label: 'Sizes & Qty' },
        { key: 'est_cost', label: 'Est. Cost' },
        { key: 'trigger', label: 'Trigger' },
        { key: 'created', label: 'Created' },
        { key: 'status', label: 'Status' },
      ],
      rows,
      totalRows: rows.length,
    },
  };
}

// ─── Approve Apparel Order ──────────────────────────────────────────

async function approveApparelOrder(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const orderId = typeof params.order_id === 'string' ? params.order_id.trim() : '';
  if (!orderId) {
    return {
      text: 'Please specify the order ID to approve.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing order_id' },
    };
  }

  // Resolve short IDs by prefix match
  let resolvedId = orderId;
  if (orderId.length < 36) {
    const { data: matches } = await inventorySchema(ctx.supabase)
      .from('apparel_orders')
      .select('id')
      .eq('status', 'pending_approval')
      .limit(20);
    const match = (matches || []).find((m: any) => m.id.startsWith(orderId));
    if (match) resolvedId = match.id;
  }

  // Mark as approved
  const { data: order, error: approveErr } = await inventorySchema(ctx.supabase)
    .from('apparel_orders')
    .update({
      status: 'approved',
      approved_by: ctx.userId,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', resolvedId)
    .eq('status', 'pending_approval')
    .select()
    .single();

  if (approveErr || !order) {
    return {
      text: `Could not approve order "${orderId}". It may not exist or is not pending approval.`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Approve failed' },
    };
  }

  // Place the Printful order via the internal route
  try {
    const idempotencyKey = `apparel-approve-${resolvedId}-${Date.now()}`;
    const res = await fetch(`${ctx.baseUrl}/api/integrations/printful/order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': ctx.cookieHeader,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ apparel_order_id: resolvedId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      return {
        text: `Order approved but Printful placement failed: ${err.error || res.statusText}. The order is marked approved — retry later.`,
        dataDisplay: { displayType: 'metric', label: 'Partially Approved', value: resolvedId.slice(0, 8) },
      };
    }

    const result = await res.json();
    const d = result.data;

    const items = (order.items || []) as any[];
    const sizes = items.map((i: any) => `${i.size}×${i.quantity}`).join(', ');

    return {
      text: `Order approved and placed with Printful! Printful order #${d.printful_order_id}, status: ${d.printful_status}. Sizes: ${sizes}. Estimated cost: ${d.estimated_cost || 'TBD'}. I'll update you when it ships.`,
      dataDisplay: {
        displayType: 'metric',
        label: 'Order Placed',
        value: `Printful #${d.printful_order_id}`,
        secondaryMetrics: [
          { label: 'Sizes', value: sizes },
          { label: 'Est. Cost', value: d.estimated_cost || 'TBD' },
          { label: 'Status', value: d.printful_status },
        ],
      },
    };
  } catch (err: any) {
    return {
      text: `Order approved but Printful placement failed: ${err.message}. The order is marked approved — retry later.`,
      dataDisplay: { displayType: 'metric', label: 'Partially Approved', value: resolvedId.slice(0, 8) },
    };
  }
}

// ─── Reject Apparel Order ───────────────────────────────────────────

async function rejectApparelOrder(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const orderId = typeof params.order_id === 'string' ? params.order_id.trim() : '';
  if (!orderId) {
    return {
      text: 'Please specify the order ID to reject.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing order_id' },
    };
  }

  const reason = typeof params.reason === 'string' ? params.reason.trim() : '';

  // Resolve short IDs
  let resolvedId = orderId;
  if (orderId.length < 36) {
    const { data: matches } = await inventorySchema(ctx.supabase)
      .from('apparel_orders')
      .select('id')
      .eq('status', 'pending_approval')
      .limit(20);
    const match = (matches || []).find((m: any) => m.id.startsWith(orderId));
    if (match) resolvedId = match.id;
  }

  const { data: order, error } = await inventorySchema(ctx.supabase)
    .from('apparel_orders')
    .update({
      status: 'rejected',
      rejected_by: ctx.userId,
      rejected_at: new Date().toISOString(),
      rejection_reason: reason || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', resolvedId)
    .eq('status', 'pending_approval')
    .select()
    .single();

  if (error || !order) {
    return {
      text: `Could not reject order "${orderId}". It may not exist or is not pending approval.`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Reject failed' },
    };
  }

  return {
    text: `Apparel order ${resolvedId.slice(0, 8)} rejected${reason ? `: "${reason}"` : ''}.`,
    dataDisplay: {
      displayType: 'metric',
      label: 'Order Rejected',
      value: resolvedId.slice(0, 8),
      secondaryMetrics: reason ? [{ label: 'Reason', value: reason }] : [],
    },
  };
}

// ─── Semantic Search ──────────────────────────────────────────────────

async function semanticSearchItems(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const query = typeof params.query === 'string' ? params.query.trim() : '';
  if (!query) {
    return {
      text: 'Please provide a search query.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'No query provided' },
    };
  }

  const limit = typeof params.limit === 'number' ? Math.min(params.limit, 50) : 10;

  // Dynamically import to avoid top-level side effects
  const { generateEmbedding } = await import('./embeddings');

  const embedding = await generateEmbedding(query);
  if (!embedding.length) {
    return {
      text: 'Failed to generate search embedding. Please try again.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Embedding generation failed' },
    };
  }

  // Call the RPC for vector similarity search
  const { data, error } = await inventorySchema(ctx.supabase)
    .rpc('rpc_semantic_search_items', {
      query_embedding: JSON.stringify(embedding),
      match_tenant_id: ctx.tenantId,
      match_count: limit,
    });

  if (error || !data) {
    return {
      text: `Semantic search failed: ${error?.message || 'No results'}`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Search failed' },
    };
  }

  const rows = data as any[];
  if (rows.length === 0) {
    return {
      text: `No items found matching "${query}". Items may not have embeddings generated yet.`,
      dataDisplay: { displayType: 'metric', label: 'Semantic Search', value: '0 results' },
    };
  }

  const formattedRows = rows.map((r: any) => ({
    ...r,
    similarity: `${(Number(r.similarity) * 100).toFixed(1)}%`,
  }));

  return {
    text: `Found ${rows.length} item(s) matching "${query}": ${rows.slice(0, 5).map((r: any) => `${r.name} (${(Number(r.similarity) * 100).toFixed(1)}%)`).join(', ')}${rows.length > 5 ? '...' : ''}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'name', label: 'Item' },
        { key: 'sku', label: 'SKU' },
        { key: 'category_name', label: 'Category' },
        { key: 'similarity', label: 'Match' },
      ],
      rows: formattedRows,
      totalRows: rows.length,
    },
  };
}

// ─── Purchasing Assistant (composite workflow) ─────────────────────────

async function purchasingAssistant(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const inv = inventorySchema(ctx.supabase);
  const sc = supplyChainSchema(ctx.supabase);

  // Step 1: Get reorder suggestions (items below reorder point)
  const { data: reorderItems } = await inv.rpc('rpc_reorder_suggestions').limit(50);
  const shortages = reorderItems || [];

  if (shortages.length === 0) {
    return {
      text: 'No items currently need reordering. All stock levels are above their reorder points.',
      dataDisplay: { displayType: 'metric', label: 'Reorder Status', value: 'All stocked' },
    };
  }

  // Step 2: Get preferred vendors for short items
  const { data: vendors } = await sc
    .from('vendors')
    .select('id, name, code, is_preferred')
    .eq('status', 'active')
    .limit(100);

  const vendorMap = new Map<string, string>();
  for (const v of (vendors || [])) {
    vendorMap.set(v.id, v.name);
  }

  // Step 3: Group shortages by vendor for PO drafting
  const poGroups: Record<string, Array<{ item_name: string; sku: string; qty_needed: number; current_qty: number; reorder_point: number }>> = {};
  const unassigned: Array<{ item_name: string; sku: string; qty_needed: number }> = [];

  for (const item of shortages) {
    const vendorId = item.preferred_vendor_id;
    const entry = {
      item_name: item.item_name || item.name || 'Unknown',
      sku: item.sku || '',
      qty_needed: Math.max(1, (item.reorder_qty || item.reorder_point || 10) - (item.current_qty || 0)),
      current_qty: item.current_qty || 0,
      reorder_point: item.reorder_point || 0,
    };

    if (vendorId && vendorMap.has(vendorId)) {
      const vendorName = vendorMap.get(vendorId)!;
      if (!poGroups[vendorName]) poGroups[vendorName] = [];
      poGroups[vendorName].push(entry);
    } else {
      unassigned.push(entry);
    }
  }

  // Build summary text
  const lines: string[] = [
    `Found ${shortages.length} item(s) below reorder point.\n`,
  ];

  const rows: Record<string, any>[] = [];

  for (const [vendorName, items] of Object.entries(poGroups)) {
    lines.push(`**${vendorName}** — ${items.length} item(s):`);
    for (const it of items) {
      lines.push(`  • ${it.item_name} (${it.sku}): need ${it.qty_needed} units (current: ${it.current_qty})`);
      rows.push({ vendor: vendorName, item: it.item_name, sku: it.sku, qty_needed: it.qty_needed, current_qty: it.current_qty });
    }
  }

  if (unassigned.length > 0) {
    lines.push(`\n**No preferred vendor** — ${unassigned.length} item(s):`);
    for (const it of unassigned) {
      lines.push(`  • ${it.item_name} (${it.sku}): need ${it.qty_needed} units`);
      rows.push({ vendor: '(none)', item: it.item_name, sku: it.sku, qty_needed: it.qty_needed, current_qty: 0 });
    }
  }

  lines.push(`\nI can draft purchase orders for the vendor-assigned items. Would you like me to proceed?`);

  return {
    text: lines.join('\n'),
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'vendor', label: 'Vendor' },
        { key: 'item', label: 'Item' },
        { key: 'sku', label: 'SKU' },
        { key: 'qty_needed', label: 'Qty Needed' },
        { key: 'current_qty', label: 'Current Qty' },
      ],
      rows,
      totalRows: rows.length,
    },
  };
}

