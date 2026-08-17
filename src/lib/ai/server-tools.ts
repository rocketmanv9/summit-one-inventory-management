/**
 * Server-Side Tool Executor
 *
 * Executes query_*, write-verb, and workflow_* tools on the server
 * using the authenticated Supabase client from the session.
 * Returns { text, dataDisplay } for the chat route to feed back to OpenAI
 * and ultimately to the client.
 */

import { AppError } from '@rocketmanv9/chassis/errors';
import type { AiDataDisplay } from './types';
import { resolveEntity } from './ontology/entity-resolver';
import { findSubstitutes as findSubstitutesQuery, findAllRelationships } from './ontology/relationship-query';
import { getTenantGVClient } from '@/lib/gv';
import { getCatalogClient, adoptCatalogVendorsIntoSupplyChain } from '@/lib/vendors';
import {
  recommendVendorForItem,
  type TenantVendorOption,
  type CatalogVendorOption,
} from './recommend-vendor';
import { buildDraftPoPreview } from './draft-po-preview';

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
  /** Execution duration in milliseconds */
  durationMs?: number;
}

// ─── Registry ─────────────────────────────────────────────────────────

const SERVER_TOOLS = new Set([
  'query_inventory_summary',
  'query_stock_valuation',
  'query_low_stock_report',
  'query_dead_stock',
  'query_velocity_analysis',
  'query_movement_summary',
  'query_usage_trends',
  'query_reorder_suggestions',
  'query_forecast',
  'query_inventory_turnover',
  'query_po_status',
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
  'create_item_with_variants',
  'resolve_entity',
  'query_relationships',
  'find_substitutes',
  'query_cycle_counts',
  'query_cancelled_transfers',
  'query_stock_movements',
  'query_stock_by_location',
  'query_integrations',
  'list_catalog_vendors',
  'recommend_vendor_for_item',
  'draft_po_preview',
  'adopt_catalog_vendor',
  'find_vendors_online',
  'adjust_stock',
  'adjust_stock_delta',
  'issue_inventory',
  'create_transfer',
  'create_reservation',
  'create_po',
  'draft_restock_order',
  'confirm_restock_order',
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
  const toolStart = Date.now();
  try {
    // Universal Settings kill-switch: if this tool's capability is turned off,
    // refuse before doing anything. (ask/auto gating happens per-tool.)
    const cap = TOOL_CAPABILITY[toolName];
    if (cap && (await getAgentPermission(ctx, cap)) === 'off') {
      const denied = permissionDeniedResult(cap);
      denied.durationMs = Date.now() - toolStart;
      return denied;
    }

    const result = await executeServerToolInner(toolName, params, ctx);
    result.durationMs = Date.now() - toolStart;
    return result;
  } catch (err: any) {
    // Surface failures honestly. Without this, a thrown DB/permission error
    // could otherwise be reported by the model as a confident (but empty)
    // answer — "she lies politely". Tell the user something went wrong instead.
    const message = err?.message || 'Unknown error';
    console.error(`[server-tools] ${toolName} failed:`, message);
    return {
      text: `I ran into a problem running ${toolName}: ${message}. The data may be unavailable right now — please try again, and let an admin know if it keeps happening.`,
      dataDisplay: { displayType: 'metric', label: 'Tool Error', value: toolName },
      durationMs: Date.now() - toolStart,
    };
  }
}

/**
 * Unwrap a Supabase query result on a PRIMARY data fetch: if Postgres returned
 * an error, throw so the executor surfaces an honest failure rather than
 * letting the tool report empty data as a confident answer. Do NOT use for
 * secondary "does this already exist?" lookups, where empty is a valid result.
 */
export function unwrap<T>(result: { data: T; error: any }, label: string): T {
  if (result.error) {
    throw AppError.internal(`${label}: ${result.error.message || String(result.error)}`);
  }
  return result.data;
}

async function executeServerToolInner(
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
    case 'query_usage_trends':
      return queryUsageTrends(params, ctx);
    case 'query_reorder_suggestions':
      return queryReorderSuggestions(ctx);
    case 'query_forecast':
      return queryForecast(ctx);
    case 'query_inventory_turnover':
      return queryInventoryTurnover(ctx);
    case 'query_po_status':
      return queryPoStatus(ctx);
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
    case 'create_item_with_variants':
      return createItemWithVariants(params, ctx);
    case 'resolve_entity':
      return resolveEntityTool(params, ctx);
    case 'query_relationships':
      return queryRelationshipsTool(params, ctx);
    case 'find_substitutes':
      return findSubstitutesTool(params, ctx);
    case 'query_cycle_counts':
      return queryCycleCounts(params, ctx);
    case 'query_cancelled_transfers':
      return queryCancelledTransfers(params, ctx);
    case 'query_stock_movements':
      return queryStockMovements(params, ctx);
    case 'query_stock_by_location':
      return queryStockByLocation(params, ctx);
    case 'query_integrations':
      return queryIntegrations(ctx);
    case 'list_catalog_vendors':
      return listCatalogVendors(params, ctx);
    case 'recommend_vendor_for_item':
      return recommendVendorForItemTool(params, ctx);
    case 'draft_po_preview':
      return draftPoPreviewTool(params, ctx);
    case 'adopt_catalog_vendor':
      return adoptCatalogVendorTool(params, ctx);
    case 'find_vendors_online':
      return findVendorsOnlineTool(params, ctx);
    case 'adjust_stock':
    case 'adjust_stock_delta':
    case 'issue_inventory':
    case 'create_transfer':
    case 'create_reservation':
    case 'create_po':
      return executeInventoryAction(toolName, params, ctx);
    case 'draft_restock_order':
      return (await import('./restock')).draftRestockOrder(params, ctx);
    case 'confirm_restock_order':
      return (await import('./restock')).confirmRestockOrder(params, ctx);
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

/**
 * Best-effort display name for an item the user asked to buy but that isn't in
 * the catalog. Strips a leading quantity ("10 wheelstops" → "wheelstops") and
 * common lead-ins so the grace card shows the real thing, not the raw phrase.
 * Only used for display + the add-and-continue message — item creation still
 * runs through the normal add_item / item-suggest path.
 */
function cleanItemName(raw: string): string {
  let s = (raw || '').trim();
  // Drop a leading count ("10 ", "5x ", "a dozen " is left alone — just digits).
  s = s.replace(/^\d+\s*(x\s*)?/i, '');
  // Drop common lead-ins.
  s = s.replace(/^(some|a|an|the|more|new)\s+/i, '');
  s = s.trim();
  return s || raw.trim();
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

async function queryUsageTrends(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const months = Math.min(Math.max(Number(params.months) || 13, 3), 36);
  const { data, error } = await inventorySchema(ctx.supabase)
    .rpc('rpc_report_monthly_usage', { p_tenant_id: ctx.tenantId, p_months: months });

  if (error || !data) {
    return {
      text: 'Failed to fetch usage trends.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' },
    };
  }

  let rows = data as any[];

  // Optional fuzzy item focus.
  const itemFilter = (params.item || '').trim().toLowerCase();
  if (itemFilter) {
    rows = rows.filter(
      (r: any) =>
        String(r.name || '').toLowerCase().includes(itemFilter) ||
        String(r.sku || '').toLowerCase().includes(itemFilter)
    );
  }

  // Aggregate usage by month across the (optionally filtered) items.
  const monthMap = new Map<string, number>();
  const itemTotals = new Map<string, { name: string; total: number }>();
  for (const r of rows) {
    const mo = String(r.month);
    const usage = Number(r.usage_qty) || 0;
    monthMap.set(mo, (monthMap.get(mo) || 0) + usage);
    const it = itemTotals.get(r.catalog_item_id) || { name: r.name, total: 0 };
    it.total += usage;
    itemTotals.set(r.catalog_item_id, it);
  }

  const monthsSorted = Array.from(monthMap.keys()).sort();
  const labels = monthsSorted.map((m) => {
    const [y, mm] = m.split('-');
    return new Date(Number(y), Number(mm) - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' });
  });
  const series = monthsSorted.map((m) => monthMap.get(m) || 0);

  // Peak month + busiest items for the natural-language summary.
  let peakIdx = -1;
  for (let i = 0; i < series.length; i++) if (peakIdx < 0 || series[i] > series[peakIdx]) peakIdx = i;
  const peakLabel = peakIdx >= 0 ? labels[peakIdx] : 'n/a';
  const peakVal = peakIdx >= 0 ? series[peakIdx] : 0;
  const totalUsage = series.reduce((s, v) => s + v, 0);
  const topItems = Array.from(itemTotals.values())
    .filter((i) => i.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const scope = itemFilter ? `for "${params.item}"` : 'across consumable items';
  const summary =
    totalUsage > 0
      ? `Usage trends ${scope} over the last ${months} months: ${formatNumber(totalUsage)} units total. Peak month was ${peakLabel} (${formatNumber(peakVal)} units). Heaviest items: ${topItems.map((i) => `${i.name} (${formatNumber(i.total)})`).join(', ')}.`
      : `No consumption recorded ${scope} in the last ${months} months — items haven't been issued or consumed yet, so there's no seasonal pattern to report.`;

  return {
    text: summary,
    dataDisplay: {
      displayType: 'chart',
      chartType: 'bar',
      labels,
      datasets: [{ label: 'Units used', data: series, color: '#6366f1' }],
    },
  };
}

// ─── Agent permissions (Settings: what Isabelle is allowed to do) ──────
// Maps each tool to a capability the user controls in Settings, each set to
// off | ask | auto. See migration 20260615000003_agent_permissions.
type PermLevel = 'off' | 'ask' | 'auto';

export const TOOL_CAPABILITY: Record<string, string> = {
  adjust_stock: 'stock_adjust',
  adjust_stock_delta: 'stock_adjust',
  issue_inventory: 'stock_issue',
  create_transfer: 'transfer',
  create_reservation: 'reserve',
  release_reservation: 'reserve',
  add_vendor: 'create_records',
  // Adopting a catalog vendor writes a tenant vendor row — gate like other creators.
  adopt_catalog_vendor: 'create_records',
  add_item: 'create_records',
  add_location: 'create_records',
  add_category: 'create_records',
  create_asset: 'create_records',
  // Server-side creators that actually perform the creation.
  smart_add_location: 'create_records',
  smart_register_asset: 'create_records',
  create_item_with_variants: 'create_records',
  create_po: 'purchase_orders',
  // The draft tool orders nothing (review-only), so only confirm is gated.
  confirm_restock_order: 'purchase_orders',
};

const CAPABILITY_LABEL: Record<string, string> = {
  stock_adjust: 'stock adjustments',
  stock_issue: 'issuing stock',
  transfer: 'stock transfers',
  reserve: 'reservations',
  create_records: 'creating records',
  purchase_orders: 'purchase orders',
};

async function getAgentPermission(ctx: ServerToolContext, capability: string): Promise<PermLevel> {
  try {
    const { data } = await (ctx.supabase as any)
      .schema('supply_chain')
      .from('tenant_settings')
      .select('agent_permissions')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    const level = data?.agent_permissions?.[capability];
    if (level === 'off' || level === 'ask' || level === 'auto') return level;
  } catch {
    /* fall through to safe default */
  }
  return 'ask';
}

function permissionDeniedResult(capability: string): ServerToolResult {
  const label = CAPABILITY_LABEL[capability] || capability;
  return {
    text: `I'm not allowed to do that — ${label} is turned off for me in Settings → Assistant. An admin can enable it there.`,
    dataDisplay: { displayType: 'metric', label: 'Disabled in Settings', value: label },
  };
}

// ─── Inventory write actions (adjust / issue / transfer / reserve) ─────
// Gated by the tenant's agent_permissions: off → refuse, ask → preview &
// confirm, auto → run immediately. On execution we POST to /api/ai/execute-action,
// which runs the mutation under the user's session (proper tenant/actor auth +
// outbox events).
async function executeInventoryAction(
  action: string,
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const capability = TOOL_CAPABILITY[action] || 'stock_adjust';
  const level = await getAgentPermission(ctx, capability);
  if (level === 'off') return permissionDeniedResult(capability);
  const confirmed = level === 'auto' || params.confirm === true || params.confirm === 'true';

  const describe = (): string => {
    const d = Number(params.delta);
    switch (action) {
      case 'adjust_stock':
        return `set ${params.item || 'item'} at ${params.location || 'location'} to ${params.quantity}`;
      case 'adjust_stock_delta':
        return `${d >= 0 ? 'add' : 'remove'} ${Math.abs(d)} ${d >= 0 ? 'to' : 'from'} ${params.item || 'item'} at ${params.location || 'location'}`;
      case 'issue_inventory':
        return `issue ${params.quantity} of ${params.item || 'item'} from ${params.location || 'location'}${params.issued_to_ref ? ` to ${params.issued_to_ref}` : ''}`;
      case 'create_transfer':
        return `transfer ${params.quantity} of ${params.item || 'item'} from ${params.from_location || '?'} to ${params.to_location || '?'}`;
      case 'create_reservation':
        return `reserve ${params.quantity} of ${params.item || 'item'} at ${params.location || 'location'}${params.job_ref ? ` for ${params.job_ref}` : ''}`;
      case 'create_po': {
        const items = Array.isArray(params.items) ? params.items : [];
        const lineSummary = items.length
          ? `: ${items.slice(0, 4).map((l: any) => `${l.quantity} ${l.item}`).join(', ')}${items.length > 4 ? '…' : ''}`
          : ' (empty draft)';
        return `create a draft PO for ${params.vendor || 'vendor'}${lineSummary}`;
      }
      default:
        return action;
    }
  };

  if (!confirmed) {
    return {
      text: `Ready to ${describe()}. Confirm and I'll do it.`,
      dataDisplay: { displayType: 'metric', label: 'Confirm action', value: describe() },
    };
  }

  try {
    const res = await fetch(`${ctx.baseUrl}/api/ai/execute-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': ctx.cookieHeader,
        'Idempotency-Key': `ai-action-${action}-${ctx.tenantId}-${Date.now()}`,
      },
      body: JSON.stringify({ action, ...params }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({} as any));
      const msg = err?.error?.message || err?.error || err?.message || res.statusText;
      return {
        text: `Couldn't ${describe()}: ${msg}`,
        dataDisplay: { displayType: 'metric', label: 'Action failed', value: String(msg) },
      };
    }

    const result = await res.json();
    const d = result.data || {};

    let text: string;
    const secondary: Array<{ label: string; value: any }> = [];
    switch (action) {
      case 'adjust_stock':
      case 'adjust_stock_delta':
        text = `Done — ${d.item} at ${d.location} is now ${d.new_qty} (was ${d.previous_qty}).`;
        secondary.push({ label: 'Item', value: d.item }, { label: 'Location', value: d.location });
        break;
      case 'issue_inventory':
        text = `Issued ${d.quantity} of ${d.item} from ${d.location}${d.issued_to ? ` to ${d.issued_to}` : ''}.`;
        secondary.push({ label: 'Item', value: d.item }, { label: 'From', value: d.location });
        break;
      case 'create_transfer':
        text = `Transfer created — ${d.quantity} of ${d.item} from ${d.from} to ${d.to}.`;
        secondary.push({ label: 'From', value: d.from }, { label: 'To', value: d.to });
        break;
      case 'create_reservation':
        text = `Reserved ${d.quantity} of ${d.item} at ${d.location}${d.job_ref ? ` for ${d.job_ref}` : ''}.`;
        secondary.push({ label: 'Item', value: d.item }, { label: 'Location', value: d.location });
        break;
      case 'create_po':
        text = `Draft PO ${d.po_number || ''} created for ${d.vendor}${d.line_count ? ` with ${d.line_count} line(s)` : ''}. Review it in Purchasing.`;
        secondary.push({ label: 'Vendor', value: d.vendor }, { label: 'Lines', value: d.line_count ?? 0 });
        break;
      default:
        text = 'Action completed.';
    }

    return {
      text,
      dataDisplay: { displayType: 'metric', label: 'Done', value: text, secondaryMetrics: secondary },
    };
  } catch (err: any) {
    return {
      text: `Couldn't ${describe()}: ${err.message}`,
      dataDisplay: { displayType: 'metric', label: 'Action failed', value: err.message },
    };
  }
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
    .select('id, po_number, vendor_name_snapshot, status, expected_delivery_date, created_at')
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
  for (const r of rows) {
    const s = r.status || 'unknown';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }

  const statusSummary = Object.entries(statusCounts)
    .map(([s, c]) => `${c} ${s}`)
    .join(', ');

  const displayRows = rows.slice(0, 20).map((r: any) => ({
    po_number: r.po_number,
    vendor: r.vendor_name_snapshot || '—',
    status: r.status,
    expected_delivery_date: r.expected_delivery_date || '—',
  }));

  return {
    text: `PO Status: ${rows.length} purchase orders. Breakdown: ${statusSummary}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'po_number', label: 'PO #' },
        { key: 'vendor', label: 'Vendor' },
        { key: 'status', label: 'Status' },
        { key: 'expected_delivery_date', label: 'Expected Delivery' },
      ],
      rows: displayRows,
      totalRows: rows.length,
    },
  };
}

// ─── Workflow: Auto-Reorder (Printify) ──────────────────────────────

async function workflowAutoReorder(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const dryRun = params.dry_run !== false && params.dry_run !== 'false';

  try {
    // 1. Get reorder suggestions from RPC
    const { data: suggestions, error: rpcError } = await inventorySchema(ctx.supabase)
      .rpc('rpc_report_reorder_suggestions');

    if (rpcError || !suggestions?.length) {
      return {
        text: rpcError
          ? `Failed to fetch reorder suggestions: ${rpcError.message}`
          : 'No items are below their reorder point. Stock levels look good.',
        dataDisplay: { displayType: 'metric', label: 'Reorder Check', value: rpcError ? 'Error' : 'All stocked' },
      };
    }

    // 2. Check which items have Printify mappings
    const adminClient = (await import('@/utils/supabase/admin')).getAdminClient();
    const prov = (adminClient as any).schema('provisioning');

    // Find active Printify provider for this tenant
    const { data: provider } = await prov
      .from('providers')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .eq('provider_type', 'print_on_demand')
      .like('provider_key', 'printify%')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!provider) {
      return {
        text: `Found ${suggestions.length} items below reorder point, but Printify is not connected. Connect it in Settings > Integrations.`,
        dataDisplay: {
          displayType: 'table',
          columns: [
            { key: 'item_name', label: 'Item' },
            { key: 'qty_on_hand', label: 'On Hand' },
            { key: 'reorder_point', label: 'Reorder Pt' },
            { key: 'suggested_order_qty', label: 'Suggested Qty' },
          ],
          rows: suggestions.slice(0, 20),
          totalRows: suggestions.length,
        },
      };
    }

    // Get mappings for these items
    const catalogItemIds = suggestions.map((s: any) => s.catalog_item_id).filter(Boolean);
    const { data: mappings } = await prov
      .from('provider_item_mappings')
      .select('catalog_item_id, external_product_id, external_variant_id')
      .eq('provider_id', provider.id)
      .in('catalog_item_id', catalogItemIds)
      .limit(200);

    const mappingMap = new Map<string, { catalog_item_id: string; external_product_id: string; external_variant_id: string }>(
      (mappings || []).map((m: any) => [m.catalog_item_id, m])
    );

    const mappedItems = suggestions.filter((s: any) => mappingMap.has(s.catalog_item_id));
    const unmappedItems = suggestions.filter((s: any) => !mappingMap.has(s.catalog_item_id));

    if (mappedItems.length === 0) {
      return {
        text: `Found ${suggestions.length} items below reorder point, but none have Printify product mappings. Add mappings in Settings > Integrations.`,
        dataDisplay: {
          displayType: 'table',
          columns: [
            { key: 'item_name', label: 'Item' },
            { key: 'qty_on_hand', label: 'On Hand' },
            { key: 'reorder_point', label: 'Reorder Pt' },
            { key: 'suggested_order_qty', label: 'Suggested Qty' },
          ],
          rows: suggestions.slice(0, 20),
          totalRows: suggestions.length,
        },
      };
    }

    // 3. Dry run — show what would be ordered
    const orderPreview = mappedItems.map((s: any) => ({
      item_name: s.item_name || s.sku,
      qty_on_hand: s.qty_on_hand,
      reorder_qty: Number(s.suggested_order_qty) || Number(s.reorder_qty) || 1,
      printify_product: mappingMap.get(s.catalog_item_id)?.external_product_id,
    }));

    if (dryRun) {
      const totalQty = orderPreview.reduce((sum: number, i: any) => sum + i.reorder_qty, 0);
      const unmappedNote = unmappedItems.length > 0
        ? ` (${unmappedItems.length} additional items need Printify mappings)`
        : '';
      return {
        text: `Auto-Reorder Preview: ${mappedItems.length} items would be ordered from Printify (${totalQty} total units).${unmappedNote} Say "confirm" or "go ahead" to place the order.`,
        dataDisplay: {
          displayType: 'table',
          columns: [
            { key: 'item_name', label: 'Item' },
            { key: 'qty_on_hand', label: 'On Hand' },
            { key: 'reorder_qty', label: 'Order Qty' },
            { key: 'printify_product', label: 'Printify Product' },
          ],
          rows: orderPreview,
          totalRows: orderPreview.length,
        },
      };
    }

    // 4. Place the order via the Printify orders API
    const idempotencyKey = `ai-auto-reorder-${ctx.tenantId}-${Date.now()}`;
    const orderItems = mappedItems.map((s: any) => ({
      catalog_item_id: s.catalog_item_id,
      qty: Number(s.suggested_order_qty) || Number(s.reorder_qty) || 1,
    }));

    const res = await fetch(`${ctx.baseUrl}/api/settings/integrations/printify/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': ctx.cookieHeader,
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        items: orderItems,
        shipping_address: params.shipping_address || {
          first_name: 'Inventory',
          last_name: 'Reorder',
          country: 'US',
          region: 'CA',
          address1: 'TBD',
          city: 'TBD',
          zip: '00000',
        },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: 'Unknown error' } }));
      return {
        text: `Printify order failed: ${err?.error?.message || res.statusText}. The ${mappedItems.length} items are still below reorder point.`,
        dataDisplay: { displayType: 'metric', label: 'Order Failed', value: err?.error?.message || 'Error' },
      };
    }

    const result = await res.json();
    const totalQty = orderItems.reduce((sum: number, i: any) => sum + i.qty, 0);

    return {
      text: `Printify order placed successfully. Ordered ${orderItems.length} items (${totalQty} units). Printify order ID: ${result.data?.printify_order_id || 'pending'}.`,
      dataDisplay: {
        displayType: 'table',
        columns: [
          { key: 'item_name', label: 'Item' },
          { key: 'reorder_qty', label: 'Ordered Qty' },
          { key: 'printify_product', label: 'Printify Product' },
        ],
        rows: orderPreview,
        totalRows: orderPreview.length,
      },
    };
  } catch (err: any) {
    return {
      text: `Auto-reorder failed: ${err.message}`,
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
        uom_term_id: params.uom_term_id,
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
        unit: d.uom_label || 'units',
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

  const { data: locationTypes } = await inventorySchema(ctx.supabase)
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

  // If no hint but name contains clues, try to infer type (also serves as fallback default)
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

  // Default to first available location type if none matched (location_type_id is NOT NULL)
  if (!locationTypeId && locationTypes?.length) {
    const yardType = locationTypes.find((lt: any) => lt.name.toLowerCase().includes('yard'));
    const fallback = yardType || locationTypes[0];
    locationTypeId = fallback.id;
    locationTypeName = fallback.name;
  }

  if (!locationTypeId) {
    return {
      text: 'Cannot create location — no location types are configured. Please add a location type first.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'No location types' },
    };
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
          // web_search_options requires the -search-preview models (plain
          // gpt-4o 400s on it, and search-preview rejects temperature).
          model: 'gpt-4o-search-preview',
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
    active: true,
  };
  if (locationTypeId) insertData.location_type_id = locationTypeId;
  if (validatedAddress) insertData.address = validatedAddress;

  // Check for existing location by name first (no unique constraint on tenant_id,name)
  const { data: existingLoc } = await inventorySchema(ctx.supabase)
    .from('locations')
    .select('id, name')
    .eq('tenant_id', ctx.tenantId)
    .ilike('name', name)
    .limit(1)
    .maybeSingle();

  if (existingLoc) {
    return {
      text: `A location named "${existingLoc.name}" already exists.`,
      dataDisplay: { displayType: 'metric', label: 'Already Exists', value: existingLoc.name },
    };
  }

  const { data: location, error } = await inventorySchema(ctx.supabase)
    .from('locations')
    .insert(insertData)
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
    .select('id, name, sku, tracking_mode')
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

    // If the existing item is fungible-only, suggest updating to serialized
    if (match.tracking_mode === 'fungible') {
      return {
        text: `Found existing item "${match.name}" but it's tracked as fungible (bulk quantity), not serialized (individual assets). Update its tracking mode to "serialized" or "both" first, then try again. Say "update item ${match.name} tracking mode to both".`,
        dataDisplay: { displayType: 'metric', label: 'Tracking Mode Conflict', value: `${match.name} is fungible` },
      };
    }
  }

  if (!catalogItemId) {
    // Create a new catalog item with serialized tracking
    const sku = `AST-${name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase()}-${Date.now().toString(36).slice(-4).toUpperCase()}`;

    // Resolve UOM term ID — assets default to "EA" (Each)
    let uomTermId: string | null = null;
    try {
      const gv = await getTenantGVClient(ctx.tenantId);
      uomTermId = await gv.resolveTermId(ctx.tenantId, 'uom', 'EA', true);
    } catch {
      // If GV resolution fails, try a direct code lookup
      try {
        const gv = await getTenantGVClient(ctx.tenantId);
        uomTermId = await gv.resolveTermId(ctx.tenantId, 'uom', 'Each', true);
      } catch {
        // Non-fatal — will be caught by DB constraint if still null
      }
    }

    const insertPayload: Record<string, any> = {
      name,
      sku,
      description: description || name,
      tracking_mode: 'serialized',
      tenant_id: ctx.tenantId,
    };
    if (uomTermId) insertPayload.uom_term_id = uomTermId;

    const { data: newItem, error: itemError } = await inventorySchema(ctx.supabase)
      .from('catalog_items')
      .upsert(insertPayload, { onConflict: 'tenant_id,sku' })
      .select('id, name')
      .single();

    if (itemError || !newItem) {
      const dbMsg = itemError?.message || 'Unknown error';
      const hint = itemError?.code === '23505'
        ? ` An item with that SKU already exists — try a different name or register the asset against the existing item.`
        : '';
      return {
        text: `Failed to create catalog item for "${name}": ${dbMsg}.${hint}`,
        dataDisplay: { displayType: 'metric', label: 'Error', value: dbMsg.slice(0, 60) },
      };
    }

    catalogItemId = newItem.id;
    catalogItemName = newItem.name;
    itemCreated = true;
  }

  // 2. Find location — required for assets
  let locationId: string | null = null;
  let locationName = '';

  // Fetch all locations for fallback suggestions
  const { data: allLocations } = await inventorySchema(ctx.supabase)
    .from('locations')
    .select('id, name')
    .eq('active', true)
    .limit(50);

  if (locationHint) {
    const locLower = locationHint.toLowerCase();
    const locations = (allLocations || []).filter((l: any) =>
      l.name.toLowerCase().includes(locLower) || locLower.includes(l.name.toLowerCase())
    );

    if (locations.length) {
      const match =
        locations.find((l: any) => l.name.toLowerCase() === locLower) ||
        locations.find((l: any) => l.name.toLowerCase().includes(locLower)) ||
        locations[0];

      locationId = match.id;
      locationName = match.name;
    }
  }

  // If no location found/provided, ask user to specify one
  if (!locationId) {
    const locNames = (allLocations || []).map((l: any) => l.name);
    if (locNames.length > 0) {
      return {
        text: `I need a location to register this asset. Available locations: ${locNames.join(', ')}. Which one?`,
        dataDisplay: { displayType: 'metric', label: 'Location Required', value: locNames.join(', ') },
      };
    }
    return {
      text: 'I need a location to register this asset, but no locations exist yet. Say "add location [name]" first, then try again.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'No locations available' },
    };
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

// ─── List Catalog Vendors ───────────────────────────────────────────

async function listCatalogVendors(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const industry = typeof params.industry === 'string' ? params.industry.trim() : '';
  const search = typeof params.search === 'string' ? params.search.trim() : '';

  try {
    const catalog = getCatalogClient();
    const catalogVendors = await catalog.list();

    if (!catalogVendors || catalogVendors.length === 0) {
      return {
        text: 'The global vendor catalog is empty. You can search for vendors online with "search vendors for [product]" or add one manually.',
        dataDisplay: { displayType: 'metric', label: 'Catalog Vendors', value: '0' },
      };
    }

    // Filter by industry tag if provided
    let filtered = catalogVendors;
    if (industry) {
      const industryLower = industry.toLowerCase();
      filtered = filtered.filter((v: any) => {
        const tags: string[] = v.industry_tags || v.tags || [];
        return tags.some((t: string) => t.toLowerCase().includes(industryLower));
      });
    }

    // Filter by search text if provided
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter((v: any) =>
        (v.name || '').toLowerCase().includes(searchLower) ||
        (v.description || '').toLowerCase().includes(searchLower)
      );
    }

    if (filtered.length === 0) {
      const filterDesc = [industry && `industry "${industry}"`, search && `search "${search}"`].filter(Boolean).join(' and ');
      return {
        text: `No catalog vendors found matching ${filterDesc}. Try broadening your search or use "search vendors online" to find new ones.`,
        dataDisplay: { displayType: 'metric', label: 'Catalog Vendors', value: '0' },
      };
    }

    // Cross-reference with tenant vendors to mark adoption status
    const { data: tenantVendors } = await supplyChainSchema(ctx.supabase)
      .from('vendors')
      .select('catalog_vendor_id')
      .not('catalog_vendor_id', 'is', null)
      .limit(500);

    const adoptedIds = new Set((tenantVendors || []).map((v: any) => v.catalog_vendor_id));

    const rows = filtered.slice(0, 20).map((v: any) => {
      const tags: string[] = v.industry_tags || v.tags || [];
      return {
        name: v.name || 'Unknown',
        description: (v.description || '').slice(0, 100),
        industry_tags: tags.join(', '),
        adopted: adoptedIds.has(v.id) ? 'Yes' : 'No',
      };
    });

    const adoptedCount = rows.filter((r) => r.adopted === 'Yes').length;
    const availableCount = rows.length - adoptedCount;

    return {
      text: `Found ${filtered.length} vendor${filtered.length === 1 ? '' : 's'} in the global catalog${industry ? ` for "${industry}"` : ''}${search ? ` matching "${search}"` : ''}. ${availableCount} available to adopt, ${adoptedCount} already in your account. Say "add [vendor name] from the catalog" to adopt one.`,
      dataDisplay: {
        displayType: 'table',
        columns: [
          { key: 'name', label: 'Vendor' },
          { key: 'description', label: 'Description' },
          { key: 'industry_tags', label: 'Industry' },
          { key: 'adopted', label: 'In Your Account' },
        ],
        rows,
        totalRows: filtered.length,
      },
    };
  } catch (err: any) {
    console.error('[list_catalog_vendors] Failed:', err?.message);
    return {
      text: `Failed to load the vendor catalog: ${err?.message || 'Unknown error'}. Try "list vendors" to see your current vendors instead.`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Catalog unavailable' },
    };
  }
}

// ─── Recommend Vendor For Item (sprint item 01) ─────────────────────
// Advisory: "who should I buy X from?". Delegates to the shared lib so this
// tool and GET /api/ai/recommend-vendor run identical logic. Read-only, no
// confirmation — it never creates a PO or adopts a vendor.
async function recommendVendorForItemTool(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const itemRef = typeof params.item_ref === 'string' ? params.item_ref.trim() : '';
  if (!itemRef) {
    return {
      text: 'Tell me what you need a vendor for (an item name like "wheelstops" or a catalog item id).',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing item_ref' },
    };
  }

  const result = await recommendVendorForItem(ctx.supabase, ctx.tenantId, {
    item_ref: itemRef,
    qty: typeof params.qty === 'number' ? params.qty : undefined,
    location_id: typeof params.location_id === 'string' ? params.location_id : undefined,
  });

  if (!result.resolved || !result.item) {
    // New item — do NOT dead-end. Render the inline grace card so the buyer can
    // add it and keep going in one tap (the card fires an add-and-continue
    // message; the playbook then runs add_item → recommend → draft_po_preview).
    // The NL text still tells Isabelle to offer the add, so the two agree.
    const itemName = cleanItemName(itemRef);
    return {
      text:
        `"${itemName}" isn't in your catalog yet. Want me to add it and keep going — ` +
        `I'll set it up, pick a vendor, and draft the PO.`,
      dataDisplay: {
        displayType: 'item_not_found',
        itemRef,
        itemName,
        qty: typeof params.qty === 'number' && params.qty > 0 ? params.qty : undefined,
      },
    };
  }

  if (result.tier === 'tenant') {
    const options = result.options as TenantVendorOption[];
    const rows = options.map((o) => ({
      vendor: o.vendor_name || '—',
      unit_cost: o.unit_cost != null ? formatCurrency(o.unit_cost) : '—',
      lead_time_days: o.lead_time_days != null ? `${o.lead_time_days}d` : '—',
      min_order_qty: o.min_order_qty ?? '—',
      flags: [o.is_preferred ? 'Preferred' : '', o.is_fastest ? 'Fastest' : '']
        .filter(Boolean)
        .join(', ') || '—',
    }));
    const lp = result.last_paid;
    const lpNote = lp
      ? ` Last paid ${formatCurrency(lp.unit_cost)}${lp.vendor_name ? ` to ${lp.vendor_name}` : ''}.`
      : '';
    return {
      text: `${result.message}${lpNote}`,
      dataDisplay: {
        displayType: 'table',
        columns: [
          { key: 'vendor', label: 'Vendor' },
          { key: 'unit_cost', label: 'Unit Cost' },
          { key: 'lead_time_days', label: 'Lead Time' },
          { key: 'min_order_qty', label: 'Min Qty' },
          { key: 'flags', label: '' },
        ],
        rows,
        totalRows: rows.length,
      },
    };
  }

  if (result.tier === 'catalog') {
    const options = result.options as CatalogVendorOption[];
    const rows = options.map((o) => ({
      vendor: o.name,
      location: [o.city, o.state].filter(Boolean).join(', ') || '—',
      industry: o.industry_tags.join(', ') || '—',
    }));
    return {
      text: result.message,
      dataDisplay: {
        displayType: 'table',
        columns: [
          { key: 'vendor', label: 'Catalog Vendor' },
          { key: 'location', label: 'Location' },
          { key: 'industry', label: 'Industry' },
        ],
        rows,
        totalRows: rows.length,
      },
    };
  }

  // Web tier.
  return {
    text: result.message,
    dataDisplay: {
      displayType: 'metric',
      label: 'Web search available',
      value: result.item.name || itemRef,
      secondaryMetrics: result.suggested_query
        ? [{ label: 'Suggested search', value: result.suggested_query }]
        : [],
    },
  };
}

// ─── Draft PO Preview (sprint item 02) ──────────────────────────────
// Advisory: assemble the reviewable Draft-PO card — vendor, priced lines with
// price_basis, per-line advisories (on-hand here/elsewhere, open POs, min-order
// nudge), estimated total, and PO-level warnings. Read-only, no confirmation —
// it CREATES NOTHING. Item 03's Create button owns the actual PO write. Delegates
// to the shared lib so this tool and POST /api/ai/draft-po-preview run identical
// logic (no self-HTTP-fetch).
async function draftPoPreviewTool(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const rawLines = Array.isArray(params.lines) ? params.lines : [];
  const lines = rawLines
    .map((l: any) => ({
      item_ref: typeof l?.item_ref === 'string' ? l.item_ref.trim() : '',
      qty: Number(l?.qty),
    }))
    .filter((l: any) => l.item_ref && Number.isFinite(l.qty) && l.qty > 0);

  if (lines.length === 0) {
    return {
      text: 'Tell me what to order — an item and a quantity (e.g. "5 Fuel Cans").',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'No lines' },
    };
  }

  const result = await buildDraftPoPreview(ctx.supabase, ctx.tenantId, {
    vendor_id: typeof params.vendor_id === 'string' ? params.vendor_id : undefined,
    catalog_vendor_id: typeof params.catalog_vendor_id === 'string' ? params.catalog_vendor_id : undefined,
    delivery_location_id: typeof params.delivery_location_id === 'string' ? params.delivery_location_id : undefined,
    needed_by_date: typeof params.needed_by_date === 'string' ? params.needed_by_date : undefined,
    cost_context: typeof params.cost_context === 'string' ? params.cost_context : undefined,
    lines,
  });

  // Fold the PO-level warnings + pending-adopt note into the text the model reads
  // back so the NL summary is honest alongside the structured card.
  const preface =
    result.vendor.pending_adopt && result.vendor.catalog_vendor_id
      ? ` (vendor not on file yet — id ${result.vendor.catalog_vendor_id})`
      : '';

  // Surface the full preview as a `po_draft` structured display (sprint item 03).
  // The frontend mounts an interactive PoDraftCard inline — editable qty/cost,
  // advisory chips, and a one-tap Create PO button — so Isabelle literally hands
  // the buyer a ready-to-create draft. The NL `text` still feeds OpenAI's summary.
  return {
    text: `${result.message}${preface}`,
    dataDisplay: {
      displayType: 'po_draft',
      preview: result,
    },
  };
}

