/**
 * Search Provider Abstraction
 *
 * Clean interface for web search, currently backed by OpenAI's web search.
 * Designed so Tavily/Brave/Firecrawl can be added later by implementing
 * the SearchProvider interface.
 */

// ─── Types ───────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  content?: string;
  imageUrl?: string;
}

/** Brave (and some other engines) bold query matches with HTML tags — strip them. */
function stripHtml(s: string): string {
  return (s || '').replace(/<[^>]+>/g, '').trim();
}

export interface SearchOptions {
  /** Geographic context for the search */
  location?: string;
  /** How many results to return (default: 5) */
  maxResults?: number;
}

export interface SearchProvider {
  name: string;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

// ─── OpenAI Web Search Provider ──────────────────────────────────────────

class OpenAISearchProvider implements SearchProvider {
  name = 'openai';

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return [];

    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey });

    const searchQuery = options?.location
      ? `${query} near ${options.location}`
      : query;

    const maxResults = options?.maxResults ?? 5;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      web_search_options: { search_context_size: 'medium' },
      messages: [
        {
          role: 'system',
          content: [
            'You are a web search assistant. Search for the given query and return structured results.',
            `Return ONLY a valid JSON array of up to ${maxResults} objects, each with:`,
            '  title   — page title',
            '  snippet — 1-2 sentence summary of the result',
            '  url     — source URL',
            '  content — (optional) key extracted details',
            'Do NOT wrap the JSON in markdown code fences.',
            'If you cannot find any results, return: []',
          ].join('\n'),
        },
        { role: 'user', content: searchQuery },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    } as any);

    const content = completion.choices?.[0]?.message?.content;
    if (!content) return [];

    let jsonStr = content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.warn('[SearchProvider] Failed to parse search response as JSON');
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    return parsed.slice(0, maxResults).map((r: any) => ({
      title: r.title || '',
      snippet: r.snippet || '',
      url: r.url || '',
      content: r.content,
    }));
  }
}

// ─── Brave Web Search Provider ───────────────────────────────────────────

class BraveSearchProvider implements SearchProvider {
  name = 'brave';

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) return [];

    const maxResults = options?.maxResults ?? 5;
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;

    const res = await fetch(url, {
      headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      console.warn(`[SearchProvider] Brave search failed: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const results = data?.web?.results ?? [];

    return results.slice(0, maxResults).map((r: any) => ({
      title: stripHtml(r.title || ''),
      snippet: stripHtml(r.description || ''),
      url: r.url || '',
      content: Array.isArray(r.extra_snippets) ? r.extra_snippets.map(stripHtml).join(' ') : undefined,
      imageUrl: r.thumbnail?.src || r.thumbnail?.original || undefined,
    }));
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────

/**
 * Returns the best available search provider, or null if none is configured.
 *
 * Priority:
 * 1. Brave (if BRAVE_API_KEY exists) — real search index, best for product/web lookups
 * 2. OpenAI (if OPENAI_API_KEY exists) — LLM-backed web search fallback
 * 3. null
 */
export function getSearchProvider(): SearchProvider | null {
  if (process.env.BRAVE_API_KEY) {
    return new BraveSearchProvider();
  }
  if (process.env.OPENAI_API_KEY) {
    return new OpenAISearchProvider();
  }
  return null;
}
