/**
 * Permission Check Node
 */
import type { WorkflowState } from '../graph-types';
import { toolRegistry } from '../../tool-registry';

export async function checkPermissionsNode(state: WorkflowState): Promise<Partial<WorkflowState>> {
  for (const toolName of state.selectedTools) {
    if (!toolRegistry.canExecute(toolName, state.userRole)) {
      return {
        permissionDenied: `You don't have permission to use ${toolName}. Contact an admin.`,
        nodesVisited: [...state.nodesVisited, 'check_permissions'],
      };
    }
  }
  return { permissionDenied: null, nodesVisited: [...state.nodesVisited, 'check_permissions'] };
}
