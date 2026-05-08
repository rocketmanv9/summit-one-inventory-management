/**
 * Client-side AI Chat API wrapper
 * Sends conversation history to /api/ai/chat with auth cookies.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
}

export interface AIResponse {
  fallbackToKeyword?: boolean;
  type?: 'tool_use' | 'text' | 'data_result';
  intent?: string;
  params?: Record<string, string>;
  content?: string;
  error?: string;
  /** Structured data display for server-side query results */
  dataDisplay?: import('./types').AiDataDisplay;
}

/**
 * Send conversation history to the AI chat endpoint.
 * Returns structured response or throws on network error.
 */
export interface VendorSearchResult {
  found: boolean;
  vendor?: {
    name?: string;
    code?: string;
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
    address?: string;
    website?: string;
  };
}

/**
 * Search the web for vendor/company contact details via OpenAI web search.
 * Returns { found: false } on any failure so the flow can continue manually.
 */
export async function searchVendorOnline(name: string): Promise<VendorSearchResult> {
  try {
    const res = await fetch('/api/ai/vendor-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name }),
    });

    if (!res.ok) {
      return { found: false };
    }

    return res.json();
  } catch {
    return { found: false };
  }
}

/**
 * Send conversation history to the AI chat endpoint (non-streaming fallback).
 * Returns structured response or throws on network error.
 */
export async function sendToAI(messages: ChatMessage[], conversationId?: string): Promise<AIResponse> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ messages, conversation_id: conversationId }),
  });

  if (!res.ok) {
    console.warn(`[sendToAI] API returned ${res.status}: ${res.statusText}`);
    return { fallbackToKeyword: true, error: `API ${res.status}` };
  }

  // Handle SSE response by consuming the stream and assembling the result
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    return consumeStream(res);
  }

  return res.json();
}

// ── Streaming API ──────────────────────────────────────────────────────────

export interface StreamCallbacks {
  onDelta?: (content: string) => void;
  onToolCall?: (data: { intent: string; params: Record<string, string> }) => void;
  onDataResult?: (data: { dataDisplay: import('./types').AiDataDisplay }) => void;
  onDone?: (data: { conversation_id?: string; message_id?: string; tokens?: number; latency_ms?: number }) => void;
  onError?: (message: string) => void;
}

/**
 * Stream AI chat with SSE callbacks.
 * Returns a promise that resolves with the full accumulated response.
 */
export async function streamAiChat(
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  options?: { conversationId?: string; surface?: string }
): Promise<AIResponse> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      messages,
      conversation_id: options?.conversationId,
      surface: options?.surface,
    }),
  });

  if (!res.ok) {
    if (res.status === 429) {
      const errorMsg = 'Rate limit exceeded. Please wait a moment before sending another message.';
      callbacks.onError?.(errorMsg);
      return { fallbackToKeyword: false, error: errorMsg };
    }
    console.warn(`[streamAiChat] API returned ${res.status}: ${res.statusText}`);
    return { fallbackToKeyword: true, error: `API ${res.status}` };
  }

  const contentType = res.headers.get('content-type') || '';

  // Non-streaming fallback (e.g., when server returns JSON directly)
  if (!contentType.includes('text/event-stream')) {
    const json = await res.json();
    if (json.content) callbacks.onDelta?.(json.content);
    return json;
  }

  // Parse SSE stream
  const reader = res.body?.getReader();
  if (!reader) return { fallbackToKeyword: true };

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let lastDataDisplay: import('./types').AiDataDisplay | undefined;
  let lastToolCall: { intent: string; params: Record<string, string> } | undefined;


  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process complete SSE events
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    let currentEvent = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        const dataStr = line.slice(6);
        try {
          const data = JSON.parse(dataStr);

          switch (currentEvent) {
            case 'delta':
              if (data.content) {
                fullContent += data.content;
                callbacks.onDelta?.(data.content);
              }
              break;
            case 'tool_call':
              lastToolCall = { intent: data.intent, params: data.params || {} };
              callbacks.onToolCall?.(data);
              break;
            case 'data_result':
              if (data.dataDisplay) {
                lastDataDisplay = data.dataDisplay;
                callbacks.onDataResult?.(data);
              }
              break;
            case 'done':
              callbacks.onDone?.(data);
              break;
            case 'error':
              callbacks.onError?.(data.message || 'Unknown error');
              break;
          }
        } catch {
          // Skip malformed JSON
        }
        currentEvent = '';
      }
    }
  }

  // Build final response
  if (lastToolCall) {
    return {
      type: 'tool_use',
      intent: lastToolCall.intent,
      params: lastToolCall.params,
    };
  }

  if (lastDataDisplay && fullContent) {
    return {
      type: 'data_result',
      content: fullContent,
      dataDisplay: lastDataDisplay,
    };
  }

  if (fullContent) {
    return { type: 'text', content: fullContent };
  }

  return { fallbackToKeyword: true };
}

/**
 * Consume an SSE response into a single AIResponse (for sendToAI fallback).
 */
async function consumeStream(res: Response): Promise<AIResponse> {
  const fallback: AIResponse = { fallbackToKeyword: true };
  // Parse the SSE response body directly
  const reader = res.body?.getReader();
  if (!reader) return fallback;

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let lastDataDisplay: import('./types').AiDataDisplay | undefined;
  let lastToolCall: { intent: string; params: Record<string, string> } | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let currentEvent = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (currentEvent === 'delta' && data.content) fullContent += data.content;
          if (currentEvent === 'tool_call') lastToolCall = { intent: data.intent, params: data.params || {} };
          if (currentEvent === 'data_result' && data.dataDisplay) lastDataDisplay = data.dataDisplay;
        } catch { /* skip */ }
        currentEvent = '';
      }
    }
  }

  if (lastToolCall) return { type: 'tool_use', intent: lastToolCall.intent, params: lastToolCall.params };
  if (lastDataDisplay && fullContent) return { type: 'data_result', content: fullContent, dataDisplay: lastDataDisplay };
  if (fullContent) return { type: 'text', content: fullContent };
  return fallback;
}

// ── Conversation API helpers ───────────────────────────────────────────────

export interface ConversationSummary {
  id: string;
  title: string | null;
  surface: string;
  model: string;
  total_tokens: number;
  created_at: string;
  updated_at: string;
}

export interface ConversationWithMessages extends ConversationSummary {
  messages: Array<{
    id: string;
    role: string;
    content: string | null;
    tool_calls: any;
    data_display: any;
    image_url: string | null;
    metadata: any;
    created_at: string;
  }>;
}

export async function listConversations(surface?: string): Promise<ConversationSummary[]> {
  const params = new URLSearchParams();
  if (surface) params.set('surface', surface);
  const res = await fetch(`/api/ai/conversations?${params}`, { credentials: 'include' });
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

export async function getConversation(id: string): Promise<ConversationWithMessages | null> {
  const res = await fetch(`/api/ai/conversations/${id}`, { credentials: 'include' });
  if (!res.ok) return null;
  const json = await res.json();
  return json.data || null;
}

export async function deleteConversation(id: string): Promise<boolean> {
  const res = await fetch(`/api/ai/conversations/${id}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'x-idempotency-key': `delete-conv-${id}-${Date.now()}` },
  });
  return res.ok;
}

export async function createConversation(surface: string = 'corner'): Promise<ConversationSummary | null> {
  const res = await fetch('/api/ai/conversations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-idempotency-key': `create-conv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    credentials: 'include',
    body: JSON.stringify({ surface }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.data || null;
}
