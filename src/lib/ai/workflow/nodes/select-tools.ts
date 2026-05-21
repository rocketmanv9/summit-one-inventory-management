/**
 * Tool Selection Node — Selects tools based on intent, entities, and registry tags.
 */
import type { ChatGraphState, ChatGraphUpdate } from '../graph-types';
import { toolRegistry, type ToolTag } from '../../tool-registry';

const INTENT_TOOL_MAP: Record<string, string[]> = {
  // Analytics & reporting
  analytics: ['query_inventory_summary', 'query_stock_valuation', 'query_low_stock_report', 'query_dead_stock', 'query_velocity_analysis', 'query_movement_summary', 'query_inventory_turnover', 'query_forecast'],
  check_stock: ['check_stock', 'query_stock_by_location'],

  // Search & ontology
  search: ['semantic_search', 'resolve_entity', 'global_search'],

  // CRUD: read/list
  list: ['list_items', 'list_vendors', 'list_locations', 'list_assets', 'list_transfers', 'list_pos', 'list_receipts', 'list_reservations', 'list_categories'],

  // CRUD: mutations
  adjust_stock: ['adjust_stock'],
  adjust_stock_delta: ['adjust_stock_delta'],
  issue_inventory: ['issue_inventory'],
  create_transfer: ['create_transfer'],
  create_po: ['create_po'],
  create_reservation: ['create_reservation'],
  create_asset: ['create_asset'],
  add_vendor: ['add_vendor'],
  add_item: ['add_item'],
  add_location: ['add_location'],
  add_category: ['add_category'],
  update_vendor: ['update_vendor'],
  update_item: ['update_item'],
  delete_vendor: ['delete_vendor'],
  delete_item: ['delete_item'],

  // Workflow
  workflow: ['workflow_auto_reorder', 'workflow_stock_rebalance', 'query_reorder_suggestions'],
  dashboard: ['create_dashboard', 'list_dashboards', 'list_available_widgets'],

  // Navigation & help
  navigate: ['navigate'],
  help: ['help'],
  greeting: [],
};

/** Map intent categories to registry tags for fallback tool discovery */
const INTENT_TAG_FALLBACK: Record<string, ToolTag> = {
  analytics: 'analytics',
  search: 'search',
  workflow: 'workflow',
  dashboard: 'dashboard',
  mutation: 'crud',
  list: 'crud',
};

export async function selectToolsNode(state: ChatGraphState): Promise<ChatGraphUpdate> {
  const intent = state.intent || '';
  const tools = INTENT_TOOL_MAP[intent] || [];

  // Filter to tools that actually exist in registry
  let valid = tools.filter((t) => toolRegistry.has(t));

  // Entity-aware tool augmentation: if resolved entities include specific types,
  // add relevant tools that weren't already selected
  if (state.resolvedEntities.length > 0) {
    const entityTypes = new Set(state.resolvedEntities.map((e) => e.entity_type));

    if (entityTypes.has('vendor') && !valid.some((t) => t.includes('vendor'))) {
      valid.push(...['list_vendors', 'list_catalog_vendors'].filter((t) => toolRegistry.has(t) && !valid.includes(t)));
    }
    if (entityTypes.has('item') && !valid.some((t) => t.includes('item') || t.includes('stock'))) {
      valid.push(...['check_stock', 'list_items'].filter((t) => toolRegistry.has(t) && !valid.includes(t)));
    }
    if (entityTypes.has('location') && !valid.some((t) => t.includes('location'))) {
      valid.push(...['query_stock_by_location', 'list_locations'].filter((t) => toolRegistry.has(t) && !valid.includes(t)));
    }
  }

  // Tag-based fallback: if no tools matched via the map, try registry tags
  if (valid.length === 0 && intent !== 'greeting' && intent !== 'general') {
    const tag = INTENT_TAG_FALLBACK[intent];
    if (tag) {
      const tagTools = toolRegistry.listByTag(tag);
      valid = tagTools.map((t) => t.name).slice(0, 5); // Limit to top 5
    }
  }

  return { selectedTools: valid, nodesVisited: ['select_tools'] };
}
