/**
 * Tool Registration Bootstrap
 *
 * Reads existing INVENTORY_TOOLS, SERVER_TOOLS, and TOOL_GOVERNANCE
 * and registers them all into the unified ToolRegistry.
 *
 * This is the single import needed to populate the registry.
 */

import { toolRegistry, type ToolTag, type ToolExecutionMode, type ToolDefinition } from '../tool-registry';
import { INVENTORY_TOOLS } from '../tools';
import { isServerTool, executeServerTool, type ServerToolContext, type ServerToolResult } from '../server-tools';
import { TOOL_GOVERNANCE, ADMIN_ONLY_TOOLS } from '../tool-governance';
import type { ToolGovernance } from '../types';

// ─── Tag Classification ──────────────────────────────────────────────

const TAG_MAP: Record<string, ToolTag[]> = {
  // Analytics
  query_inventory_summary: ['analytics'],
  query_stock_valuation: ['analytics'],
  query_low_stock_report: ['analytics'],
  query_dead_stock: ['analytics'],
  query_velocity_analysis: ['analytics'],
  query_movement_summary: ['analytics'],
  query_usage_trends: ['analytics'],
  query_reorder_suggestions: ['analytics'],
  query_forecast: ['analytics'],
  query_inventory_turnover: ['analytics'],
  query_po_status: ['analytics'],
  query_reservations: ['analytics'],
  query_asset_value: ['analytics'],

  // Workflow
  workflow_auto_reorder: ['workflow'],
  workflow_stock_rebalance: ['workflow'],

  // Smart tools
  smart_stock_receive: ['smart'],
  smart_add_location: ['smart'],
  smart_register_asset: ['smart'],

  // Enrichment
  search_vendors_online: ['enrichment', 'search'],
  set_preferred_vendor: ['enrichment'],
  enrich_vendor: ['enrichment'],
  enrich_item: ['enrichment'],
  semantic_search: ['search', 'semantic'],
  purchasing_assistant: ['workflow'],
  extract_document: ['smart'],

  // CRUD
  add_vendor: ['crud'],
  update_vendor: ['crud'],
  delete_vendor: ['crud'],
  add_item: ['crud'],
  update_item: ['crud'],
  delete_item: ['crud'],
  create_item_with_variants: ['crud'],
  list_vendors: ['crud'],
  list_catalog_vendors: ['crud', 'search'],
  recommend_vendor_for_item: ['enrichment', 'search'],
  draft_po_preview: ['enrichment', 'workflow'],
  adopt_catalog_vendor: ['crud', 'enrichment'],
  find_vendors_online: ['enrichment', 'search'],
  list_items: ['crud'],
  check_stock: ['crud'],
  low_stock: ['crud'],
  list_pos: ['crud'],
  late_orders: ['crud', 'analytics'],
  list_locations: ['crud'],
  list_transfers: ['crud'],
  list_assets: ['crud'],
  print_labels: ['crud'],
  list_receipts: ['crud'],
  list_reservations: ['crud'],
  list_categories: ['crud'],
  create_po: ['crud'],
  draft_restock_order: ['workflow'],
  confirm_restock_order: ['workflow', 'crud'],
  create_transfer: ['crud'],
  create_asset: ['crud'],
  create_reservation: ['crud'],
  release_reservation: ['crud'],
  add_location: ['crud'],
  add_category: ['crud'],
  adjust_stock: ['crud'],
  adjust_stock_delta: ['crud'],
  issue_inventory: ['crud'],
  receive_po: ['crud'],
  draft_purchase_request: ['workflow'],

  // Navigation
  navigate: ['navigation'],
  global_search: ['search'],
  help: ['navigation'],
  inventory_summary: ['analytics'],

  // Apparel
  list_pending_apparel_orders: ['apparel'],
  approve_apparel_order: ['apparel'],
  reject_apparel_order: ['apparel'],

  // Ontology
  resolve_entity: ['ontology', 'search'],
  query_relationships: ['ontology'],
  find_substitutes: ['ontology'],

  // New analytics tools
  query_cycle_counts: ['analytics'],
  query_cancelled_transfers: ['analytics'],
  query_stock_movements: ['analytics'],
  query_stock_by_location: ['analytics'],
  query_integrations: ['analytics'],
};

// Default governance for tools that don't have explicit metadata
const DEFAULT_GOVERNANCE: ToolGovernance = {
  name: '',
  riskLevel: 'low',
  requiresConfirmation: false,
  requiresIdempotency: false,
  readAfterWrite: false,
};

let _bootstrapped = false;

/**
 * Bootstrap the tool registry from existing data structures.
 * Safe to call multiple times — only runs once.
 */
export function bootstrapToolRegistry(): void {
  if (_bootstrapped) return;
  _bootstrapped = true;

  for (const schema of INVENTORY_TOOLS) {
    if (!('function' in schema)) continue;
    const name = schema.function.name;
    const executionMode: ToolExecutionMode = isServerTool(name) ? 'server' : 'client';
    const governance = TOOL_GOVERNANCE[name] || { ...DEFAULT_GOVERNANCE, name };
    const tags = TAG_MAP[name] || [];

    const def: ToolDefinition = {
      name,
      schema,
      governance,
      tags,
      executionMode,
      minRole: ADMIN_ONLY_TOOLS.has(name) ? 'admin' : 'authenticated',
    };

    // For server tools, wrap executeServerTool as the handler
    if (executionMode === 'server') {
      def.handler = (params: Record<string, any>, ctx: ServerToolContext): Promise<ServerToolResult> => {
        return executeServerTool(name, params, ctx);
      };
    }

    toolRegistry.register(def);
  }
}

// Auto-bootstrap on import
bootstrapToolRegistry();