// ─── Adopt Catalog Vendor (sprint item 04) ──────────────────────────
// Thin server tool so Isabelle can adopt a shared-catalog vendor conversationally
// ("add the first one"). Copies the catalog vendor's contacts + addresses into the
// tenant's OWN store (supply_chain.vendors) via adoptCatalogVendorsIntoSupplyChain
// — the SAME copy-on-write path POST /api/inventory/vendors/adopt (the card's
// "Add & use" button) uses. NOT the chassis tenant SDK .adopt(), which targets
// public.vendors on the GV project (doesn't exist there). Explicit confirm only.
async function adoptCatalogVendorTool(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  let catalogVendorId = typeof params.catalog_vendor_id === 'string' ? params.catalog_vendor_id.trim() : '';
  const name = typeof params.name === 'string' ? params.name.trim() : '';

  // Resolve an id from a name against the catalog when only a name was given.
  if (!catalogVendorId && name) {
    try {
      const catalog = getCatalogClient();
      const rows = await catalog.list({ activeOnly: true }).catch(() => []);
      const lower = name.toLowerCase();
      const hit =
        rows.find((v: any) => (v.name || '').toLowerCase() === lower) ||
        rows.find((v: any) => (v.name || '').toLowerCase().includes(lower));
      if (hit) catalogVendorId = hit.id;
    } catch {
      /* fall through to the missing-id error */
    }
  }

  if (!catalogVendorId) {
    return {
      text: name
        ? `I couldn't find "${name}" in the shared catalog. Try recommend_vendor_for_item first to get a catalog candidate.`
        : 'Tell me which catalog vendor to add (a catalog_vendor_id or a name).',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing catalog vendor' },
    };
  }

  try {
    const sc = supplyChainSchema(ctx.supabase);
    const idempotencyKey = `ai-adopt-vendor-${ctx.tenantId}-${Date.now()}`;
    const result = await adoptCatalogVendorsIntoSupplyChain(sc, ctx.tenantId, [catalogVendorId], idempotencyKey);
    // → { message, adopted: {id,name}[], skipped }.
    const first = result.adopted[0] ?? null;
    const vendorId = first?.id || null;
    const vendorName = first?.name || name || 'the vendor';
    return {
      text: vendorId
        ? `Added ${vendorName} to your vendors. You can now build a PO against them — want me to draft one?`
        : `Adopted ${vendorName}, but no vendor id came back — check your vendors list.`,
      dataDisplay: {
        displayType: 'metric',
        label: 'Vendor added',
        value: vendorName,
        secondaryMetrics: vendorId ? [{ label: 'Vendor id', value: vendorId }] : [],
      },
    };
  } catch (err: any) {
    return {
      text: `Couldn't add that catalog vendor: ${err?.message || 'unknown error'}.`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Adopt failed' },
    };
  }
}

