/**
 * OpenAI Response Parser
 * Extracts tool_calls or text content from chat completion responses.
 */

import type { IntentType } from '@/lib/chat/intents';
import type { AiDataDisplay } from './types';
import { INVENTORY_TOOLS } from './tools';

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
 *
 * Derived from the canonical INVENTORY_TOOLS registry so this gate can never
 * drift behind the tool list. Previously this was a hand-maintained set; any
 * client tool accidentally left out of it was silently dropped by the parser
 * (the tool_call SSE event would parse to null and no-op). Building it from the
 * registry guarantees every defined tool passes the gate.
 *
 * Legacy aliases that are valid intents but not OpenAI tool names are added
 * explicitly:
 *  - `update_stock` — older alias for adjust_stock used by the keyword parser.
 *  - `help` — built-in navigation/help intent, handled client-side without a tool.
 */
const LEGACY_INTENT_ALIASES = ['update_stock', 'help'] as const;

const VALID_INTENTS: Set<string> = new Set<string>([
  ...INVENTORY_TOOLS.flatMap((t) => ('function' in t && t.function?.name ? [t.function.name] : [])),
  ...LEGACY_INTENT_ALIASES,
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
