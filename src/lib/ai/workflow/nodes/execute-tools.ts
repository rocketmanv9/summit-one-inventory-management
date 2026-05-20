/**
 * Tool Execution Node — Executes selected tools via the registry.
 */
import type { ChatGraphState, ChatGraphUpdate, ToolResultEntry } from '../graph-types';
import { toolRegistry } from '../../tool-registry';

export async function executeToolsNode(state: ChatGraphState): Promise<ChatGraphUpdate> {
  if (state.permissionDenied || state.selectedTools.length === 0) {
    return { nodesVisited: ['execute_tools'] };
  }

  const results: ToolResultEntry[] = [];

  for (const toolName of state.selectedTools) {
    try {
      const result = await toolRegistry.execute(toolName, {}, state.serverToolCtx);
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