// ─── Find Vendors Online (sprint item 04) ───────────────────────────
// Non-destructive web discovery: returns a LIST of real supplier candidates for
// the user to review. Creates nothing — adoption/creation stays an explicit
// confirm (the card's "Add & use" or a follow-up tool call). Mirrors the
// /api/ai/vendor-discover route's search so card taps and conversational asks
// return the same candidates.
async function findVendorsOnlineTool(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const query = typeof params.query === 'string' ? params.query.trim() : '';
  if (!query) {
    return {
      text: 'Tell me what to search for — an item and ideally a place (e.g. "wheel stop supplier near Portland").',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing query' },
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      text: 'Web vendor search is not available — the OpenAI API key is not configured.',
      dataDisplay: { displayType: 'metric', label: 'Unavailable', value: 'No API key' },
    };
  }

  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      // search-preview model (plain gpt-4o rejects web_search_options + temperature).
      model: 'gpt-4o-search-preview',
      web_search_options: { search_context_size: 'medium' },
      messages: [
        {
          role: 'system',
          content: [
            'You are a procurement research assistant for a construction / asphalt-paving company.',
            'Use web search to find up to 6 REAL businesses that match the request.',
            'Prefer a local branch with a real street address and phone over a national HQ.',
            'Return ONLY a valid JSON object {"results": [ ... ]}. Each result MUST have a name; include when found: name, code, category, street1, city, state, zip, phone, email, website.',
            'Drop any result with neither a street address nor a phone. No markdown fences. If nothing, return {"results": []}.',
          ].join('\n'),
        },
        { role: 'user', content: query },
      ],
      max_tokens: 1500,
    } as any);

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      return {
        text: `I couldn't find suppliers online for "${query}". Try different wording or a nearby city.`,
        dataDisplay: { displayType: 'metric', label: 'No results', value: query },
      };
    }

    let jsonStr = content.trim();
    const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) jsonStr = fence[1].trim();
    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      parsed = { results: [] };
    }
    const rawList: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.results) ? parsed.results : [];
    const results = rawList
      .map((item) => ({
        name: typeof item?.name === 'string' ? item.name.trim() : '',
        category: typeof item?.category === 'string' ? item.category.trim() : '',
        location: [item?.city, item?.state].filter((s) => typeof s === 'string' && s.trim()).join(', '),
        phone: typeof item?.phone === 'string' ? item.phone.trim() : '',
        email: typeof item?.email === 'string' ? item.email.trim() : '',
        website: typeof item?.website === 'string' ? item.website.trim() : '',
      }))
      .filter((r) => r.name && (r.location || r.phone || r.website))
      .slice(0, 6);

    if (results.length === 0) {
      return {
        text: `I couldn't find usable suppliers online for "${query}". Try a nearby city or different wording.`,
        dataDisplay: { displayType: 'metric', label: 'No results', value: query },
      };
    }

    return {
      text: `Found ${results.length} supplier${results.length === 1 ? '' : 's'} online for "${query}": ${results
        .map((r) => r.name)
        .join(', ')}. These aren't added yet — say "add <name>" to bring one in (I'll run a duplicate check first).`,
      dataDisplay: {
        displayType: 'table',
        columns: [
          { key: 'name', label: 'Vendor' },
          { key: 'category', label: 'Sells' },
          { key: 'location', label: 'Location' },
          { key: 'phone', label: 'Phone' },
          { key: 'website', label: 'Website' },
        ],
        rows: results,
        totalRows: results.length,
      },
    };
  } catch (err: any) {
    return {
      text: `Web vendor search failed: ${err?.message || 'unknown error'}.`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Search failed' },
    };
  }
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

  let location = typeof params.location === 'string' ? params.location.trim() : '';

  // Ground tenant location names to real geography: "my Portland yard" is the
  // tenant's location row (often named just "Portland"), not a phrase a web
  // search understands. Match in both directions — the phrase containing the
  // location name ("portland yard" ⊃ "portland") or vice versa — preferring
  // the longest-named match that actually has a city on file.
  if (location) {
    try {
      const cleaned = location.replace(/^(my|our|the)\s+/i, '').trim().toLowerCase();
      const { data: locs } = await inventorySchema(ctx.supabase)
        .from('locations')
        .select('name, city, state')
        .eq('tenant_id', ctx.tenantId)
        .eq('active', true)
        .limit(200);
      const match = (locs ?? [])
        .filter((l: any) => l.city && l.name)
        .filter((l: any) => {
          const n = l.name.trim().toLowerCase();
          return cleaned.includes(n) || n.includes(cleaned);
        })
        .sort((a: any, b: any) => b.name.length - a.name.length)[0];
      if (match) {
        location = [match.city, match.state].filter(Boolean).join(', ');
      }
    } catch {
      // Grounding is best-effort — fall back to the raw location string.
    }
  }

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
      // web_search_options requires the -search-preview models (plain gpt-4o
      // 400s on it, and search-preview rejects temperature) — this is why the
      // tool always fell back to the catalog.
      model: 'gpt-4o-search-preview',
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
      max_tokens: 1000,
    } as any);

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      // Fallback: check the global catalog
      return catalogFallbackForVendorSearch(query, location, ctx);
    }

    let jsonStr = content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const vendors = JSON.parse(jsonStr);

    if (!Array.isArray(vendors) || vendors.length === 0) {
      // Fallback: check the global catalog
      return catalogFallbackForVendorSearch(query, location, ctx);
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
    console.error('[search_vendors_online] Web search failed, trying catalog fallback:', err?.message);
    // Fallback: check the global catalog before giving up
    return catalogFallbackForVendorSearch(query, location, ctx);
  }
}

