/**
 * Document Indexer — Chunk documents and queue for embedding.
 */

import { chunkText, estimateTokenCount } from './chunker';
import { hashContent } from './stale-detector';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = any;

export async function indexDocument(
  supabase: SupabaseClientLike,
  tenantId: string,
  doc: {
    sourceType: string;
    sourceId?: string;
    sourceUrl?: string;
    content: string;
    metadata?: Record<string, any>;
  }
): Promise<{ chunksCreated: number }> {
  const inv = supabase.schema('inventory');
  const chunks = chunkText(doc.content);
  const contentHash = await hashContent(doc.content);
  let created = 0;

  // Mark existing chunks as stale
  if (doc.sourceId) {
    await inv.from('document_chunks')
      .update({ stale: true, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('source_type', doc.sourceType)
      .eq('source_id', doc.sourceId);
  }

  for (const chunk of chunks) {
    await inv.from('document_chunks').insert({
      tenant_id: tenantId,
      source_type: doc.sourceType,
      source_id: doc.sourceId || null,
      source_url: doc.sourceUrl || null,
      chunk_index: chunk.index,
      content: chunk.content,
      token_count: chunk.tokenCount,
      content_hash: contentHash,
      metadata: doc.metadata || {},
    });

    // Queue for embedding
    await inv.from('embedding_queue').insert({
      tenant_id: tenantId,
      entity_type: `chunk:${doc.sourceType}`,
      entity_id: doc.sourceId || tenantId,
      content: chunk.content,
      entity_content_hash: contentHash,
    });

    created++;
  }

  return { chunksCreated: created };
}
