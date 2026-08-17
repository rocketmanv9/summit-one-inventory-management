/**
 * Shared AI types used by both the corner ChatBot and the AI Workspace.
 */

import type { IntentType } from '@/lib/chat/intents';
import type { ActionDefinition, ActionResult } from '@/lib/chat/actions';
import type { DraftPoPreviewResult } from '@/lib/ai/draft-po-preview';

// ─── Intent Classification ────────────────────────────────────────────

export type ChatIntent = 'READ' | 'MUTATION' | 'ANALYTICS' | 'WORKFLOW';

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
  'print_labels',
  'list_receipts',
  'list_reservations',
  'list_categories',
  'global_search',
  'inventory_summary',
  'help',
  'navigate',
]);

/** Server-side analytics tools — executed on the API route, not client-side */
const ANALYTICS_INTENTS = new Set([
  'query_inventory_summary',
  'query_stock_valuation',
  'query_low_stock_report',
  'query_dead_stock',
  'query_velocity_analysis',
  'query_movement_summary',
  'query_reorder_suggestions',
  'query_forecast',
  'query_inventory_turnover',
  'query_po_status',
]);

/** Workflow tools — multi-step operations with dry-run support */
const WORKFLOW_INTENTS = new Set([
  'workflow_auto_reorder',
  'workflow_stock_rebalance',
  'smart_stock_receive',
  'smart_add_location',
  'smart_register_asset',
  'search_vendors_online',
  'set_preferred_vendor',
  'enrich_vendor',
  'enrich_item',
  'query_reservations',
  'query_asset_value',
  'draft_purchase_request',
  'extract_document',
  'list_pending_apparel_orders',
  'approve_apparel_order',
  'reject_apparel_order',
  'semantic_search',
  'purchasing_assistant',
]);

export function classifyIntent(intent: IntentType | string): ChatIntent {
  if (ANALYTICS_INTENTS.has(intent)) return 'ANALYTICS';
  if (WORKFLOW_INTENTS.has(intent)) return 'WORKFLOW';
  if (READ_INTENTS.has(intent as IntentType)) return 'READ';
  return 'MUTATION';
}

// ─── AI Data Display (server-side query results) ─────────────────────

export type AiDataDisplay =
  | AiMetricDisplay
  | AiTableDisplay
  | AiChartDisplay
  | AiDashboardLinkDisplay
  | AiPoDraftDisplay
  | AiItemNotFoundDisplay;

export interface AiMetricDisplay {
  displayType: 'metric';
  label: string;
  value: string | number;
  unit?: string;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  secondaryMetrics?: Array<{ label: string; value: string | number }>;
}

export interface AiTableDisplay {
  displayType: 'table';
  columns: Array<{ key: string; label: string }>;
  rows: Record<string, any>[];
  totalRows?: number;
}

export interface AiChartDisplay {
  displayType: 'chart';
  chartType: 'bar' | 'horizontal_bar';
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    color?: string;
  }>;
}

export interface AiDashboardLinkDisplay {
  displayType: 'dashboard_link';
  dashboardId: string;
  dashboardName: string;
}

/**
 * A reviewable Draft-PO card (sprint item 03). Carries the full item-02
 * `draft_po_preview` payload so the chat can render an interactive card with
 * editable lines and a one-tap "Create PO" button (wired to the existing
 * /api/ai/execute-action create_po bridge). `preview` is the verbatim
 * DraftPoPreviewResult from @/lib/ai/draft-po-preview.
 */
export interface AiPoDraftDisplay {
  displayType: 'po_draft';
  preview: DraftPoPreviewResult;
}

/**
 * Item-not-found grace card (procure playbook, sprint item 05). When the user
 * asks to buy something that isn't in the catalog yet, recommend_vendor_for_item
 * returns resolved:false and Isabelle renders this inline instead of dead-ending.
 * The card offers a single "Add '{name}' & keep going" tap that fires the
 * add-and-continue message — the LLM playbook then runs add_item → recommend →
 * draft_po_preview so the buyer never has to leave chat to create the item first.
 */
export interface AiItemNotFoundDisplay {
  displayType: 'item_not_found';
  /** The raw thing the user typed ("wheelstops", "10 wheelstops"). */
  itemRef: string;
  /** A cleaned display name for the item, if we could derive one. */
  itemName?: string;
  /** Optional qty parsed from the ask, so the follow-up keeps the number. */
  qty?: number;
}

// ─── Tool Error Contract ─────────────────────────────────────────────