/** Shared fallback: search the global vendor catalog when web search fails or returns nothing */
async function catalogFallbackForVendorSearch(
  query: string,
  location: string,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  try {
    const catalog = getCatalogClient();
    const catalogVendors = await catalog.list();

    const queryLower = query.toLowerCase();
    const matches = (catalogVendors || []).filter((v: any) => {
      const name = (v.name || '').toLowerCase();
      const desc = (v.description || '').toLowerCase();
      const tags: string[] = v.industry_tags || v.tags || [];
      return name.includes(queryLower) ||
        desc.includes(queryLower) ||
        tags.some((t: string) => t.toLowerCase().includes(queryLower)) ||
        queryLower.includes(name);
    });

    if (matches.length > 0) {
      const rows = matches.slice(0, 5).map((v: any) => ({
        name: v.name || 'Unknown',
        description: (v.description || '').slice(0, 100),
        industry_tags: (v.industry_tags || v.tags || []).join(', '),
        source: 'Global Catalog',
      }));

      return {
        text: `Web search didn't find results, but I found ${matches.length} vendor${matches.length === 1 ? '' : 's'} matching "${query}" in the global catalog. Say "add [vendor name] from the catalog" to adopt one into your account.`,
        dataDisplay: {
          displayType: 'table',
          columns: [
            { key: 'name', label: 'Vendor' },
            { key: 'description', label: 'Description' },
            { key: 'industry_tags', label: 'Industry' },
            { key: 'source', label: 'Source' },
          ],
          rows,
          totalRows: matches.length,
        },
      };
    }
  } catch (catErr: any) {
    console.error('[search_vendors_online] Catalog fallback also failed:', catErr?.message);
  }

  // Both web search and catalog failed/empty — offer to create
  return {
    text: `No vendors found for "${query}"${location ? ` near ${location}` : ''} in web search or the global catalog. I can create a vendor with just the name — say "add a vendor named [company]".`,
    dataDisplay: { displayType: 'metric', label: 'Vendors Found', value: '0' },
  };
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
    .select('id, name, sku, description, uom_term_id, reorder_point, category_id, tracking_mode')
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
      .from('item_categories')
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
            '  unit_of_measure — standard UOM label (e.g. "Each", "Ton", "Bag", "Gallon", "Pound", "Foot", "Yard")',
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
      if (parsed.unit_of_measure) {
        suggestedFields['uom'] = {
          current: item.uom_term_id || '(none)',
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
    uom: 'Unit of Measure',
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
    const { data: locData } = await inventorySchema(ctx.supabase)
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
      .from('item_categories')
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
    const { data: locData } = await inventorySchema(ctx.supabase)
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
        unit: r.uom_label || r.uom_term_id || 'units',
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
            'You are a professional purchasing assistant for a construction company.',
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

  // Step 1: Get reorder suggestions (items below reorder point)
  const shortages =
    (unwrap(await inv.rpc('rpc_report_reorder_suggestions').limit(50), 'reorder suggestions') as any[]) || [];

  if (shortages.length === 0) {
    return {
      text: 'No items currently need reordering. All stock levels are above their reorder points.',
      dataDisplay: { displayType: 'metric', label: 'Reorder Status', value: 'All stocked' },
    };
  }

  // Step 2: Group shortages by preferred vendor for PO drafting.
  // rpc_report_reorder_suggestions returns the vendor name (preferred_vendor),
  // not an id, so we group on the name directly.
  type ShortageEntry = { item_name: string; sku: string; qty_needed: number; current_qty: number; reorder_point: number };
  const poGroups: Record<string, ShortageEntry[]> = {};
  const unassigned: ShortageEntry[] = [];

  for (const item of shortages) {
    const vendorName = typeof item.preferred_vendor === 'string' ? item.preferred_vendor.trim() : '';
    const entry: ShortageEntry = {
      item_name: item.item_name || 'Unknown',
      sku: item.sku || '',
      qty_needed: Math.max(1, Number(item.suggested_order_qty || item.shortage || item.reorder_qty || 1)),
      current_qty: Number(item.qty_on_hand || 0),
      reorder_point: Number(item.reorder_point || 0),
    };

    if (vendorName) {
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

// ─── Create Item With Variants ─────────────────────────────────────

/**
 * Create a plain single-form catalog item (no variants) via the wizard RPC.
 * Server-side sibling of the client-side add_item — used so the procure playbook
 * ("add ‘{name}’ & keep going") can create a new item AND chain straight into
 * recommend_vendor_for_item → draft_po_preview → create_po within the same
 * server-tool loop, instead of emitting a client tool and closing the stream.
 * Idempotent on SKU; reports the new item so the model can keep going.
 */
async function createSingleFormItem(
  name: string,
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  try {
    // Resolve category (fuzzy) if provided.
    let categoryId: string | null = null;
    if (params.category && typeof params.category === 'string') {
      const categoryName = params.category.trim().toLowerCase();
      const { data: cats } = await inventorySchema(ctx.supabase)
        .from('item_categories')
        .select('id, name')
        .limit(100);
      if (cats && cats.length > 0) {
        const match =
          cats.find((c: any) => c.name.toLowerCase() === categoryName) ||
          cats.find((c: any) => c.name.toLowerCase().includes(categoryName) || categoryName.includes(c.name.toLowerCase()));
        if (match) categoryId = match.id;
      }
    }

    // Resolve UOM term ID — provided value, then free-text resolve, else default EA.
    let uomTermId = params.uom_term_id || null;
    if (!uomTermId) {
      try {
        const gv = await getTenantGVClient(ctx.tenantId);
        const uomText = typeof params.uom === 'string' ? params.uom.trim() : 'EA';
        uomTermId = await gv.resolveTermId(ctx.tenantId, 'uom', uomText, true);
      } catch {
        /* non-fatal — RPC handles null */
      }
    }

    const trackingMode = typeof params.tracking_mode === 'string' ? params.tracking_mode.trim() : 'stock';
    const reorderPoint = typeof params.reorder_point === 'number' ? params.reorder_point : null;
    const idempotencyKey = `ai-item-${ctx.tenantId}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    const { data, error } = await inventorySchema(ctx.supabase).rpc('rpc_wizard_create_item', {
      p_name: name,
      p_description: params.description || null,
      p_uom_term_id: uomTermId,
      p_tracking_mode: trackingMode,
      p_reorder_point: reorderPoint,
      p_base_sku: null,
      p_sku: null,
      p_category_id: categoryId,
      p_create_category: null,
      p_vendor_id: null,
      p_create_vendor: null,
      p_vendor_sku: null,
      p_vendor_unit_cost: null,
      p_location_id: null,
      p_create_location: null,
      p_initial_qty: null,
      p_initial_cost: null,
      p_barcode: null,
      p_create_assets: null,
      p_has_variants: false,
      p_variant_dimensions: null,
      p_variant_options: null,
      p_idempotency_key: idempotencyKey,
      // ctx.supabase is a tenant SERVICE client with no JWT claims, so the RPC's
      // current_tenant_id() would be null → "Authentication required". Pass the
      // acting identity explicitly (service_role-only params; see migration
      // 20260814000011). This is what lets the chat loop add a brand-new item.
      p_tenant_id: ctx.tenantId,
      p_acting_user_id: ctx.userId,
    });

    if (error) {
      return {
        text: `Failed to add "${name}": ${error.message}`,
        dataDisplay: { displayType: 'metric', label: 'Error', value: 'Creation failed' },
      };
    }

    const d = (data as any) || {};
    const itemId = d.item_id || d.catalog_item_id || null;
    return {
      // Tell the model the item now exists AND its id, so it chains straight into
      // recommend_vendor_for_item on the real item rather than stopping.
      text:
        `Added "${name}" to the catalog${d.item_sku ? ` (SKU ${d.item_sku})` : ''}${itemId ? `, id ${itemId}` : ''}. ` +
        `Now continue the procure chain: call recommend_vendor_for_item for it, then draft_po_preview, then create the PO.`,
      dataDisplay: {
        displayType: 'metric',
        label: 'Item Added',
        value: name,
        secondaryMetrics: [
          { label: 'SKU', value: d.item_sku || 'auto' },
          ...(itemId ? [{ label: 'Item ID', value: itemId }] : []),
        ],
      },
    };
  } catch (err: any) {
    return {
      text: `Failed to add "${name}": ${err.message}`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Creation failed' },
    };
  }
}

async function createItemWithVariants(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const name = typeof params.name === 'string' ? params.name.trim() : '';
  if (!name) {
    return {
      text: 'Please provide an item name.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing name' },
    };
  }

  const variantDimensions = Array.isArray(params.variant_dimensions) ? params.variant_dimensions : [];
  const variantOptions = params.variant_options && typeof params.variant_options === 'object' ? params.variant_options : {};

  // No variant dimensions → this is a plain single-form item (the common procure
  // case: "add wheelstops and keep going"). Create it server-side via the same
  // wizard RPC so the procure chain (add → recommend → draft → create) keeps
  // running in one turn instead of dropping out to the client-side add_item.
  if (variantDimensions.length === 0) {
    return createSingleFormItem(name, params, ctx);
  }

  // Validate all dimensions have options
  for (const dim of variantDimensions) {
    if (!Array.isArray(variantOptions[dim]) || variantOptions[dim].length === 0) {
      return {
        text: `Dimension "${dim}" has no options. Please provide values (e.g. for size: S, M, L, XL).`,
        dataDisplay: { displayType: 'metric', label: 'Error', value: `No options for ${dim}` },
      };
    }
  }

  // Calculate total variants
  const totalVariants = variantDimensions.reduce(
    (acc: number, dim: string) => acc * (variantOptions[dim]?.length || 0),
    1
  );

  try {
    // Resolve category if provided
    let categoryId: string | null = null;
    if (params.category && typeof params.category === 'string') {
      const categoryName = params.category.trim();
      const { data: cats } = await inventorySchema(ctx.supabase)
        .from('item_categories')
        .select('id, name')
        .limit(100);

      if (cats && cats.length > 0) {
        const lower = categoryName.toLowerCase();
        const match = cats.find((c: any) => c.name.toLowerCase() === lower) ||
          cats.find((c: any) => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase()));
        if (match) categoryId = match.id;
      }
    }

    // Call the wizard RPC directly via supabase
    // Skip parent stock — will apply per-variant stock after variant creation
    const initialQty = typeof params.initial_qty_per_variant === 'number' ? params.initial_qty_per_variant : null;
    const locationId = params.location_id || null;
    const idempotencyKey = `ai-variant-item-${ctx.tenantId}-${Date.now()}`;

    // Resolve UOM term ID — use provided value, or resolve from text, or default to "EA"
    let uomTermId = params.uom_term_id || null;
    if (!uomTermId) {
      try {
        const gv = await getTenantGVClient(ctx.tenantId);
        const uomText = typeof params.uom === 'string' ? params.uom.trim() : 'EA';
        uomTermId = await gv.resolveTermId(ctx.tenantId, 'uom', uomText, true);
      } catch {
        // Non-fatal — RPC will handle null if allowed
      }
    }

    const { data, error } = await inventorySchema(ctx.supabase).rpc('rpc_wizard_create_item', {
      p_name: name,
      p_description: params.description || null,
      p_uom_term_id: uomTermId,
      p_tracking_mode: 'stock',
      p_reorder_point: null,
      p_base_sku: null,
      p_sku: null,
      p_category_id: categoryId,
      p_create_category: null,
      p_vendor_id: null,
      p_create_vendor: null,
      p_vendor_sku: null,
      p_vendor_unit_cost: null,
      p_location_id: locationId,
      p_create_location: null,
      p_initial_qty: null,
      p_initial_cost: null,
      p_barcode: null,
      p_create_assets: null,
      p_has_variants: true,
      p_variant_dimensions: variantDimensions,
      p_variant_options: variantOptions,
      p_idempotency_key: idempotencyKey,
      // Service client has no JWT claims — pass the acting identity explicitly
      // (service_role-only params; see migration 20260814000011).
      p_tenant_id: ctx.tenantId,
      p_acting_user_id: ctx.userId,
    });

    if (error) {
      return {
        text: `Failed to create item with variants: ${error.message}`,
        dataDisplay: { displayType: 'metric', label: 'Error', value: 'Creation failed' },
      };
    }

    const d = data as any;

    // Apply per-variant initial stock if location and qty provided
    if (initialQty && initialQty > 0 && locationId) {
      const variantsEntity = (d.created_entities || []).find((e: any) => e.type === 'variants');
      const variantIds: string[] = variantsEntity?.variant_ids || [];
      const inv = inventorySchema(ctx.supabase);

      for (const variantId of variantIds) {
        const eventKey = `ai-vstk-${variantId}-${idempotencyKey}`;
        await inv.from('stock_movements').upsert({
          catalog_item_id: variantId,
          location_id: locationId,
          quantity_delta: initialQty,
          movement_type: 'adjusted',
          reason: 'initial_stock',
          notes: 'Initial stock set via AI assistant (per variant)',
          occurred_at: new Date().toISOString(),
          last_event_id: eventKey,
        }, { onConflict: 'tenant_id,last_event_id' });
      }
    }

    // Build a human-readable summary
    const dimSummary = variantDimensions
      .map((dim: string) => `${variantOptions[dim].length} ${dim}${variantOptions[dim].length !== 1 ? 's' : ''}`)
      .join(' x ');

    const stockNote = initialQty && initialQty > 0 && locationId
      ? ` Initial stock: ${initialQty} per variant (${totalVariants * initialQty} total).`
      : '';

    return {
      text: `Created parent item "${name}" with ${totalVariants} variants (${dimSummary}). SKU: ${d.item_sku || 'auto-generated'}.${stockNote}`,
      dataDisplay: {
        displayType: 'metric',
        label: 'Item Created',
        value: name,
        secondaryMetrics: [
          { label: 'SKU', value: d.item_sku || 'auto' },
          { label: 'Variants', value: String(totalVariants) },
          { label: 'Dimensions', value: variantDimensions.join(', ') },
          ...variantDimensions.map((dim: string) => ({
            label: dim.charAt(0).toUpperCase() + dim.slice(1),
            value: variantOptions[dim].join(', '),
          })),
        ],
      },
    };
  } catch (err: any) {
    return {
      text: `Failed to create item with variants: ${err.message}`,
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Creation failed' },
    };
  }
}

// ─── Ontology Tool Implementations ───────────────────────────────────

async function resolveEntityTool(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const text = params.text || params.query || '';
  const entityType = params.entity_type || undefined;

  if (!text) {
    return {
      text: 'Please provide text to resolve.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'No text provided' },
    };
  }

  const result = await resolveEntity(ctx.supabase, ctx.tenantId, text, entityType);

  if (!result) {
    return {
      text: `Could not resolve "${text}" to any known entity.`,
      dataDisplay: { displayType: 'metric', label: 'Entity Resolution', value: 'No match found' },
    };
  }

  return {
    text: `Resolved "${text}" → ${result.canonical_name} (${result.entity_type}, ${result.match_method} match, confidence: ${(result.confidence * 100).toFixed(0)}%)`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'field', label: 'Field' },
        { key: 'value', label: 'Value' },
      ],
      rows: [
        { field: 'Entity Type', value: result.entity_type },
        { field: 'Entity ID', value: result.entity_id },
        { field: 'Canonical Name', value: result.canonical_name },
        { field: 'Match Method', value: result.match_method },
        { field: 'Confidence', value: `${(result.confidence * 100).toFixed(0)}%` },
      ],
    },
  };
}

async function queryRelationshipsTool(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const entityType = params.entity_type || '';
  const entityId = params.entity_id || '';

  if (!entityType || !entityId) {
    return {
      text: 'Please provide entity_type and entity_id to query relationships.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing parameters' },
    };
  }

  const rels = await findAllRelationships(ctx.supabase, ctx.tenantId, entityType, entityId);

  if (rels.length === 0) {
    return {
      text: `No relationships found for ${entityType} ${entityId}.`,
      dataDisplay: { displayType: 'metric', label: 'Relationships', value: '0 found' },
    };
  }

  const rows = rels.map((r) => ({
    relation: r.relation,
    source_type: r.source_type,
    source_id: r.source_id || 'type-level',
    target_type: r.target_type,
    target_id: r.target_id || 'type-level',
    confidence: `${(Number(r.confidence) * 100).toFixed(0)}%`,
  }));

  return {
    text: `Found ${rels.length} relationship(s) for ${entityType} ${entityId}: ${rels.map((r) => r.relation).join(', ')}`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'relation', label: 'Relation' },
        { key: 'source_type', label: 'Source Type' },
        { key: 'target_type', label: 'Target Type' },
        { key: 'confidence', label: 'Confidence' },
      ],
      rows,
    },
  };
}

async function findSubstitutesTool(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const entityType = params.entity_type || 'item';
  const entityId = params.entity_id || '';

  if (!entityId) {
    return {
      text: 'Please provide an entity_id to find substitutes for.',
      dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing entity_id' },
    };
  }

  const result = await findSubstitutesQuery(ctx.supabase, ctx.tenantId, entityType, entityId);

  if (result.entities.length === 0) {
    return {
      text: `No substitutes found for ${entityType} ${entityId}.`,
      dataDisplay: { displayType: 'metric', label: 'Substitutes', value: '0 found' },
    };
  }

  const rows = result.entities.map((e) => ({
    entity_type: e.entity_type,
    entity_id: e.entity_id || 'N/A',
    confidence: `${(e.confidence * 100).toFixed(0)}%`,
  }));

  return {
    text: `Found ${result.entities.length} substitute(s) for ${entityType} ${entityId}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'entity_type', label: 'Type' },
        { key: 'entity_id', label: 'ID' },
        { key: 'confidence', label: 'Confidence' },
      ],
      rows,
    },
  };
}

// ─── Query Cycle Counts ─────────────────────────────────────────────

async function queryCycleCounts(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  let query = inventorySchema(ctx.supabase)
    .from('cycle_counts')
    .select('id, count_number, location_id, scheduled_for, status, started_at, completed_at, notes, created_at');

  if (params.status) {
    query = query.eq('status', params.status);
  }

  const { data, error } = await query.order('scheduled_for', { ascending: false }).limit(50);

  if (error) {
    return { text: `Failed to query cycle counts: ${error.message}`, dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' } };
  }

  if (!data?.length) {
    return { text: `No cycle counts found${params.status ? ` with status "${params.status}"` : ''}. You can create cycle counts from the Cycle Counts page.`, dataDisplay: { displayType: 'metric', label: 'Cycle Counts', value: '0' } };
  }

  const locIds = [...new Set((data as any[]).map((r: any) => r.location_id).filter(Boolean))];
  let locMap: Record<string, string> = {};
  if (locIds.length > 0) {
    const { data: locData } = await inventorySchema(ctx.supabase).from('locations').select('id, name').in('id', locIds).limit(200);
    if (locData) locMap = Object.fromEntries(locData.map((l: any) => [l.id, l.name]));
  }

  const rows = (data as any[]).map((r: any) => ({
    count_number: r.count_number,
    location: locMap[r.location_id] || '—',
    scheduled_for: r.scheduled_for,
    status: r.status,
    started_at: r.started_at ? new Date(r.started_at).toLocaleDateString() : '—',
    completed_at: r.completed_at ? new Date(r.completed_at).toLocaleDateString() : '—',
  }));

  return {
    text: `Found ${rows.length} cycle count${rows.length === 1 ? '' : 's'}. ${rows.slice(0, 3).map((r) => `${r.count_number} at ${r.location} — ${r.status}`).join('; ')}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'count_number', label: 'Count #' },
        { key: 'location', label: 'Location' },
        { key: 'scheduled_for', label: 'Scheduled' },
        { key: 'status', label: 'Status' },
        { key: 'started_at', label: 'Started' },
        { key: 'completed_at', label: 'Completed' },
      ],
      rows,
      totalRows: rows.length,
    },
  };
}

// ─── Query Cancelled Transfers ──────────────────────────────────────

async function queryCancelledTransfers(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const days = Number(params.days) || 7;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await inventorySchema(ctx.supabase)
    .from('transfers')
    .select('id, transfer_number, from_location_id, to_location_id, status, cancelled_at, cancellation_reason, created_at')
    .eq('status', 'cancelled')
    .gte('cancelled_at', since.toISOString())
    .order('cancelled_at', { ascending: false })
    .limit(50);

  if (error) {
    return { text: `Failed to query cancelled transfers: ${error.message}`, dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' } };
  }

  if (!data?.length) {
    return { text: `No cancelled transfers in the last ${days} day${days === 1 ? '' : 's'}.`, dataDisplay: { displayType: 'metric', label: 'Cancelled Transfers', value: '0' } };
  }

  const locIds = [...new Set((data as any[]).flatMap((r: any) => [r.from_location_id, r.to_location_id]).filter(Boolean))];
  let locMap: Record<string, string> = {};
  if (locIds.length > 0) {
    const { data: locData } = await inventorySchema(ctx.supabase).from('locations').select('id, name').in('id', locIds).limit(200);
    if (locData) locMap = Object.fromEntries(locData.map((l: any) => [l.id, l.name]));
  }

  const rows = (data as any[]).map((r: any) => ({
    transfer_number: r.transfer_number,
    from: locMap[r.from_location_id] || '—',
    to: locMap[r.to_location_id] || '—',
    cancelled_at: r.cancelled_at ? new Date(r.cancelled_at).toLocaleDateString() : '—',
    reason: r.cancellation_reason || '—',
  }));

  return {
    text: `Found ${rows.length} cancelled transfer${rows.length === 1 ? '' : 's'} in the last ${days} days. ${rows.slice(0, 3).map((r) => `${r.transfer_number}: ${r.from} → ${r.to} (${r.reason})`).join('; ')}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'transfer_number', label: 'Transfer #' },
        { key: 'from', label: 'From' },
        { key: 'to', label: 'To' },
        { key: 'cancelled_at', label: 'Cancelled' },
        { key: 'reason', label: 'Reason' },
      ],
      rows,
      totalRows: rows.length,
    },
  };
}

