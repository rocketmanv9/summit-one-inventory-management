/**
 * Tool Governance — Role-based tool filtering
 * Gates destructive tools behind admin role.
 */

import type { ChatCompletionTool } from 'openai/resources/chat/completions';

// Tools that require admin role
export const ADMIN_ONLY_TOOLS = new Set([
  'delete_vendor',
  'delete_item',
  'workflow_auto_reorder',  // non-dry-run mode
  'workflow_stock_rebalance',
  'delete_dashboard',
  'approve_apparel_order',
  'reject_apparel_order',
]);

export type UserRole = 'admin' | 'authenticated';

/**
 * Resolve the user's role from the local_users table.
 * The local_users table uses 'admin' for elevated users and 'member' (default) for regular users.
 * Any non-admin role is mapped to 'authenticated'.
 */
export async function resolveUserRole(
  supabase: any,
  userId: string,
  tenantId: string
): Promise<UserRole> {
  try {
    const { data } = await supabase
      .from('local_users')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .single();

    if (data?.role === 'admin') return 'admin';
    return 'authenticated';
  } catch {
    return 'authenticated';
  }
}

/**
 * Filter OpenAI tool definitions based on user role.
 * Admin gets all tools; non-admin gets tools minus ADMIN_ONLY_TOOLS.
 */
export function filterToolsForRole(
  tools: ChatCompletionTool[],
  role: UserRole
): ChatCompletionTool[] {
  if (role === 'admin') return tools;
  return tools.filter((t) => !ADMIN_ONLY_TOOLS.has(t.function.name));
}

/**
 * Server-side guard: check if a tool can be executed by the given role.
 */
export function canExecuteTool(toolName: string, role: UserRole): boolean {
  if (role === 'admin') return true;
  return !ADMIN_ONLY_TOOLS.has(toolName);
}