export interface ToolError {
  code: 'missing_param' | 'not_found' | 'validation' | 'conflict' | 'upstream' | 'internal';
  message: string;
  missingFields?: string[];
  suggestions?: string[];
}

// ─── Tool Governance ─────────────────────────────────────────────────

export interface ToolGovernance {
  name: string;
  riskLevel: 'low' | 'medium' | 'high';
  requiresConfirmation: boolean;
  requiresIdempotency: boolean;
  readAfterWrite: boolean;
  auditEventType?: string;
  permissionsRequired?: string[];
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
  /** Custom label for the navigation button (e.g. "View Vendors"). Defaults to "Go to page". */
  navigateLabel?: string;
  /** When true, force-show the nav button. When absent, only shown for mutation results (status='success'). */
  showNavigation?: boolean;
  isConfirm?: boolean;
  /** When a MUTATION is proposed, the message carries the action for preview */
  action?: ChatAction;
  /** When a server-side query returns structured data, the message carries it for rich rendering */
  dataDisplay?: AiDataDisplay;
  /** Base64 data URL of an attached image */
  imageUrl?: string;
  /** Confidence score (0–1) estimated from response content and tool results */
  confidence?: number;
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
  mode?: 'corner' | 'workspace' | 'panel';
  pageContext?: PageContext;
  onAssistantMessage?: (text: string) => void;
}

// ─── Quick Actions ────────────────────────────────────────────────────

export interface QuickAction {
  label: string;
  message: string;
  /**
   * When true, the chip pre-fills the input with `message` and focuses it
   * instead of sending immediately — for open-ended starters like "I need …"
   * that the user finishes typing (e.g. "I need 10 wheelstops").
   */
  fill?: boolean;
}

export const QUICK_ACTIONS: Record<string, QuickAction[]> = {
  '/inventory/stock': [
    { label: 'Low stock', message: 'Show low stock items' },
    { label: 'Adjust stock', message: 'Adjust stock balance' },
    { label: 'Check stock', message: 'Check stock levels' },
    { label: 'Turnover', message: 'What is my inventory turnover?' },
    { label: 'Dead stock', message: 'Show dead stock report' },
  ],
  '/inventory/vendors': [
    { label: 'Add vendor', message: 'Add a vendor' },
    { label: 'List vendors', message: 'List vendors' },
  ],
  '/inventory/items': [
    { label: 'Add item', message: 'Add a catalog item' },
    { label: 'List items', message: 'List items' },
    { label: 'Velocity', message: 'Show item velocity analysis' },
    { label: 'Categories', message: 'List categories' },
    { label: 'Add category', message: 'Add a category' },
  ],
  '/inventory/purchasing': [
    { label: 'Create PO', message: 'Create a purchase order' },
    { label: 'List POs', message: 'List purchase orders' },
    { label: 'Late orders', message: 'Show late orders' },
    { label: 'Auto-reorder', message: 'Auto-reorder low stock items' },
    { label: 'PO status', message: 'Show PO status summary' },
  ],
  '/inventory/locations': [
    { label: 'Add location', message: 'Add a location' },
    { label: 'List locations', message: 'List locations' },
  ],
  '/inventory/transfers': [
    { label: 'New transfer', message: 'Create a transfer' },
    { label: 'List transfers', message: 'List transfers' },
    { label: 'Rebalance', message: 'Suggest stock rebalance across locations' },
  ],
  '/inventory/assets': [
    { label: 'New asset', message: 'Create an asset' },
    { label: 'List assets', message: 'List assets' },
    { label: 'Print labels', message: 'Print labels for all assets' },
  ],
  '/inventory/reservations': [
    { label: 'Reserve stock', message: 'Create a reservation' },
    { label: 'List reservations', message: 'Show reservations' },
    { label: 'Release reservation', message: 'Release a reservation' },
  ],
  '/inventory/categories': [
    { label: 'List categories', message: 'List categories' },
    { label: 'Add category', message: 'Add a category' },
  ],
  '/dashboard': [
    { label: 'KPIs', message: 'Show me inventory KPIs' },
    { label: 'Low stock', message: 'Show low stock items' },
    { label: 'Reorder', message: 'What should I reorder?' },
    { label: 'Valuation', message: "What's my total inventory value?" },
  ],
  '/ai': [
    { label: 'I need…', message: 'I need ', fill: true },
    { label: 'Who sells…', message: 'Who sells ', fill: true },
    { label: 'Low stock', message: "What's running low?" },
    { label: 'Reorder', message: 'What should I reorder?' },
    { label: 'KPIs', message: "How's inventory looking?" },
  ],
};