// ─── Query Stock Movements (Ledger) ─────────────────────────────────

async function queryStockMovements(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  let query = inventorySchema(ctx.supabase)
    .from('stock_movements')
    .select('id, catalog_item_id, location_id, quantity_delta, movement_type, reason, notes, occurred_at, source_ref_type');

  if (params.movement_type) query = query.eq('movement_type', params.movement_type);
  if (params.start_date) query = query.gte('occurred_at', params.start_date);
  if (params.end_date) query = query.lte('occurred_at', params.end_date);

  const { data, error } = await query.order('occurred_at', { ascending: false }).limit(50);

  if (error) {
    return { text: `Failed to query stock movements: ${error.message}`, dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' } };
  }

  if (!data?.length) {
    return { text: 'No stock movements found matching your filters.', dataDisplay: { displayType: 'metric', label: 'Movements', value: '0' } };
  }

  const itemIds = [...new Set((data as any[]).map((r: any) => r.catalog_item_id).filter(Boolean))];
  let itemMap: Record<string, string> = {};
  if (itemIds.length > 0) {
    const { data: itemData } = await inventorySchema(ctx.supabase).from('catalog_items').select('id, name').in('id', itemIds).limit(200);
    if (itemData) itemMap = Object.fromEntries(itemData.map((i: any) => [i.id, i.name]));
  }

  const locIds = [...new Set((data as any[]).map((r: any) => r.location_id).filter(Boolean))];
  let locMap: Record<string, string> = {};
  if (locIds.length > 0) {
    const { data: locData } = await inventorySchema(ctx.supabase).from('locations').select('id, name').in('id', locIds).limit(200);
    if (locData) locMap = Object.fromEntries(locData.map((l: any) => [l.id, l.name]));
  }

  const rows = (data as any[]).map((r: any) => ({
    item: itemMap[r.catalog_item_id] || '—',
    location: locMap[r.location_id] || '—',
    delta: Number(r.quantity_delta) > 0 ? `+${r.quantity_delta}` : String(r.quantity_delta),
    type: r.movement_type,
    reason: r.reason || '—',
    date: r.occurred_at ? new Date(r.occurred_at).toLocaleDateString() : '—',
    source: r.source_ref_type || '—',
  }));

  return {
    text: `Found ${rows.length} stock movement${rows.length === 1 ? '' : 's'}. ${rows.slice(0, 3).map((r) => `${r.item} at ${r.location}: ${r.delta} (${r.type})`).join('; ')}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'item', label: 'Item' },
        { key: 'location', label: 'Location' },
        { key: 'delta', label: 'Qty Change' },
        { key: 'type', label: 'Type' },
        { key: 'reason', label: 'Reason' },
        { key: 'date', label: 'Date' },
        { key: 'source', label: 'Source' },
      ],
      rows,
      totalRows: rows.length,
    },
  };
}

// ─── Query Stock By Location ────────────────────────────────────────

async function queryStockByLocation(
  params: Record<string, any>,
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const locationHint = typeof params.location === 'string' ? params.location.trim() : '';
  if (!locationHint) {
    return { text: 'Please specify a location name (e.g. "Portland", "Auburn Yard").', dataDisplay: { displayType: 'metric', label: 'Error', value: 'Missing location' } };
  }

  const { data: locations } = await inventorySchema(ctx.supabase)
    .from('locations')
    .select('id, name')
    .ilike('name', `%${locationHint}%`)
    .limit(5);

  if (!locations?.length) {
    return { text: `No location found matching "${locationHint}".`, dataDisplay: { displayType: 'metric', label: 'Not Found', value: locationHint } };
  }

  const loc = locations[0];

  const { data: balances, error } = await inventorySchema(ctx.supabase)
    .from('stock_balances')
    .select('catalog_item_id, qty_on_hand, qty_reserved, qty_available')
    .eq('location_id', loc.id)
    .gt('qty_on_hand', 0)
    .limit(100);

  if (error) {
    return { text: `Failed to query stock at ${loc.name}: ${error.message}`, dataDisplay: { displayType: 'metric', label: 'Error', value: 'Query failed' } };
  }

  if (!balances?.length) {
    return { text: `No stock found at ${loc.name}.`, dataDisplay: { displayType: 'metric', label: loc.name, value: '0 items' } };
  }

  const itemIds = (balances as any[]).map((b: any) => b.catalog_item_id).filter(Boolean);
  let itemMap: Record<string, string> = {};
  if (itemIds.length > 0) {
    const { data: itemData } = await inventorySchema(ctx.supabase).from('catalog_items').select('id, name').in('id', itemIds).limit(200);
    if (itemData) itemMap = Object.fromEntries(itemData.map((i: any) => [i.id, i.name]));
  }

  const rows = (balances as any[]).map((b: any) => ({
    item: itemMap[b.catalog_item_id] || '(unknown)',
    on_hand: formatNumber(Number(b.qty_on_hand) || 0),
    reserved: formatNumber(Number(b.qty_reserved) || 0),
    available: formatNumber(Number(b.qty_available) || 0),
  }));

  return {
    text: `${loc.name} has ${rows.length} item${rows.length === 1 ? '' : 's'} in stock. ${rows.slice(0, 5).map((r) => `${r.item}: ${r.on_hand} on hand`).join(', ')}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'item', label: 'Item' },
        { key: 'on_hand', label: 'On Hand' },
        { key: 'reserved', label: 'Reserved' },
        { key: 'available', label: 'Available' },
      ],
      rows,
      totalRows: rows.length,
    },
  };
}

