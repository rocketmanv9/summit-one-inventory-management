/**
 * Shared Action Executor
 * Builds ChatAction previews and executes confirmed actions via the existing action system.
 * Used by both corner ChatBot and AI Workspace.
 */

import type { IntentType } from '@/lib/chat/intents';
import { getActionDefinition, type ActionDefinition } from '@/lib/chat/actions';
import type { ChatAction } from './types';
import { classifyIntent } from './types';

/**
 * Build a human-readable title from an intent type.
 */
function intentToTitle(intent: IntentType): string {
  const titles: Partial<Record<IntentType, string>> = {
    add_vendor: 'Add Vendor',
    update_vendor: 'Update Vendor',
    delete_vendor: 'Delete Vendor',
    add_item: 'Add Catalog Item',
    update_item: 'Update Catalog Item',
    delete_item: 'Delete Catalog Item',
    adjust_stock: 'Adjust Stock Balance',
    update_stock: 'Adjust Stock Balance',
    issue_inventory: 'Issue Inventory',
    create_po: 'Create Purchase Order',
    create_transfer: 'Create Transfer',
    create_asset: 'Register Asset',
    add_location: 'Add Location',
  };
  return titles[intent] || intent.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build a brief summary of what the action will do, based on resolved params.
 */
function buildSummary(intent: IntentType, params: Record<string, string>): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (value && key !== 'confirm') {
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      parts.push(`${label}: ${value}`);
    }
  }

  if (parts.length === 0) return 'No parameters extracted yet — will prompt interactively.';
  return parts.join(', ');
}

/**
 * Builds a ChatAction preview from an intent + resolved params.
 * Does NOT execute — just proposes.
 */
export function buildActionPreview(
  intent: IntentType,
  params: Record<string, string>
): ChatAction {
  return {
    id: crypto.randomUUID(),
    intent,
    intentType: classifyIntent(intent),
    title: intentToTitle(intent),
    summary: buildSummary(intent, params),
    params,
    status: 'proposed',
    createdAt: new Date(),
  };
}

/**
 * Executes a confirmed ChatAction via the existing action.execute() system.
 * Returns the action with updated status + result.
 */
export async function executeAction(action: ChatAction): Promise<ChatAction> {
  const actionDef = await getActionDefinition(action.intent);
  if (!actionDef) {
    return {
      ...action,
      status: 'failed',
      result: { success: false, message: `No action definition found for "${action.intent}"` },
    };
  }

  try {
    const result = await actionDef.execute(action.params);
    return {
      ...action,
      status: 'completed',
      result,
    };
  } catch (err: any) {
    return {
      ...action,
      status: 'failed',
      result: { success: false, message: err.message || 'Unknown error' },
    };
  }
}
