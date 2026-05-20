/**
 * OpenAI Response Parser
 * Extracts tool_calls or text content from chat completion responses.
 */

import type { IntentType } from '@/lib/chat/intents';
import type { AiDataDisplay } from './types';

export interface ToolUseResult {
  type: 'tool_use';
  intent: IntentType;
  params: Record<string, string>;
}

export interface TextResult {
  type: 'text';
  content: string;
}

export interface DataResult {
  type: 'data_result';
  content: string;
  dataDisplay: AiDataDisplay;
}

export type ParsedAIResponse = ToolUseResult | TextResult | DataResult;

/**
 * All valid intent names that map to function tool names.
 */
const VALID_INTENTS: Set<string> = new Set([
  // Client-side CRUD/list tools
  'add_vendor', 'update_vendor', 'delete_vendor', 'list_vendors',
  'add_item', 'update_item', 'delete_item', 'list_items',
  'adjust_stock', 'adjust_stock_delta', 'update_stock', 'check_stock', 'low_stock',
  'issue_inventory',
  'create_po', 'list_pos', 'late_orders',
  'list_locations', 'add_location',
  'create_transfer', 'list_transfers',
  'create_asset', 'list_assets',
  'list_receipts',
  'create_reservation', 'release_reservation', 'list_reservations',
  'receive_po',
  'list_categories', 'add_category',
  'global_search',
  'inventory_summary', 'navigate', 'help',
  // Server-side analytics tools
  'query_inventory_summary', 'query_stock_valuation', 'query_low_stock_report',
  'query_dead_stock', 'query_velocity_analysis', 'query_movement_summary',
  'query_reorder_suggestions', 'query_forecast', 'query_inventory_turnover',
  'query_po_status',
  // Dashboard & workflow tools
  'create_dashboard', 'list_dashboards', 'list_available_widgets',
  'add_dashboard_widget', 'remove_dashboard_widget',
  'update_dashboard', 'delete_dashboard',
  'workflow_auto_reorder', 'workflow_stock_rebalance',
  'smart_stock_receive', 'semantic_search', 'purchasing_assistant',
]);

/**
 * Parse the raw API response body into a structured result.
 */
export function parseAIResponse(body: {
  fallbackToKeyword?: boolean;
  type?: string;
  intent?: string;
  params?: Record<string, string>;
  content?: string;
  error?: string;
  dataDisplay?: AiDataDisplay;
}): ParsedAIResponse | null {
  // Server says to fall back to keyword matching
  if (body.fallbackToKeyword) {
    return null;
  }

  // Data result — server-side query returned structured data + summary
  if (body.type === 'data_result' && body.content && body.dataDisplay) {
    return {
      type: 'data_result',
      content: body.content,
      dataDisplay: body.dataDisplay,
    };
  }

  // Tool use response
  if (body.type === 'tool_use' && body.intent) {
    if (!VALID_INTENTS.has(body.intent)) {
      return null;
    }
    return {
      type: 'tool_use',
      intent: body.intent as IntentType,
      params: body.params || {},
    };
  }

  // Text response from GPT
  if (body.type === 'text' && body.content) {
    return {
      type: 'text',
      content: body.content,
    };
  }

  // Error or unrecognized
  return null;
}
