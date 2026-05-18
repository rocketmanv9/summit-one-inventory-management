/**
 * Tool Selection Node — Selects tools based on intent and entities.
 */
import type { WorkflowState } from '../graph-types';
import { toolRegistry } from '../../tool-registry';

const INTENT_TOOL_MAP: Record<string, string[]> = {
  analytics: ['query_inventory_summary', 'query_stock_valuation', 'query_low_stock_report'],
  search: ['semantic_search', 'resolve_entity'],
  greeting: [],
};

export async function selectToolsNode(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const tools = INTENT_TOOL_MAP[state.intent || ''] || [];
  // Filter to tools that actually exist in registry
  const valid = tools.filter((t) => toolRegistry.has(t));
  return { selectedTools: valid, nodesVisited: [...state.nodesVisited, 'select_tools'] };
}