// ─── Query Integrations ─────────────────────────────────────────────

async function queryIntegrations(
  ctx: ServerToolContext
): Promise<ServerToolResult> {
  const { data: toolConfigs } = await inventorySchema(ctx.supabase)
    .from('ai_tool_config')
    .select('tool_name, enabled, config')
    .eq('tenant_id', ctx.tenantId)
    .limit(50);

  const rows = (toolConfigs || []).map((c: any) => ({
    tool: c.tool_name,
    enabled: c.enabled ? 'Yes' : 'No',
    config: c.config ? JSON.stringify(c.config).slice(0, 80) : '—',
  }));

  if (rows.length === 0) {
    return {
      text: 'No custom integrations or tool configurations found. All tools are running with default settings. You can configure integrations from Settings.',
      dataDisplay: { displayType: 'metric', label: 'Integrations', value: '0 configured' },
    };
  }

  return {
    text: `Found ${rows.length} tool configuration${rows.length === 1 ? '' : 's'}. ${rows.map((r: any) => `${r.tool}: ${r.enabled}`).join(', ')}.`,
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'tool', label: 'Tool' },
        { key: 'enabled', label: 'Enabled' },
        { key: 'config', label: 'Config' },
      ],
      rows,
      totalRows: rows.length,
    },
  };
}

