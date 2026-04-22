/**
 * OpenAI Response Parser
 * Extracts tool_calls or text content from chat completion responses.
 */

import type { IntentType } from '@/lib/chat/intents';

export interface ToolUseResult {
  type: 'tool_use';
  intent: IntentType;
  params: Record<string, string>;
}

export interface TextResult {
  type: 'text';
  content: string;
}

export type ParsedAIResponse = ToolUseResult | TextResult;

/**
 * All valid intent names that map to function tool names.
 */
const VALID_INTENTS: Set<string> = new Set([
  'add_vendor', 'update_vendor', 'delete_vendor', 'list_vendors',
  'add_item', 'update_item', 'delete_item', 'list_items',
  'adjust_stock', 'update_stock', 'check_stock', 'low_stock',
  'issue_inventory',
  'create_po', 'list_pos', 'late_orders',
  'list_locations', 'add_location',
  'create_transfer', 'list_transfers',
  'create_asset', 'list_assets',
  'list_receipts',
  'inventory_summary', 'navigate', 'help',
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
}): ParsedAIResponse | null {
  // Server says to fall back to keyword matching
  if (body.fallbackToKeyword) {
    return null;
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
