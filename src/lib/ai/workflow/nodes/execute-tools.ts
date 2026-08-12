/**
 * Tool Execution Node — Executes selected tools via the registry.
 *
 * Builds tool params from resolved entities so tools receive
 * entity context (IDs, names) rather than empty params.
 */
import type { ChatGraphState, ChatGraphUpdate, ToolResultEntry, ResolvedEntity } from '../graph-types';
import { toolRegistry } from '../../tool-registry';

/** Map entity types to the tool parameter keys they should populate. */
const ENTITY_PARAM_MAP: Record<string, string> = {
  item: 'catalog_item_id',
  vendor: 'vendor_id',
  location: 'location_id',
  asset: 'asset_id',
};

/**
 * Build tool params from resolved entities and user message context.
 */
function buildParamsFromEntities(
  entities: ResolvedEntity[],
  userMessage: string
): Record<string, any> {
  const params: Record<string, any> = {};

  for (const entity of entities) {
    const paramKey = ENTITY_PARAM_MAP[entity.entity_type];
    if (paramKey && !params[paramKey]) {
      params[paramKey] = entity.entity_id;
    }
    // Also pass the canonical name so tools can reference it
    if (!params[`${entity.entity_type}_name`]) {
      params[`${entity.entity_type}_name`] = entity.canonical_name;
    }
  }

  // Pass the original message so tools can extract additional context
  if (userMessage) {
    params._user_message = userMessage;
  }

  return params;
}

export async function executeToolsNode(state: ChatGraphState): Promise<ChatGraphUpdate> {
  if (state.permissionDenied || state.selectedTools.length === 0) {
    return { nodesVisited: ['execute_tools'] };
  }

  const derivedParams = buildParamsFromEntities(state.resolvedEntities, state.userMessage);
  const results: ToolResultEntry[] = [];

  for (const toolName of state.selectedTools) {
    try {
      const result = await toolRegistry.execute(toolName, derivedParams, state.serverToolCtx);
      results.push({ name: toolName, result, success: true });
    } catch (err: any) {
      results.push({
        name: toolName,
        result: { text: `Error: ${err.message}`, dataDisplay: { displayType: 'metric', label: 'Error', value: err.message } },
        success: false,
      });
    }
  }

  const lastDisplay = results.find((r) => r.result.dataDisplay)?.result.dataDisplay || null;
  const anyFailed = results.some((r) => !r.success);
  const nextRound = state.toolRound + 1;

  return {
    toolResults: results,
    dataDisplay: lastDisplay,
    toolRound: nextRound,
    needsMoreTools: anyFailed && nextRound < state.maxToolRounds,
    nodesVisited: ['execute_tools'],
  };
}
