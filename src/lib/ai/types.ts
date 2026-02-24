/**
 * Shared AI types used by both the corner ChatBot and the AI Workspace.
 */

import type { IntentType } from '@/lib/chat/intents';
import type { ActionDefinition, ActionResult } from '@/lib/chat/actions';

// ─── Intent Classification ────────────────────────────────────────────

export type ChatIntent = 'READ' | 'MUTATION';

const READ_INTENTS: Set<IntentType> = new Set([
  'list_vendors',
  'list_items',
  'check_stock',
  'low_stock',
  'list_pos',
  'late_orders',
  'list_locations',
  'list_transfers',
  'list_assets',
  'list_receipts',
  'inventory_summary',
  'help',
  'navigate',
]);

export function classifyIntent(intent: IntentType): ChatIntent {
  return READ_INTENTS.has(intent) ? 'READ' : 'MUTATION';
}

// ─── Chat Action (proposal → execution lifecycle) ─────────────────────

export type ChatActionStatus = 'proposed' | 'confirmed' | 'executing' | 'completed' | 'failed';

export interface ChatAction {
  id: string;
  intent: IntentType;
  intentType: ChatIntent;
  title: string;
  summary: string;
  params: Record<string, string>;
  status: ChatActionStatus;
  result?: ActionResult;
  createdAt: Date;
}

// ─── Message ──────────────────────────────────────────────────────────

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  status?: 'success' | 'error' | 'executing';
  selectOptions?: Array<{ label: string; value: string }>;
  navigateTo?: string;
  isConfirm?: boolean;
  /** When a MUTATION is proposed, the message carries the action for preview */
  action?: ChatAction;
}

// ─── Active Flow ──────────────────────────────────────────────────────

export interface ActiveFlow {
  action: ActionDefinition;
  currentStepIndex: number;
  collectedParams: Record<string, string>;
}

// ─── Page Context ─────────────────────────────────────────────────────

export interface PageContext {
  currentPage: string;
  selectedEntityId?: string;
  activeFilters?: Record<string, string>;
}

// ─── Hook Options ─────────────────────────────────────────────────────

export interface AiChatOptions {
  mode?: 'corner' | 'workspace';
  pageContext?: PageContext;
}

// ─── Quick Actions ────────────────────────────────────────────────────

export interface QuickAction {
  label: string;
  message: string;
}

export const QUICK_ACTIONS: Record<string, QuickAction[]> = {
  '/inventory/stock': [
    { label: 'Low stock', message: 'Show low stock items' },
    { label: 'Adjust stock', message: 'Adjust stock balance' },
    { label: 'Check stock', message: 'Check stock levels' },
  ],
  '/inventory/vendors': [
    { label: 'Add vendor', message: 'Add a vendor' },
    { label: 'List vendors', message: 'List vendors' },
  ],
  '/inventory/items': [
    { label: 'Add item', message: 'Add a catalog item' },
    { label: 'List items', message: 'List items' },
  ],
  '/inventory/purchasing': [
    { label: 'Create PO', message: 'Create a purchase order' },
    { label: 'List POs', message: 'List purchase orders' },
    { label: 'Late orders', message: 'Show late orders' },
  ],
  '/inventory/locations': [
    { label: 'Add location', message: 'Add a location' },
    { label: 'List locations', message: 'List locations' },
  ],
  '/inventory/transfers': [
    { label: 'New transfer', message: 'Create a transfer' },
    { label: 'List transfers', message: 'List transfers' },
  ],
  '/inventory/assets': [
    { label: 'New asset', message: 'Create an asset' },
    { label: 'List assets', message: 'List assets' },
  ],
  '/inventory/receiving': [
    { label: 'List receipts', message: 'List receipts' },
  ],
  '/dashboard': [
    { label: 'Summary', message: 'Show inventory summary' },
    { label: 'Low stock', message: 'Show low stock items' },
  ],
};
