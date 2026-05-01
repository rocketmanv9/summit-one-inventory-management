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
 * Send conversation history to the AI chat endpoint.
 * Returns structured response or throws on network error.
 */
export async function sendToAI(messages: ChatMessage[]): Promise<AIResponse> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    console.warn(`[sendToAI] API returned ${res.status}: ${res.statusText}`);
    return { fallbackToKeyword: true, error: `API ${res.status}` };
  }

  return res.json();
}
