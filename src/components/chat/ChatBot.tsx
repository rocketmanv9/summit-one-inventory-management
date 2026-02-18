'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Loader2, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { parseIntent } from '@/lib/chat/intents';
import type { IntentType } from '@/lib/chat/intents';
import {
  getActionDefinition,
  resolveNavigation,
  type ActionDefinition,
  type ConversationStep,
} from '@/lib/chat/actions';
import { sendToAI, type ChatMessage } from '@/lib/ai/client';
import { parseAIResponse } from '@/lib/ai/parse-response';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { AddVendorModal } from '@/components/modals/AddVendorModal';

// ─── AI param → action field resolution ────────────────────────────────

type EntityType = 'item' | 'location' | 'vendor';

interface ParamMapping {
  actionField: string;
  entityType?: EntityType; // if set, fuzzy-match against loaded entities
}

/**
 * Maps (intent, AI param name) → (action field name, entity type for resolution).
 * Params not listed here pass through as-is.
 */
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

/**
 * Fuzzy match a human-readable name against a list of {label, id} entities.
 * Returns the matched id or undefined.
 */
function fuzzyMatch(
  query: string,
  entities: Array<{ name: string; code?: string; sku?: string; id: string }>
): string | undefined {
  const q = query.toLowerCase().trim();
  if (!q) return undefined;

  // 1. Exact name match
  const exactName = entities.find((e) => e.name.toLowerCase() === q);
  if (exactName) return exactName.id;

  // 2. Exact code/SKU match
  const exactCode = entities.find(
    (e) => (e.code && e.code.toLowerCase() === q) || (e.sku && e.sku.toLowerCase() === q)
  );
  if (exactCode) return exactCode.id;

  // 3. Name contains query
  const nameContains = entities.find((e) => e.name.toLowerCase().includes(q));
  if (nameContains) return nameContains.id;

  // 4. Query contains name
  const queryContains = entities.find((e) => q.includes(e.name.toLowerCase()));
  if (queryContains) return queryContains.id;

  return undefined;
}

/**
 * Resolves AI's human-readable params to action-compatible field names and UUIDs.
 * Loads entity data at most once per type per call.
 */
async function resolveAIParams(
  intent: IntentType,
  aiParams: Record<string, string>
): Promise<Record<string, string>> {
  const mapping = AI_PARAM_MAP[intent];
  if (!mapping) return { ...aiParams };

  // Entity caches — loaded lazily, at most once each
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
      // No mapping — pass through as-is
      resolved[aiKey] = aiValue;
      continue;
    }

    if (map.entityType) {
      // Resolve human name → UUID
      const entities = await loadEntities(map.entityType);
      const matchedId = fuzzyMatch(aiValue, entities);
      if (matchedId) {
        resolved[map.actionField] = matchedId;
      }
      // If no match, omit — the flow will prompt interactively
    } else {
      // Simple rename, no resolution needed
      resolved[map.actionField] = aiValue;
    }
  }

  return resolved;
}

// ─── Types ────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  status?: 'success' | 'error' | 'executing';
  selectOptions?: Array<{ label: string; value: string }>;
  navigateTo?: string;
  isConfirm?: boolean;
}

interface ActiveFlow {
  action: ActionDefinition;
  currentStepIndex: number;
  collectedParams: Record<string, string>;
}

// ─── Component ────────────────────────────────────────────────────────

