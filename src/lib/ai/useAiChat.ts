'use client';

/**
 * useAiChat — Shared AI chat hook used by both the corner ChatBot and AI Workspace.
 * Extracted from the original ChatBot.tsx monolith.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { parseIntent } from '@/lib/chat/intents';
import type { IntentType } from '@/lib/chat/intents';
import {
  getActionDefinition,
  resolveNavigation,
  type ActionDefinition,
} from '@/lib/chat/actions';
import { sendToAI, streamAiChat, getConversation, type ChatMessage } from '@/lib/ai/client';
import { parseAIResponse } from '@/lib/ai/parse-response';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import type { Message, ActiveFlow, ChatAction, AiChatOptions } from './types';
import { classifyIntent } from './types';
import { buildActionPreview, executeAction } from './executeAction';
import { isFuzzyConfirm, isFuzzyCancel } from './fuzzy-confirm';
import { TOOL_GOVERNANCE } from './tool-governance';
import { detectCorrection } from './correction-detect';
import {
  startFlowMetric,
  recordQuestion,
  recordAutoFill,
  recordCorrection,
  completeMetric,
  type FlowMetric,
} from './friction-metrics';

// ─── AI param → action field resolution ────────────────────────────────

type EntityType = 'item' | 'location' | 'vendor';

interface ParamMapping {
  actionField: string;
  entityType?: EntityType;
}

const AI_PARAM_MAP: Partial<Record<IntentType, Record<string, ParamMapping>>> = {
  adjust_stock: {
    item:     { actionField: 'catalog_item_id', entityType: 'item' },
    location: { actionField: 'location_id', entityType: 'location' },
    quantity: { actionField: 'new_qty' },
    reason:   { actionField: 'reason' },
  },
  adjust_stock_delta: {
    item:     { actionField: 'catalog_item_id', entityType: 'item' },
    location: { actionField: 'location_id', entityType: 'location' },
    delta:    { actionField: 'delta' },
    reason:   { actionField: 'reason' },
    notes:    { actionField: 'notes' },
  },
  check_stock: {
    item: { actionField: 'catalog_item_id', entityType: 'item' },
  },
  issue_inventory: {
    item:     { actionField: 'catalog_item_id', entityType: 'item' },
    location: { actionField: 'location_id', entityType: 'location' },
    quantity: { actionField: 'quantity' },
  },
  create_transfer: {
    from_location: { actionField: 'from_location_id', entityType: 'location' },
    to_location:   { actionField: 'to_location_id', entityType: 'location' },
    item:          { actionField: 'catalog_item_id', entityType: 'item' },
    quantity:      { actionField: 'quantity' },
  },
  create_asset: {
    item:     { actionField: 'catalog_item_id', entityType: 'item' },
    location: { actionField: 'location_id', entityType: 'location' },
  },
  delete_vendor: {
    name: { actionField: 'vendor_id', entityType: 'vendor' },
  },
  delete_item: {
    name: { actionField: 'catalog_item_id', entityType: 'item' },
  },
  update_vendor: {
    name: { actionField: 'vendor_id', entityType: 'vendor' },
  },
  update_item: {
    name: { actionField: 'catalog_item_id', entityType: 'item' },
  },
  create_reservation: {
    item:     { actionField: 'catalog_item_id', entityType: 'item' },
    location: { actionField: 'location_id', entityType: 'location' },
    quantity: { actionField: 'quantity' },
  },
  add_item: {
    name:            { actionField: 'name' },
    uom_term_id: { actionField: 'uom_term_id' },
    tracking_mode:   { actionField: 'tracking_mode' },
  },
  add_location: {
    name: { actionField: 'name' },
  },
  add_category: {
    name: { actionField: 'name' },
  },
  create_po: {
    vendor: { actionField: 'vendor_id', entityType: 'vendor' },
  },
};

const SMART_DEFAULTS: Partial<Record<IntentType, Record<string, string>>> = {
  adjust_stock:       { reason: 'other' },
  adjust_stock_delta: { reason: 'other' },
  issue_inventory:    { issued_to_type: 'other' },
  add_item:           { tracking_mode: 'fungible' },
  create_reservation: { allocation_type: 'other' },
};

function fuzzyMatch(
  query: string,
  entities: Array<{ name: string; code?: string; sku?: string; id: string }>
): string | undefined {
  const q = query.toLowerCase().trim();
  if (!q) return undefined;

  const exactName = entities.find((e) => e.name.toLowerCase() === q);
  if (exactName) return exactName.id;

  const exactCode = entities.find(
    (e) => (e.code && e.code.toLowerCase() === q) || (e.sku && e.sku.toLowerCase() === q)
  );
  if (exactCode) return exactCode.id;

  const nameContains = entities.find((e) => e.name.toLowerCase().includes(q));
  if (nameContains) return nameContains.id;

  const queryContains = entities.find((e) => q.includes(e.name.toLowerCase()));
  if (queryContains) return queryContains.id;

  return undefined;
}

function inferReasonCode(text: string): string {
  const t = text.toLowerCase();
  if (/\b(lost|missing|gone|can'?t find|disappeared)\b/.test(t)) return 'theft';
  if (/\b(damag\w*|broke\w*|ruined|defective)\b/.test(t)) return 'damage';
  if (/\b(expir\w*|past date|shelf life|stale)\b/.test(t)) return 'expiration';
  if (/\b(count\b|physical count|cycle count|actual\b|shows)\b/.test(t)) return 'count_variance';
  return 'other';
}

async function resolveAIParams(
  intent: IntentType,
  aiParams: Record<string, string>,
  originalText?: string
): Promise<{ resolved: Record<string, string>; displayNames: Record<string, string> }> {
  const mapping = AI_PARAM_MAP[intent];
  if (!mapping) return { resolved: { ...aiParams }, displayNames: { ...aiParams } };

  const entityCache: Partial<Record<EntityType, Array<{ name: string; code?: string; sku?: string; id: string }>>> = {};

  async function loadEntities(type: EntityType) {
    if (entityCache[type]) return entityCache[type]!;

    let entities: Array<{ name: string; code?: string; sku?: string; id: string }> = [];
    try {
      if (type === 'item') {
        const items = await InventoryRPC.getCatalogItems({ active: true });
        entities = items.map((i) => ({ name: i.name, sku: i.sku, id: i.id }));
      } else if (type === 'location') {
        const locations = await InventoryRPC.getLocations({ active: true });
        entities = locations.map((l: any) => ({ name: l.name, id: l.id }));
      } else if (type === 'vendor') {
        const vendors = await SupplyChainRPC.getVendors();
        entities = vendors.map((v) => ({ name: v.name, code: v.code ?? undefined, id: v.id }));
      }
    } catch {
      // If load fails, return empty — params will be omitted and flow prompts interactively
    }

    entityCache[type] = entities;
    return entities;
  }

  const resolved: Record<string, string> = {};
  const displayNames: Record<string, string> = {};

  for (const [aiKey, aiValue] of Object.entries(aiParams)) {
    const map = mapping[aiKey];
    if (!map) {
      resolved[aiKey] = aiValue;
      displayNames[aiKey] = aiValue;
      continue;
    }

    if (map.entityType) {
      const entities = await loadEntities(map.entityType);
      const matchedId = fuzzyMatch(aiValue, entities);
      if (matchedId) {
        resolved[map.actionField] = matchedId;
        const matchedEntity = entities.find((e) => e.id === matchedId);
        displayNames[map.actionField] = matchedEntity?.name ?? aiValue;
      }
    } else {
      resolved[map.actionField] = aiValue;
      displayNames[map.actionField] = aiValue;
    }
  }

  // Infer reason code from the user's original message when not explicitly provided
  if (
    (intent === 'adjust_stock' || intent === 'adjust_stock_delta') &&
    !resolved.reason &&
    originalText
  ) {
    resolved.reason = inferReasonCode(originalText);
    displayNames.reason = resolved.reason;
  }

  return { resolved, displayNames };
}

// ─── Modal-preferred intents (open modal instead of step flow) ────────

const MODAL_INTENTS = new Set<IntentType>(['add_vendor']);

// ─── Hook ─────────────────────────────────────────────────────────────

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content:
    "Hey! I'm Isabelle, your inventory specialist. I can help you manage stock, vendors, purchase orders, and more — or just ask me how things are looking and I'll pull up the data. What can I help with today?",
  timestamp: new Date(),
};

export function useAiChat(options?: AiChatOptions) {
  const mode = options?.mode ?? 'corner';
  const router = useRouter();

  // ── State ──────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeFlow, setActiveFlow] = useState<ActiveFlow | null>(null);
  const [aiAvailable, setAiAvailable] = useState(true);
  const [actions, setActions] = useState<ChatAction[]>([]);

  const [isThinking, setIsThinking] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);

  // Persistent conversation ID
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Vendor modal state
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [vendorModalInitialName, setVendorModalInitialName] = useState<string | undefined>();

  // Refs
  const aiFailCount = useRef(0);
  const conversationHistory = useRef<ChatMessage[]>([]);
  const activeActionId = useRef<string | null>(null);
  const streamingMsgId = useRef<string | null>(null);
  const lastCancelledFlow = useRef<ActiveFlow | null>(null);
  const lastFlowParams = useRef<{ intent: IntentType; params: Record<string, string> } | null>(null);
  const flowMetric = useRef<FlowMetric | null>(null);
  const vendorModalSubmitted = useRef(false);

  // ── Load conversation from localStorage on mount ──────────────────
  useEffect(() => {
    const storedId = localStorage.getItem('ai-conversation');
    if (storedId) {
      setConversationId(storedId);
      // Load history from API
      getConversation(storedId).then((conv) => {
        if (!conv || !conv.messages || conv.messages.length === 0) return;
        const restored: Message[] = [WELCOME_MESSAGE];
        const historyForApi: ChatMessage[] = [];
        for (const m of conv.messages) {
          if (m.role === 'user' || m.role === 'assistant') {
            restored.push({
              id: m.id,
              role: m.role,
              content: m.content || '',
              timestamp: new Date(m.created_at),
              dataDisplay: m.data_display || undefined,
              imageUrl: m.image_url || undefined,
            });
            historyForApi.push({
              role: m.role as 'user' | 'assistant',
              content: m.content || '',
              imageUrl: m.image_url || undefined,
            });
          }
        }
        setMessages(restored);
        conversationHistory.current = historyForApi;
      }).catch(() => {
        // If load fails, clear stale ID
        localStorage.removeItem('ai-conversation');
        setConversationId(null);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist conversationId to localStorage
  useEffect(() => {
    if (conversationId) {
      localStorage.setItem('ai-conversation', conversationId);
    }
  }, [conversationId]);

  // ── Start new conversation ────────────────────────────────────────
  const startNewConversation = useCallback(() => {
    setConversationId(null);
    localStorage.removeItem('ai-conversation');
    setMessages([WELCOME_MESSAGE]);
    conversationHistory.current = [];
    setActiveFlow(null);
    setActions([]);
  }, []);

  // ── Helpers ─────────────────────────────────────────────────────────

  const addMessage = useCallback(
    (role: 'user' | 'assistant', content: string, extras?: Partial<Message>) => {
      const msg: Message = {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        role,
        content,
        timestamp: new Date(),
        ...extras,
      };
      setMessages((prev) => [...prev, msg]);
      return msg;
    },
    []
  );

  const buildConfirmationMessage = (
    action: ActionDefinition,
    params: Record<string, string>
  ): string => {
    const lines = [`Please confirm — ${action.description}:\n`];

    for (const step of action.steps) {
      if (step.field === 'confirm') continue;
      const value = params[step.field];
      if (!value) continue;

      let displayValue = value;
      if (step.type === 'select' && step.options) {
        const opt = step.options.find((o) => o.value === value);
        if (opt) displayValue = opt.label;
      }

      const label = step.prompt.replace(/\?.*$/, '').replace(/^\w/, (c) => c.toUpperCase());
      lines.push(`  ${label}: ${displayValue}`);
    }

    lines.push('\nType "yes" to confirm or "no" to cancel.');
    return lines.join('\n');
  };

  // ── Advance conversation flow ──────────────────────────────────────

  const advanceFlow = useCallback(
    async (flow: ActiveFlow) => {
      const { action, collectedParams } = flow;
      let { currentStepIndex } = flow;

      while (currentStepIndex < action.steps.length) {
        const step = action.steps[currentStepIndex];
        if (step.type === 'confirm') break;
        if (!collectedParams[step.field]) {
          if (step.required) break;       // required field missing — stop and ask
          currentStepIndex++;             // optional field — auto-skip
          continue;
        }
        currentStepIndex++;
      }

      if (currentStepIndex !== flow.currentStepIndex) {
        flow = { ...flow, currentStepIndex };
        setActiveFlow(flow);
      }

      if (currentStepIndex >= action.steps.length) {
        setIsLoading(true);
        addMessage('assistant', 'Executing...', { status: 'executing' });

        try {
          const result = await action.execute(collectedParams);
          setActiveFlow(null);

          // Sprint 5: Store last successful flow params for carry-forward
          lastFlowParams.current = { intent: action.intent, params: { ...collectedParams } };

          // Sprint 6: Complete metric on success
          if (flowMetric.current) {
            completeMetric(flowMetric.current, 'completed');
            flowMetric.current = null;
          }

          // Update tracked action status if this was a confirmed proposed action
          if (activeActionId.current) {
            const aid = activeActionId.current;
            activeActionId.current = null;
            setActions((prev) =>
              prev.map((a) =>
                a.id === aid
                  ? { ...a, status: (result.success ? 'completed' : 'failed') as any, result }
                  : a
              )
            );
          }

          addMessage('assistant', result.message, {
            status: result.success ? 'success' : 'error',
            navigateTo: result.navigateTo,
          });
        } catch (err: any) {
          const errorMsg = err.message || 'Unknown error';

          // Sprint 4: Check for recoverable "not found" errors
          const notFoundMatch = errorMsg.match(/(?:Item|Location|Vendor)\s+"([^"]+)"\s+not found/i);
          if (notFoundMatch) {
            const badValue = notFoundMatch[1].toLowerCase();
            for (let i = 0; i < flow.currentStepIndex; i++) {
              const step = flow.action.steps[i];
              const collected = flow.collectedParams[step.field]?.toLowerCase();
              if (collected && (collected.includes(badValue) || badValue.includes(collected))) {
                const retryFlow: ActiveFlow = {
                  ...flow,
                  currentStepIndex: i,
                  collectedParams: { ...flow.collectedParams },
                };
                delete retryFlow.collectedParams[step.field];
                setActiveFlow(retryFlow);
                addMessage('assistant', `${errorMsg}. Let's try again — ${step.prompt}`, { status: 'error' });
                setIsLoading(false);
                return;
              }
            }
          }

          // Non-recoverable: clear flow and report
          setActiveFlow(null);

          // Sprint 6: Complete metric on failure
          if (flowMetric.current) {
            completeMetric(flowMetric.current, 'failed');
            flowMetric.current = null;
          }

          // Update tracked action status on error
          if (activeActionId.current) {
            const aid = activeActionId.current;
            activeActionId.current = null;
            setActions((prev) =>
              prev.map((a) =>
                a.id === aid
                  ? { ...a, status: 'failed' as const, result: { success: false, message: errorMsg } }
                  : a
              )
            );
          }

          addMessage(
            'assistant',
            `Something went wrong: ${errorMsg}`,
            { status: 'error' }
          );
        } finally {
          setIsLoading(false);
        }
        return;
      }

      const step = action.steps[currentStepIndex];

      if (step.type === 'confirm') {
        const summary = buildConfirmationMessage(action, collectedParams);
        addMessage('assistant', summary, { isConfirm: true });
        return;
      }

      // Sprint 6: Record question asked
      if (flowMetric.current) recordQuestion(flowMetric.current);

      addMessage('assistant', step.prompt, {
        selectOptions:
          step.type === 'select' && step.options ? step.options : undefined,
      });
    },
    [addMessage]
  );

  // ── Handle flow step response ──────────────────────────────────────

  const handleFlowInput = useCallback(
    async (userInput: string, flow: ActiveFlow) => {
      // Sprint 3: Detect mid-flow corrections ("actually make it 90", "I meant Portland")
      const correction = detectCorrection(userInput, flow);
      if (correction) {
        if (flowMetric.current) recordCorrection(flowMetric.current);
        const updatedFlow: ActiveFlow = {
          ...flow,
          collectedParams: { ...flow.collectedParams, [correction.field]: correction.value },
        };
        setActiveFlow(updatedFlow);
        addMessage(
          'assistant',
          `Updated ${correction.fieldLabel} to "${correction.value}". ${flow.action.steps[flow.currentStepIndex].prompt}`
        );
        return;
      }

      const step = flow.action.steps[flow.currentStepIndex];

      if (step.type === 'confirm') {
        if (isFuzzyConfirm(userInput)) {
          const nextFlow: ActiveFlow = {
            ...flow,
            currentStepIndex: flow.currentStepIndex + 1,
          };
          setActiveFlow(nextFlow);
          await advanceFlow(nextFlow);
          return;
        } else if (isFuzzyCancel(userInput)) {
          lastCancelledFlow.current = flow;
          setActiveFlow(null);
          if (flowMetric.current) { completeMetric(flowMetric.current, 'cancelled'); flowMetric.current = null; }
          addMessage('assistant', 'Cancelled. What else can I help with?');
          return;
        } else {
          addMessage('assistant', 'I didn\'t catch that — type "yes" to confirm or "no" to cancel.');
          return;
        }
      }

      const value = userInput.trim();

      if (!value && !step.required) {
        const nextFlow: ActiveFlow = {
          ...flow,
          currentStepIndex: flow.currentStepIndex + 1,
          collectedParams: { ...flow.collectedParams },
        };
        setActiveFlow(nextFlow);
        await advanceFlow(nextFlow);
        return;
      }

      if (!value && step.required) {
        addMessage('assistant', `This field is required. ${step.prompt}`);
        return;
      }

      if (step.validate) {
        const error = step.validate(value);
        if (error) {
          addMessage('assistant', error);
          return;
        }
      }

      const nextFlow: ActiveFlow = {
        ...flow,
        currentStepIndex: flow.currentStepIndex + 1,
        collectedParams: {
          ...flow.collectedParams,
          [step.field]: value,
        },
      };
      setActiveFlow(nextFlow);
      await advanceFlow(nextFlow);
    },
    [addMessage, advanceFlow]
  );

  // ── Start action flow from intent + params ─────────────────────────

  const startActionFlow = async (
    intentType: IntentType,
    extractedParams: Record<string, string>,
    text: string,
    displayNames?: Record<string, string>
  ) => {
    lastCancelledFlow.current = null;
    // Handle navigation
    if (intentType === 'navigate') {
      const path = resolveNavigation(text);
      if (path) {
        addMessage('assistant', `Taking you there now...`, { navigateTo: path });
        router.push(path);
        return;
      }
    }

    // Intercept modal-preferred intents
    if (intentType === 'add_vendor') {
      // Check for duplicate vendor before opening modal
      if (extractedParams.name) {
        try {
          const vendors = await SupplyChainRPC.getVendors();
          const vendorEntities = vendors.map((v) => ({ name: v.name, code: v.code ?? undefined, id: v.id }));
          const matchId = fuzzyMatch(extractedParams.name, vendorEntities);
          if (matchId) {
            const matched = vendors.find((v) => v.id === matchId);
            addMessage(
              'assistant',
              `Found existing vendor "${matched?.name ?? extractedParams.name}". Opening it for editing instead.`,
              { navigateTo: '/inventory/vendors' }
            );
            return;
          }
        } catch {
          // If vendor lookup fails, proceed with modal normally
        }
      }

      vendorModalSubmitted.current = false;
      setVendorModalInitialName(extractedParams.name || undefined);
      setVendorModalOpen(true);
      addMessage(
        'assistant',
        extractedParams.name
          ? `Opening vendor form for "${extractedParams.name}"...`
          : 'Opening the vendor form...'
      );
      return;
    }

    // Get action definition
    const actionDef = await getActionDefinition(intentType);

    if (!actionDef) {
      addMessage(
        'assistant',
        "I'm not sure what you mean. Try asking me to:\n\n  \"Add a vendor\"\n  \"Adjust stock balance\"\n  \"List purchase orders\"\n  \"Check low stock\"\n\nOr type \"help\" for the full list."
      );
      return;
    }

    // ── Auto-execute when all required params are filled ──────────────
    const intentClassification = classifyIntent(intentType);
    if (intentClassification === 'MUTATION' && actionDef.steps.length > 0 && !MODAL_INTENTS.has(intentType)) {
      const mergedParams: Record<string, string> = { ...extractedParams };

      // Apply smart defaults for fields AI didn't provide
      const defaults = SMART_DEFAULTS[intentType];
      if (defaults) {
        for (const [field, value] of Object.entries(defaults)) {
          if (!mergedParams[field]) mergedParams[field] = value;
        }
      }

      // Sprint 5: Carry forward contextual fields from last successful same-intent flow
      const CARRY_FORWARD_FIELDS: Record<string, string[]> = {
        adjust_stock:       ['location_id', 'reason'],
        adjust_stock_delta: ['location_id', 'reason'],
        issue_inventory:    ['location_id', 'issued_to_type', 'issued_to_ref'],
        create_transfer:    ['from_location_id', 'to_location_id'],
      };

      if (lastFlowParams.current?.intent === intentType) {
        const carryFields = CARRY_FORWARD_FIELDS[intentType];
        if (carryFields) {
          for (const field of carryFields) {
            if (!mergedParams[field] && lastFlowParams.current.params[field]) {
              mergedParams[field] = lastFlowParams.current.params[field];
            }
          }
        }
      }

      // Check if all required non-confirm steps have values
      const allRequiredFilled = actionDef.steps.every(
        (s) => s.type === 'confirm' || !s.required || !!mergedParams[s.field]
      );

      if (allRequiredFilled) {
        // Check governance: high-risk tools always go through confirmation flow
        const governance = TOOL_GOVERNANCE[intentType];
        if (governance?.requiresConfirmation) {
          // Fall through to step flow (confirmation will be shown)
        } else {
          // Auto-execute immediately — no preview card, no step flow, no confirm
          // Sprint 6: Track auto-executed flow
          const metric = startFlowMetric(intentType, actionDef.steps.length);
          metric.wasAutoExecuted = true;

          const execMsg = addMessage('assistant', `On it...`, { status: 'executing' });
          try {
            const result = await actionDef.execute(mergedParams);
            lastFlowParams.current = { intent: intentType, params: { ...mergedParams } };
            completeMetric(metric, 'completed');
            setMessages((prev) =>
              prev.map((m) => m.id === execMsg.id
                ? { ...m, content: result.message, status: result.success ? 'success' : 'error', navigateTo: result.navigateTo }
                : m
              )
            );
          } catch (err: any) {
            completeMetric(metric, 'failed');
            const errMsg = err?.message || 'Unknown error';
            setMessages((prev) =>
              prev.map((m) => m.id === execMsg.id
                ? { ...m, content: `I couldn't complete that: ${errMsg}. Want to try again?`, status: 'error' }
                : m
              )
            );
          } finally {
            setIsLoading(false);
          }
          return;
        }
      }
    }

    // Fallback: For MUTATION intents in workspace mode, show action preview card
    if (mode === 'workspace' && intentClassification === 'MUTATION' && !MODAL_INTENTS.has(intentType)) {
      const preview = buildActionPreview(intentType, extractedParams, displayNames);
      setActions((prev) => [preview, ...prev]);
      addMessage('assistant', `I've proposed an action: **${preview.title}**. Check the Actions panel to confirm or cancel.`, {
        action: preview,
      });
      return;
    }

    // Fallback: For MUTATION intents in corner mode, show action preview card inline
    if (mode === 'corner' && intentClassification === 'MUTATION' && actionDef.steps.length > 0 && !MODAL_INTENTS.has(intentType)) {
      const preview = buildActionPreview(intentType, extractedParams, displayNames);
      setActions((prev) => [preview, ...prev]);
      addMessage('assistant', `Got it — let's ${actionDef.description.toLowerCase()}.`, {
        action: preview,
      });
      return;
    }

    // No steps = immediate execution (list/query commands). Params still flow
    // through — zero-step actions like list_assets/print_labels take optional
    // filters (location, status) that the AI or regex extractors provide.
    if (actionDef.steps.length === 0) {
      addMessage('assistant', 'Working on it...', { status: 'executing' });
      const result = await actionDef.execute(extractedParams);

      setMessages((prev) => {
        const filtered = prev.filter(
          (m) => !(m.status === 'executing' && m.content === 'Working on it...')
        );
        return [
          ...filtered,
          {
            id: Date.now().toString(),
            role: 'assistant' as const,
            content: result.message,
            timestamp: new Date(),
            status: result.success ? 'success' : 'error',
            navigateTo: result.navigateTo,
          },
        ];
      });
      if (result.success && result.navigateTo && result.autoNavigate) {
        router.push(result.navigateTo);
      }
      return;
    }

    // Multi-step flow: start it
    const collectedParams: Record<string, string> = { ...extractedParams };

    // Sprint 5: Carry forward for step-flow path too
    if (lastFlowParams.current?.intent === intentType) {
      const carryFields: Record<string, string[]> = {
        adjust_stock:       ['location_id', 'reason'],
        adjust_stock_delta: ['location_id', 'reason'],
        issue_inventory:    ['location_id', 'issued_to_type', 'issued_to_ref'],
        create_transfer:    ['from_location_id', 'to_location_id'],
      };
      const fields = carryFields[intentType];
      if (fields) {
        for (const field of fields) {
          if (!collectedParams[field] && lastFlowParams.current.params[field]) {
            collectedParams[field] = lastFlowParams.current.params[field];
          }
        }
      }
    }

    let startStep = actionDef.steps.length;
    for (let i = 0; i < actionDef.steps.length; i++) {
      const step = actionDef.steps[i];
      if (step.type === 'confirm') {
        startStep = i;
        break;
      }
      if (!collectedParams[step.field]) {
        if (step.required) {
          startStep = i;
          break;
        }
        // Optional field without value — skip it
        continue;
      }
    }

    // Sprint 6: Start flow metric
    flowMetric.current = startFlowMetric(intentType, actionDef.steps.length);

    const flow: ActiveFlow = {
      action: actionDef,
      currentStepIndex: startStep,
      collectedParams,
    };

    setActiveFlow(flow);
    addMessage('assistant', `Got it — let's ${actionDef.description.toLowerCase()}.`);
    await advanceFlow(flow);
  };

  // ── Confirm an action (from preview card) ──────────────────────────

  const confirmAction = useCallback(
    async (actionId: string) => {
      const action = actions.find((a) => a.id === actionId);
      if (!action || action.status !== 'proposed') return;

      // Update status to executing
      setActions((prev) =>
        prev.map((a) => (a.id === actionId ? { ...a, status: 'executing' as const } : a))
      );

      // Get the action definition
      const actionDef = await getActionDefinition(action.intent);
      if (!actionDef) {
        setActions((prev) =>
          prev.map((a) =>
            a.id === actionId
              ? { ...a, status: 'failed' as const, result: { success: false, message: 'Action not found' } }
              : a
          )
        );
        return;
      }

      const collectedParams = { ...action.params };

      // Apply smart defaults
      const defaults = SMART_DEFAULTS[action.intent];
      if (defaults) {
        for (const [field, value] of Object.entries(defaults)) {
          if (!collectedParams[field]) collectedParams[field] = value;
        }
      }

      // Check if all required non-confirm steps have values
      const allRequiredFilled = actionDef.steps.every(
        (s) => s.type === 'confirm' || !s.required || !!collectedParams[s.field]
      );

      if (allRequiredFilled) {
        // Execute directly — no step flow needed
        const execMsg = addMessage('assistant', 'On it...', { status: 'executing' });
        try {
          const result = await actionDef.execute(collectedParams);
          setActions((prev) =>
            prev.map((a) =>
              a.id === actionId
                ? { ...a, status: (result.success ? 'completed' : 'failed') as any, result }
                : a
            )
          );
          setMessages((prev) =>
            prev.map((m) =>
              m.id === execMsg.id
                ? { ...m, content: result.message, status: result.success ? 'success' : 'error', navigateTo: result.navigateTo }
                : m
            )
          );
        } catch (err: any) {
          const errMsg = err?.message || 'Unknown error';
          setActions((prev) =>
            prev.map((a) =>
              a.id === actionId
                ? { ...a, status: 'failed' as const, result: { success: false, message: errMsg } }
                : a
            )
          );
          setMessages((prev) =>
            prev.map((m) =>
              m.id === execMsg.id
                ? { ...m, content: `I couldn't complete that: ${errMsg}. Want to try again?`, status: 'error' }
                : m
            )
          );
        }
        return;
      }

      // Missing params — start step flow and track action ID for status updates
      activeActionId.current = actionId;

      let startStep = actionDef.steps.length;
      for (let i = 0; i < actionDef.steps.length; i++) {
        const step = actionDef.steps[i];
        // Skip the confirm step — user already confirmed via the Actions panel
        if (step.type === 'confirm') continue;
        if (!collectedParams[step.field]) {
          startStep = i;
          break;
        }
      }

      // Mark action as confirmed
      setActions((prev) =>
        prev.map((a) => (a.id === actionId ? { ...a, status: 'confirmed' as const } : a))
      );

      // Pre-fill the confirm step so advanceFlow auto-skips it
      collectedParams['confirm'] = 'yes';

      const flow: ActiveFlow = {
        action: actionDef,
        currentStepIndex: startStep,
        collectedParams,
      };

      setActiveFlow(flow);
      addMessage('assistant', `Got it — let's ${actionDef.description.toLowerCase()}.`);
      await advanceFlow(flow);
    },
    [actions, addMessage, advanceFlow]
  );

  // ── Cancel a proposed action ───────────────────────────────────────

  const cancelAction = useCallback(
    (actionId: string) => {
      setActions((prev) => prev.filter((a) => a.id !== actionId));
      addMessage('assistant', 'Action cancelled. What else can I help with?');
    },
    [addMessage]
  );

  // ── Vendor modal callbacks ─────────────────────────────────────────

  const handleVendorModalSuccess = useCallback(
    ({ name: vendorName }: { id: string; name: string }) => {
      vendorModalSubmitted.current = true;
      setVendorModalOpen(false);
      addMessage('assistant', `Vendor "${vendorName}" created successfully!`, {
        status: 'success',
        navigateTo: '/inventory/vendors',
      });
    },
    [addMessage]
  );

  const handleVendorModalClose = useCallback(() => {
    // Guard against spurious close events (e.g. Dialog re-renders)
    setVendorModalOpen((prev) => {
      if (!prev) return false; // Already closed — skip duplicate message
      // If the modal was submitted successfully, don't emit a cancel message
      if (vendorModalSubmitted.current) {
        vendorModalSubmitted.current = false;
        return false;
      }
      // Defer the cancel message to avoid batching with the close state update
      setTimeout(() => {
        addMessage('assistant', 'Vendor creation cancelled. What else can I help with?');
      }, 0);
      return false;
    });
  }, [addMessage]);

  // ── Select option click ────────────────────────────────────────────

  const handleSelectOption = useCallback(
    async (value: string) => {
      if (!activeFlow || isLoading) return;

      const step = activeFlow.action.steps[activeFlow.currentStepIndex];
      const opt = step.options?.find((o) => o.value === value);

      addMessage('user', opt?.label || value);

      const nextFlow: ActiveFlow = {
        ...activeFlow,
        currentStepIndex: activeFlow.currentStepIndex + 1,
        collectedParams: {
          ...activeFlow.collectedParams,
          [step.field]: value,
        },
      };
      setActiveFlow(nextFlow);
      await advanceFlow(nextFlow);
    },
    [activeFlow, isLoading, addMessage, advanceFlow]
  );

  // ── Cancel active flow ─────────────────────────────────────────────

  const cancelFlow = useCallback((reasonOrEvent?: string | React.MouseEvent) => {
    const reason = typeof reasonOrEvent === 'string' ? reasonOrEvent : undefined;
    // If cancelling a flow that was started from a proposed action, revert it
    if (activeActionId.current) {
      const aid = activeActionId.current;
      activeActionId.current = null;
      setActions((prev) =>
        prev.map((a) =>
          a.id === aid && a.status === 'confirmed'
            ? { ...a, status: 'proposed' as const }
            : a
        )
      );
    }
    const flowDesc = activeFlow?.action?.description;
    setActiveFlow(null);
    if (flowMetric.current) { completeMetric(flowMetric.current, 'cancelled'); flowMetric.current = null; }
    const msg = reason
      ? reason
      : flowDesc
        ? `I stopped the ${flowDesc.toLowerCase()} flow. Let me know if you want to try again.`
        : 'Cancelled. What else can I help with?';
    addMessage('assistant', msg);
  }, [addMessage, activeFlow]);

  // ── Main send handler ──────────────────────────────────────────────

  const sendMessage = useCallback(
    async (overrideText?: string, imageBase64?: string) => {
      const text = (overrideText ?? input).trim();
      const imageUrl = imageBase64 || pendingImage || undefined;

      // Allow sending if there's text OR an image
      if ((!text && !imageUrl) || isLoading) return;

      // Clear pending image
      if (pendingImage) setPendingImage(null);

      const displayText = text || '(image attached)';
      addMessage('user', displayText, imageUrl ? { imageUrl } : undefined);
      if (!overrideText) setInput('');

      // Check for cancel/abort FIRST (works both in and out of flows)
      if (text && ['cancel', 'abort', 'stop', 'nevermind', 'never mind'].includes(text.toLowerCase())) {
        if (activeFlow) {
          // Revert tracked action to proposed
          if (activeActionId.current) {
            const aid = activeActionId.current;
            activeActionId.current = null;
            setActions((prev) =>
              prev.map((a) =>
                a.id === aid && a.status === 'confirmed'
                  ? { ...a, status: 'proposed' as const }
                  : a
              )
            );
          }
          setActiveFlow(null);
          if (flowMetric.current) { completeMetric(flowMetric.current, 'cancelled'); flowMetric.current = null; }
          addMessage('assistant', 'Cancelled. What else can I help with?');
        } else {
          addMessage('assistant', "Nothing to cancel. What would you like to do?");
        }
        return;
      }

      // Check for "I meant yes" restoration of cancelled flows
      const RESTORE_RE = /^(i meant (yes|confirm)|actually (yes|confirm|do it)|wait,?\s*yes|oops,?\s*yes)/i;
      if (text && RESTORE_RE.test(text.trim()) && lastCancelledFlow.current) {
        const restored = lastCancelledFlow.current;
        lastCancelledFlow.current = null;
        const nextFlow = { ...restored, currentStepIndex: restored.currentStepIndex + 1 };
        setActiveFlow(nextFlow);
        addMessage('assistant', 'Got it — restoring the previous action.');
        await advanceFlow(nextFlow);
        return;
      }

      // If we're in a flow and user typed text (not just image), handle as flow input
      if (activeFlow && text) {
        await handleFlowInput(text, activeFlow);
        return;
      }

      setIsLoading(true);
      setIsThinking(true);

      try {

        // Track conversation for AI (include image if present)
        const apiContent = text || 'What is this item?';
        const historyEntry: ChatMessage = { role: 'user', content: apiContent };
        if (imageUrl) historyEntry.imageUrl = imageUrl;
        conversationHistory.current.push(historyEntry);
        if (conversationHistory.current.length > 60) {
          conversationHistory.current = conversationHistory.current.slice(-50);
        }

        // ── Try AI mode first (streaming) ──
        if (aiAvailable) {
          try {
            // Create a placeholder message for streaming
            const placeholderId = Date.now().toString() + Math.random().toString(36).slice(2);
            streamingMsgId.current = placeholderId;
            setMessages((prev) => [...prev, {
              id: placeholderId,
              role: 'assistant' as const,
              content: '',
              timestamp: new Date(),
            }]);
            setIsThinking(false); // Switch from thinking to streaming

            let streamedContent = '';
            let streamedDataDisplay: import('./types').AiDataDisplay | undefined;
            let streamedToolCall: { intent: string; params: Record<string, string> } | undefined;

            const aiResponse = await streamAiChat(
              conversationHistory.current,
              {
                onDelta: (content) => {
                  streamedContent += content;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === placeholderId
                        ? { ...m, content: streamedContent }
                        : m
                    )
                  );
                },
                onToolCall: (data) => {
                  streamedToolCall = { intent: data.intent, params: data.params || {} };
                },
                onDataResult: (data) => {
                  streamedDataDisplay = data.dataDisplay;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === placeholderId
                        ? { ...m, dataDisplay: data.dataDisplay, status: 'success' as const }
                        : m
                    )
                  );
                },
                onDone: (data) => {
                  // Update conversation ID from server
                  if (data.conversation_id && !conversationId) {
                    setConversationId(data.conversation_id);
                  }
                  streamingMsgId.current = null;
                },
                onError: (message) => {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === placeholderId
                        ? { ...m, content: message || 'Something went wrong.', status: 'error' as const }
                        : m
                    )
                  );
                  streamingMsgId.current = null;
                },
              },
              { conversationId: conversationId || undefined, surface: mode }
            );

            const parsed = parseAIResponse(aiResponse);

            if (parsed) {
              aiFailCount.current = 0;

              if (parsed.type === 'data_result') {
                conversationHistory.current.push({
                  role: 'assistant',
                  content: parsed.content,
                });
                // Message already updated via onDelta + onDataResult
                options?.onAssistantMessage?.(parsed.content);
                return;
              }

              if (parsed.type === 'tool_use') {
                // Remove the streaming placeholder for tool_use (action flow will add its own messages)
                setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
                const { resolved: resolvedParams, displayNames } = await resolveAIParams(parsed.intent, parsed.params, text);
                conversationHistory.current.push({
                  role: 'assistant',
                  content: `[Action: ${parsed.intent}]`,
                });
                await startActionFlow(parsed.intent, resolvedParams, text, displayNames);
                return;
              }

              if (parsed.type === 'text') {
                conversationHistory.current.push({
                  role: 'assistant',
                  content: parsed.content,
                });
                // Message already updated via onDelta
                options?.onAssistantMessage?.(parsed.content);
                return;
              }
            }

            // If we got content via streaming but parseAIResponse returned null (e.g., fallback)
            if (streamedContent) {
              conversationHistory.current.push({
                role: 'assistant',
                content: streamedContent,
              });
              options?.onAssistantMessage?.(streamedContent);
              return;
            }

            // No useful response — remove placeholder
            setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
          } catch (err) {
            console.warn('[useAiChat] AI request failed, falling back to keyword:', err);
            // Remove streaming placeholder on error
            if (streamingMsgId.current) {
              setMessages((prev) => prev.filter((m) => m.id !== streamingMsgId.current));
              streamingMsgId.current = null;
            }
            aiFailCount.current += 1;
            if (aiFailCount.current >= 3) {
              setAiAvailable(false);
              console.warn('[useAiChat] AI disabled after 3 consecutive failures');
              addMessage(
                'assistant',
                'AI mode is currently unavailable — I\'ll use basic keyword matching for now. For full conversational capabilities, check that the OPENAI_API_KEY is configured.',
                { status: 'error' }
              );
            }
          }
        }

        // ── Keyword fallback ──
        const intent = parseIntent(text);

        if (intent.type === 'unknown') {
          const fallbackMsg = "I wasn't able to understand that. Here's what I can help with:\n\n" +
            "  **Stock** — \"What's in stock?\", \"What's running low?\"\n" +
            "  **Vendors** — \"Show vendors\", \"Add a vendor\"\n" +
            "  **Purchase Orders** — \"Create a PO\", \"Show late orders\"\n" +
            "  **Transfers** — \"Move stock\", \"Show transfers\"\n" +
            "  **Analytics** — \"Inventory value?\", \"Turnover?\", \"Forecast?\"\n" +
            "  **Dashboards** — \"Create a dashboard\"\n" +
            "  **Navigation** — \"Go to purchasing\"\n\n" +
            "Try rephrasing, or type **help** for the full list.";
          addMessage('assistant', fallbackMsg);
          conversationHistory.current.push({
            role: 'assistant',
            content: fallbackMsg,
          });
          return;
        }

        await startActionFlow(intent.type, intent.extractedParams, text);

        conversationHistory.current.push({
          role: 'assistant',
          content: `[Action: ${intent.type}]`,
        });
      } catch (err: any) {
        console.error('Chat error:', err);
        addMessage(
          'assistant',
          `Something went wrong: ${err.message || 'Please try again.'}`,
          { status: 'error' }
        );
      } finally {
        setIsLoading(false);
        setIsThinking(false);
      }
    },
    [input, isLoading, activeFlow, aiAvailable, pendingImage, addMessage, handleFlowInput, options]
  );

  // ── Return ─────────────────────────────────────────────────────────

  return {
    // State
    messages,
    input,
    setInput,
    isLoading,
    isThinking,
    activeFlow,
    aiAvailable,
    actions,
    pendingImage,
    setPendingImage,
    conversationId,

    // Methods
    sendMessage,
    handleFlowInput,
    handleSelectOption,
    cancelFlow,
    confirmAction,
    cancelAction,
    startNewConversation,

    // Vendor modal
    vendorModal: {
      open: vendorModalOpen,
      initialName: vendorModalInitialName,
      onClose: handleVendorModalClose,
      onSuccess: handleVendorModalSuccess,
    },

    // Navigation
    navigate: (path: string) => router.push(path),
  };
}
