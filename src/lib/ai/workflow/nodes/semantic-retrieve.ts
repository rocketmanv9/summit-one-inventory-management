/**
 * Semantic Retrieval Node — Retrieves relevant context via hybrid search.
 */
import type { ChatGraphState, ChatGraphUpdate } from '../graph-types';
import { hybridSearch } from '../../semantic/hybrid-search';

export async function semanticRetrieveNode(state: ChatGraphState): Promise<ChatGraphUpdate> {
  try {
    const results = await hybridSearch(state.supabase, state.tenantId, state.userMessage, { limit: 5 });
    return {
      retrievedContext: results.map((r) => `[${r.source_type}] ${r.content.slice(0, 500)}`),
      nodesVisited: ['semantic_retrieve'],
    };
  } catch {
    return { nodesVisited: ['semantic_retrieve'] };
  }
}
