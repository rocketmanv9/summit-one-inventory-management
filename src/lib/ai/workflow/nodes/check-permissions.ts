/**
 * Permission Check Node
 */
import type { ChatGraphState, ChatGraphUpdate } from '../graph-types';
import { toolRegistry } from '../../tool-registry';

export async function checkPermissionsNode(state: ChatGraphState): Promise<ChatGraphUpdate> {
  for (const toolName of state.selectedTools) {
    if (!toolRegistry.canExecute(toolName, state.userRole)) {
      return {
        permissionDenied: `You don't have permission to use ${toolName}. Contact an admin.`,
        nodesVisited: ['check_permissions'],
      };
    }
  }
  return { permissionDenied: null, nodesVisited: ['check_permissions'] };
}
