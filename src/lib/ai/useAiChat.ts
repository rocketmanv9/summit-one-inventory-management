'use client';

/**
 * useAiChat — Shared AI chat hook used by both the corner ChatBot and AI Workspace.
 * Extracted from the original ChatBot.tsx monolith.
 */

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { parseIntent } from '@/lib/chat/intents';
import type { IntentType } from '@/lib/chat/intents';
import {
  getActionDefinition,
  resolveNavigation,
  type ActionDefinition,
} from '@/lib/chat/actions';
import { sendToAI, type ChatMessage } from '@/lib/ai/client';
import { parseAIResponse } from '@/lib/ai/parse-response';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import type { Message, ActiveFlow, ChatAction, AiChatOptions } from './types';
import { classifyIntent } from './types';
import { buildActionPreview, executeAction } from './executeAction';

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

async function resolveAIParams(
  intent: IntentType,
  aiParams: Record<string, string>
): Promise<Record<string, string>> {
  const mapping = AI_PARAM_MAP[intent];
  if (!mapping) return { ...aiParams };

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

  for (const [aiKey, aiValue] of Object.entries(aiParams)) {
    const map = mapping[aiKey];
    if (!map) {
      resolved[aiKey] = aiValue;
      continue;
    }

    if (map.entityType) {
      const entities = await loadEntities(map.entityType);
      const matchedId = fuzzyMatch(aiValue, entities);
      if (matchedId) {
        resolved[map.actionField] = matchedId;
      }
    } else {
      resolved[map.actionField] = aiValue;
    }
  }

  return resolved;
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

  // Vendor modal state
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [vendorModalInitialName, setVendorModalInitialName] = useState<string | undefined>();

  // Refs
  const aiFailCount = useRef(0);
  const conversationHistory = useRef<ChatMessage[]>([]);

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
        if (!collectedParams[step.field]) break;
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

          addMessage('assistant', result.message, {
            status: result.success ? 'success' : 'error',
            navigateTo: result.navigateTo,
          });
        } catch (err: any) {
          setActiveFlow(null);
          addMessage(
            'assistant',
            `Something went wrong: ${err.message || 'Unknown error'}`,
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
      const step = flow.action.steps[flow.currentStepIndex];

      if (step.type === 'confirm') {
        const lower = userInput.toLowerCase().trim();
        if (lower === 'yes' || lower === 'y' || lower === 'confirm') {
          const nextFlow: ActiveFlow = {
            ...flow,
            currentStepIndex: flow.currentStepIndex + 1,
          };
          setActiveFlow(nextFlow);
          await advanceFlow(nextFlow);
          return;
        } else {
          setActiveFlow(null);
          addMessage('assistant', 'Cancelled. What else can I help with?');
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
    text: string
  ) => {
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

    // For MUTATION intents in workspace mode, show action preview card
    const intentClassification = classifyIntent(intentType);
    if (mode === 'workspace' && intentClassification === 'MUTATION' && !MODAL_INTENTS.has(intentType)) {
      const preview = buildActionPreview(intentType, extractedParams);
      setActions((prev) => [preview, ...prev]);
      addMessage('assistant', `I've proposed an action: **${preview.title}**. Check the Actions panel to confirm or cancel.`, {
        action: preview,
      });
      return;
    }

    // For MUTATION intents in corner mode, show action preview card inline
    if (mode === 'corner' && intentClassification === 'MUTATION' && actionDef.steps.length > 0 && !MODAL_INTENTS.has(intentType)) {
      const preview = buildActionPreview(intentType, extractedParams);
      setActions((prev) => [preview, ...prev]);
      addMessage('assistant', `Got it — let's ${actionDef.description.toLowerCase()}.`, {
        action: preview,
      });
      return;
    }

    // No steps = immediate execution (list/query commands)
    if (actionDef.steps.length === 0) {
      addMessage('assistant', 'Working on it...', { status: 'executing' });
      const result = await actionDef.execute({});

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
      return;
    }

    // Multi-step flow: start it
    const collectedParams: Record<string, string> = { ...extractedParams };

    let startStep = actionDef.steps.length;
    for (let i = 0; i < actionDef.steps.length; i++) {
      const step = actionDef.steps[i];
      if (step.type === 'confirm') {
        startStep = i;
        break;
      }
      if (!collectedParams[step.field]) {
        startStep = i;
        break;
      }
    }

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

      // Start the step flow with pre-filled params
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

      // Start the step-by-step flow with pre-filled params
      const collectedParams = { ...action.params };

      let startStep = actionDef.steps.length;
      for (let i = 0; i < actionDef.steps.length; i++) {
        const step = actionDef.steps[i];
        if (step.type === 'confirm') {
          startStep = i;
          break;
        }
        if (!collectedParams[step.field]) {
          startStep = i;
          break;
        }
      }

      // Mark action as confirmed
      setActions((prev) =>
        prev.map((a) => (a.id === actionId ? { ...a, status: 'confirmed' as const } : a))
      );

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
    (vendorName: string) => {
      setVendorModalOpen(false);
      addMessage('assistant', `Vendor "${vendorName}" created successfully!`, {
        status: 'success',
        navigateTo: '/purchasing/vendors',
      });
    },
    [addMessage]
  );

  const handleVendorModalClose = useCallback(() => {
    setVendorModalOpen(false);
    addMessage('assistant', 'Vendor creation cancelled. What else can I help with?');
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

  const cancelFlow = useCallback(() => {
    setActiveFlow(null);
    addMessage('assistant', 'Cancelled. What else can I help with?');
  }, [addMessage]);

  // ── Main send handler ──────────────────────────────────────────────

  const sendMessage = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || isLoading) return;

      addMessage('user', text);
      if (!overrideText) setInput('');

      // If we're in a flow, handle as flow input
      if (activeFlow) {
        await handleFlowInput(text, activeFlow);
        return;
      }

      setIsLoading(true);
      setIsThinking(true);

      try {
        // Check for cancel/abort
        if (['cancel', 'abort', 'stop', 'nevermind', 'never mind'].includes(text.toLowerCase())) {
          if (activeFlow) {
            setActiveFlow(null);
            addMessage('assistant', 'Cancelled. What else can I help with?');
          } else {
            addMessage('assistant', "Nothing to cancel. What would you like to do?");
          }
          return;
        }

        // Track conversation for AI
        conversationHistory.current.push({ role: 'user', content: text });
        if (conversationHistory.current.length > 40) {
          conversationHistory.current = conversationHistory.current.slice(-30);
        }

        // ── Try AI mode first ──
        if (aiAvailable) {
          try {
            const aiResponse = await sendToAI(conversationHistory.current);
            const parsed = parseAIResponse(aiResponse);

            if (parsed) {
              aiFailCount.current = 0;

              if (parsed.type === 'data_result') {
                conversationHistory.current.push({
                  role: 'assistant',
                  content: parsed.content,
                });
                addMessage('assistant', parsed.content, {
                  status: 'success',
                  dataDisplay: parsed.dataDisplay,
                });
                options?.onAssistantMessage?.(parsed.content);
                return;
              }

              if (parsed.type === 'tool_use') {
                const resolvedParams = await resolveAIParams(parsed.intent, parsed.params);
                conversationHistory.current.push({
                  role: 'assistant',
                  content: `[Action: ${parsed.intent}]`,
                });
                await startActionFlow(parsed.intent, resolvedParams, text);
                return;
              }

              if (parsed.type === 'text') {
                conversationHistory.current.push({
                  role: 'assistant',
                  content: parsed.content,
                });
                addMessage('assistant', parsed.content);
                options?.onAssistantMessage?.(parsed.content);
                return;
              }
            }
          } catch (err) {
            console.warn('[useAiChat] AI request failed, falling back to keyword:', err);
            aiFailCount.current += 1;
            if (aiFailCount.current >= 3) {
              setAiAvailable(false);
              console.warn('[useAiChat] AI disabled after 3 consecutive failures');
            }
          }
        }

        // ── Keyword fallback ──
        const intent = parseIntent(text);
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
    [input, isLoading, activeFlow, aiAvailable, addMessage, handleFlowInput, options]
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

    // Methods
    sendMessage,
    handleFlowInput,
    handleSelectOption,
    cancelFlow,
    confirmAction,
    cancelAction,

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
