/**
 * Tool Execution Node — Executes selected tools via the registry.
 */
import type { WorkflowState } from '../graph-types';
import { toolRegistry } from '../../tool-registry';

export async function executeToolsNode(state: WorkflowState): Promise<Partial<WorkflowState>> {
  if (state.permissionDenied || state.selectedTools.length === 0) {
    return { nodesVisited: [...state.nodesVisited, 'execute_tools'] };
  }

  const results: WorkflowState['toolResults'] = [];

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
  return {
    toolResults: results,
    dataDisplay: lastDisplay,
    nodesVisited: [...state.nodesVisited, 'execute_tools'],
  };
}