export function ChatBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        "Hi! I'm your inventory assistant. I can help you manage vendors, stock, purchase orders, and more.\n\nTry saying something like:\n  \"Add a vendor\"\n  \"Adjust stock balance\"\n  \"Show me low stock items\"\n  \"List purchase orders\"\n\nType \"help\" to see everything I can do.",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeFlow, setActiveFlow] = useState<ActiveFlow | null>(null);
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [vendorModalInitialName, setVendorModalInitialName] = useState<string | undefined>();
  const [aiAvailable, setAiAvailable] = useState(true); // optimistic; disables on failures
  const aiFailCount = useRef(0);
  const conversationHistory = useRef<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // ── Helpers ───────────────────────────────────────────────────────

  const addMessage = useCallback(
    (
      role: 'user' | 'assistant',
      content: string,
      extras?: Partial<Message>
    ) => {
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

  // ── Build confirmation summary ────────────────────────────────────

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
      // Resolve select option labels
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

  // ── Advance conversation flow ─────────────────────────────────────

  const advanceFlow = useCallback(
    async (flow: ActiveFlow) => {
      let { action, currentStepIndex, collectedParams } = flow;

      // Skip any already-filled steps (except confirm)
      while (currentStepIndex < action.steps.length) {
        const step = action.steps[currentStepIndex];
        if (step.type === 'confirm') break; // always show confirm
        if (!collectedParams[step.field]) break; // needs input
        currentStepIndex++;
      }

      // Update flow if we skipped ahead
      if (currentStepIndex !== flow.currentStepIndex) {
        flow = { ...flow, currentStepIndex };
        setActiveFlow(flow);
      }

      // Past the last step? Execute.
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

      // If it's a confirm step, show the summary
      if (step.type === 'confirm') {
        const summary = buildConfirmationMessage(action, collectedParams);
        addMessage('assistant', summary, { isConfirm: true });
        return;
      }

      // Otherwise ask the question
      addMessage('assistant', step.prompt, {
        selectOptions:
          step.type === 'select' && step.options ? step.options : undefined,
      });
    },
    [addMessage]
  );

  // ── Handle flow step response ─────────────────────────────────────

  const handleFlowInput = useCallback(
    async (userInput: string, flow: ActiveFlow) => {
      const step = flow.action.steps[flow.currentStepIndex];

      // Handle confirm step
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

      // Skip optional fields on empty input
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

      // Validate required
      if (!value && step.required) {
        addMessage('assistant', `This field is required. ${step.prompt}`);
        return;
      }

      // Run custom validation
      if (step.validate) {
        const error = step.validate(value);
        if (error) {
          addMessage('assistant', error);
          return;
        }
      }

      // Store the value and move to next step
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

  // ── Start action flow from intent + params ──────────────────────

  const startActionFlow = async (
    intentType: IntentType,
    extractedParams: Record<string, string>,
    text: string
  ) => {
    // Handle navigation
    if (intentType === 'navigate') {
      const path = resolveNavigation(text);
      if (path) {
        addMessage('assistant', `Taking you there now...`, {
          navigateTo: path,
        });
        router.push(path);
        return;
      }
    }

    // Intercept add_vendor → open modal instead of chat Q&A
    if (intentType === 'add_vendor') {
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

    // No steps = immediate execution (list/query commands)
    if (actionDef.steps.length === 0) {
      addMessage('assistant', 'Working on it...', { status: 'executing' });
      const result = await actionDef.execute({});

      // Remove the "Working on it..." message and replace
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

    // Find the first unfilled non-confirm step
    let startStep = actionDef.steps.length; // default: all filled → jump to execute
    for (let i = 0; i < actionDef.steps.length; i++) {
      const step = actionDef.steps[i];
      if (step.type === 'confirm') {
        startStep = i; // always stop at confirm
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

  // ── Vendor modal callbacks ───────────────────────────────────────

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

  // ── Main send handler ─────────────────────────────────────────────

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    addMessage('user', text);
    setInput('');

    // If we're in a flow, handle as flow input
    if (activeFlow) {
      await handleFlowInput(text, activeFlow);
      return;
    }

    setIsLoading(true);

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
      // Keep history bounded
      if (conversationHistory.current.length > 40) {
        conversationHistory.current = conversationHistory.current.slice(-30);
      }

      // ── Try AI mode first ──────────────────────────────────────
      if (aiAvailable) {
        try {
          const aiResponse = await sendToAI(conversationHistory.current);
          const parsed = parseAIResponse(aiResponse);

          if (parsed) {
            // Reset fail count on success
            aiFailCount.current = 0;

            if (parsed.type === 'tool_use') {
              // AI identified an intent with params — resolve names to UUIDs
              const resolvedParams = await resolveAIParams(parsed.intent, parsed.params);
              conversationHistory.current.push({
                role: 'assistant',
                content: `[Action: ${parsed.intent}]`,
              });
              await startActionFlow(parsed.intent, resolvedParams, text);
              return;
            }

            if (parsed.type === 'text') {
              // AI returned a text response (no tool call)
              conversationHistory.current.push({
                role: 'assistant',
                content: parsed.content,
              });
              addMessage('assistant', parsed.content);
              return;
            }
          }
          // parsed is null → fallbackToKeyword or unrecognized → fall through
        } catch (err) {
          console.warn('[ChatBot] AI request failed, falling back to keyword:', err);
          aiFailCount.current += 1;
          if (aiFailCount.current >= 3) {
            setAiAvailable(false);
            console.warn('[ChatBot] AI disabled after 3 consecutive failures');
          }
        }
      }

      // ── Keyword fallback ───────────────────────────────────────
      const intent = parseIntent(text);
      await startActionFlow(intent.type, intent.extractedParams, text);

      // Track assistant response in conversation history
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
    }
  };

  // ── Select option click ───────────────────────────────────────────

  const handleSelectOption = async (value: string) => {
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
  };

  // ── Navigate link click ───────────────────────────────────────────

  const handleNavigate = (path: string) => {
    router.push(path);
  };

  // ── Key press ─────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <>
      {/* Floating Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 p-4 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-all hover:scale-110 z-50"
          aria-label="Open chat assistant"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {/* Vendor Modal */}
      <AddVendorModal
        open={vendorModalOpen}
        onClose={handleVendorModalClose}
        onSuccess={handleVendorModalSuccess}
        initialName={vendorModalInitialName}
      />

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 w-[420px] h-[620px] bg-white rounded-xl shadow-2xl flex flex-col z-50 border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-blue-600 text-white">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5" />
              <div>
                <h3 className="font-semibold text-sm">Inventory Assistant</h3>
                <p className="text-xs text-blue-100">Ask me anything</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="hover:bg-blue-700 rounded p-1 transition-colors"
              aria-label="Close chat"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((message) => (
              <div key={message.id}>
                <div
                  className={`flex ${
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : message.status === 'error'
                          ? 'bg-red-50 text-red-900 border border-red-200'
                          : message.status === 'success'
                            ? 'bg-green-50 text-green-900 border border-green-200'
                            : 'bg-gray-100 text-gray-900'
                    }`}
                  >
                    {message.status === 'executing' ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">{message.content}</span>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap text-sm leading-relaxed">
                        {message.content}
                      </div>
                    )}

                    {/* Navigate link */}
                    {message.navigateTo && message.status !== 'executing' && (
                      <button
                        onClick={() => handleNavigate(message.navigateTo!)}
                        className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 underline"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Go to page
                      </button>
                    )}

                    <div
                      className={`text-xs mt-1 ${
                        message.role === 'user'
                          ? 'text-blue-100'
                          : 'text-gray-400'
                      }`}
                    >
                      {message.timestamp.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                </div>

                {/* Inline select options */}
                {message.selectOptions &&
                  message.selectOptions.length > 0 &&
                  activeFlow &&
                  activeFlow.action.steps[activeFlow.currentStepIndex]?.type === 'select' && (
                    <div className="mt-2 ml-1 flex flex-wrap gap-1.5">
                      {message.selectOptions.slice(0, 10).map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => handleSelectOption(opt.value)}
                          disabled={isLoading}
                          className="px-2.5 py-1 text-xs bg-white border border-gray-300 rounded-full hover:bg-blue-50 hover:border-blue-400 transition-colors disabled:opacity-50 text-gray-700"
                        >
                          {opt.label}
                        </button>
                      ))}
                      {message.selectOptions.length > 10 && (
                        <span className="px-2 py-1 text-xs text-gray-400">
                          +{message.selectOptions.length - 10} more — type to search
                        </span>
                      )}
                    </div>
                  )}
              </div>
            ))}

            {isLoading &&
              messages[messages.length - 1]?.status !== 'executing' && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-lg px-3 py-2">
                    <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                  </div>
                </div>
              )}

            <div ref={messagesEndRef} />
          </div>

          {/* Active flow indicator */}
          {activeFlow && (
            <div className="px-4 py-1.5 bg-blue-50 border-t border-blue-100 flex items-center justify-between">
              <span className="text-xs text-blue-600">
                {activeFlow.action.description} — step{' '}
                {Math.min(
                  activeFlow.currentStepIndex + 1,
                  activeFlow.action.steps.length
                )}{' '}
                of {activeFlow.action.steps.length}
              </span>
              <button
                onClick={() => {
                  setActiveFlow(null);
                  addMessage('assistant', 'Cancelled. What else can I help with?');
                }}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  activeFlow
                    ? 'Type your answer...'
                    : 'Ask me anything...'
                }
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
