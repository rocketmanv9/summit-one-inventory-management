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
  return tools.filter((t) => !('function' in t && ADMIN_ONLY_TOOLS.has(t.function.name)));
}

/**
 * Server-side guard: check if a tool can be executed by the given role.
 */
export function canExecuteTool(toolName: string, role: UserRole): boolean {
  if (role === 'admin') return true;
  return !ADMIN_ONLY_TOOLS.has(toolName);
}

// ─── Governance Metadata Registry ─────────────────────────────────────

import type { ToolGovernance } from './types';

export const TOOL_GOVERNANCE: Record<string, ToolGovernance> = {
  // High-risk mutations
  adjust_stock: { name: 'adjust_stock', riskLevel: 'high', requiresConfirmation: true, requiresIdempotency: true, readAfterWrite: true, auditEventType: 'stock.adjusted' },
  adjust_stock_delta: { name: 'adjust_stock_delta', riskLevel: 'high', requiresConfirmation: true, requiresIdempotency: true, readAfterWrite: true, auditEventType: 'stock.adjusted' },
  delete_vendor: { name: 'delete_vendor', riskLevel: 'high', requiresConfirmation: true, requiresIdempotency: true, readAfterWrite: false, auditEventType: 'vendor.deleted' },
  delete_item: { name: 'delete_item', riskLevel: 'high', requiresConfirmation: true, requiresIdempotency: true, readAfterWrite: false, auditEventType: 'item.deleted' },
  approve_apparel_order: { name: 'approve_apparel_order', riskLevel: 'high', requiresConfirmation: true, requiresIdempotency: true, readAfterWrite: false, auditEventType: 'apparel.approved' },
  reject_apparel_order: { name: 'reject_apparel_order', riskLevel: 'high', requiresConfirmation: true, requiresIdempotency: false, readAfterWrite: false, auditEventType: 'apparel.rejected' },
  workflow_auto_reorder: { name: 'workflow_auto_reorder', riskLevel: 'high', requiresConfirmation: true, requiresIdempotency: true, readAfterWrite: false, auditEventType: 'workflow.auto_reorder' },
  workflow_stock_rebalance: { name: 'workflow_stock_rebalance', riskLevel: 'high', requiresConfirmation: true, requiresIdempotency: true, readAfterWrite: false, auditEventType: 'workflow.rebalance' },

  // Medium-risk mutations
  add_vendor: { name: 'add_vendor', riskLevel: 'medium', requiresConfirmation: false, requiresIdempotency: true, readAfterWrite: false, auditEventType: 'vendor.created' },
  add_item: { name: 'add_item', riskLevel: 'medium', requiresConfirmation: false, requiresIdempotency: true, readAfterWrite: false, auditEventType: 'item.created' },
  update_vendor: { name: 'update_vendor', riskLevel: 'medium', requiresConfirmation: true, requiresIdempotency: true, readAfterWrite: false, auditEventType: 'vendor.updated' },
  update_item: { name: 'update_item', riskLevel: 'medium', requiresConfirmation: true, requiresIdempotency: true, readAfterWrite: false, auditEventType: 'item.updated' },
  create_po: { name: 'create_po', riskLevel: 'medium', requiresConfirmation: false, requiresIdempotency: true, readAfterWrite: false, auditEventType: 'po.created' },
  draft_restock_order: { name: 'draft_restock_order', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  confirm_restock_order: { name: 'confirm_restock_order', riskLevel: 'high', requiresConfirmation: true, requiresIdempotency: true, readAfterWrite: false, auditEventType: 'po.created' },
  create_transfer: { name: 'create_transfer', riskLevel: 'medium', requiresConfirmation: true, requiresIdempotency: true, readAfterWrite: false, auditEventType: 'transfer.created' },
  create_asset: { name: 'create_asset', riskLevel: 'medium', requiresConfirmation: true, requiresIdempotency: true, readAfterWrite: false, auditEventType: 'asset.created' },
  issue_inventory: { name: 'issue_inventory', riskLevel: 'medium', requiresConfirmation: true, requiresIdempotency: true, readAfterWrite: false, auditEventType: 'inventory.issued' },
  create_reservation: { name: 'create_reservation', riskLevel: 'medium', requiresConfirmation: true, requiresIdempotency: true, readAfterWrite: false, auditEventType: 'reservation.created' },
  release_reservation: { name: 'release_reservation', riskLevel: 'medium', requiresConfirmation: true, requiresIdempotency: false, readAfterWrite: false, auditEventType: 'reservation.released' },
  add_location: { name: 'add_location', riskLevel: 'medium', requiresConfirmation: false, requiresIdempotency: true, readAfterWrite: false, auditEventType: 'location.created' },
  add_category: { name: 'add_category', riskLevel: 'medium', requiresConfirmation: false, requiresIdempotency: true, readAfterWrite: false, auditEventType: 'category.created' },
  set_preferred_vendor: { name: 'set_preferred_vendor', riskLevel: 'medium', requiresConfirmation: false, requiresIdempotency: true, readAfterWrite: false },

  // Low-risk reads/queries
  list_vendors: { name: 'list_vendors', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  list_items: { name: 'list_items', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  check_stock: { name: 'check_stock', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  low_stock: { name: 'low_stock', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  list_pos: { name: 'list_pos', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  list_locations: { name: 'list_locations', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  list_transfers: { name: 'list_transfers', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  list_assets: { name: 'list_assets', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  list_receipts: { name: 'list_receipts', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  list_reservations: { name: 'list_reservations', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  list_categories: { name: 'list_categories', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  global_search: { name: 'global_search', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  inventory_summary: { name: 'inventory_summary', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  navigate: { name: 'navigate', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  help: { name: 'help', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  query_cycle_counts: { name: 'query_cycle_counts', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  query_cancelled_transfers: { name: 'query_cancelled_transfers', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  query_stock_movements: { name: 'query_stock_movements', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  query_stock_by_location: { name: 'query_stock_by_location', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
  query_integrations: { name: 'query_integrations', riskLevel: 'low', requiresConfirmation: false, requiresIdempotency: false, readAfterWrite: false },
};
