/**
 * Hybrid Search — Combines vector cosine similarity with full-text keyword ranking.
 *
 * Uses the rpc_hybrid_search RPC function for blended scoring.
 */

import { generateEmbedding } from '../embeddings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = any;

export interface HybridSearchResult {
  id: string;
  source_type: string;
  source_id: string | null;
  content: string;
  similarity: number;
  keyword_rank: number;
  combined_score: number;
}

export interface HybridSearchOptions {
  sourceTypes?: string[];
  limit?: number;
  vectorWeight?: number;
  keywordWeight?: number;
}

/**
 * Perform hybrid search across document chunks.
 * Combines vector similarity with full-text keyword matching.
 */
export async function hybridSearch(
  supabase: SupabaseClientLike,
  tenantId: string,
  query: string,
  options: HybridSearchOptions = {}
): Promise<HybridSearchResult[]> {
  const {
    sourceTypes,
    limit = 10,
    vectorWeight = 0.7,
    keywordWeight = 0.3,
  } = options;

  // Generate embedding for the query
  const embedding = await generateEmbedding(query);
  if (!embedding || embedding.length === 0) {
    // Fall back to keyword-only search
    return keywordSearch(supabase, tenantId, query, sourceTypes, limit);
  }

  try {
    const { data, error } = await supabase.schema('inventory').rpc('rpc_hybrid_search', {
      query_text: query,
      query_embedding: embedding,
      match_tenant_id: tenantId,
      source_types: sourceTypes || null,
      match_count: limit,
      vector_weight: vectorWeight,
      keyword_weight: keywordWeight,
    });

    if (error || !data) return [];
    return data as HybridSearchResult[];
  } catch {
    return [];
  }
}

/**
 * Fallback: keyword-only search when embeddings aren't available.
 */
async function keywordSearch(
  supabase: SupabaseClientLike,
  tenantId: string,
  query: string,
  sourceTypes?: string[],
  limit: number = 10
): Promise<HybridSearchResult[]> {
  try {
    let q = supabase
      .schema('inventory')
      .from('document_chunks')
      .select('id, source_type, source_id, content')
      .eq('tenant_id', tenantId)
      .eq('stale', false)
      .textSearch('content', query, { type: 'websearch' })
      .limit(limit);

    if (sourceTypes && sourceTypes.length > 0) {
      q = q.in('source_type', sourceTypes);
    }

    const { data } = await q;

    return (data || []).map((d: any, i: number) => ({
      id: d.id,
      source_type: d.source_type,
      source_id: d.source_id,
      content: d.content,
      similarity: 0,
      keyword_rank: 1 - i * 0.1, // Approximate rank
      combined_score: 1 - i * 0.1,
    }));
  } catch {
    return [];
  }
}
