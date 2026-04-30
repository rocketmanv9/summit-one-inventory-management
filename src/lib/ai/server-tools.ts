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
  'workflow_auto_reorder',
  'workflow_stock_rebalance',
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
    case 'workflow_auto_reorder':
      return workflowAutoReorder(params, ctx);
    case 'workflow_stock_rebalance':
      return workflowStockRebalance(params, ctx);
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
    const res = await fetch(`${ctx.baseUrl}/api/ai/create-dashboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': ctx.cookieHeader,
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
