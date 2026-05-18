/**
 * Embedding Pipeline — Background processor for embedding_queue.
 */

import { generateEmbedding } from '../embeddings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = any;

const MAX_BATCH = 20;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 60_000;

export async function processEmbeddingQueue(
  supabase: SupabaseClientLike,
  batchSize: number = MAX_BATCH
): Promise<{ processed: number; failed: number }> {
  const inv = supabase.schema('inventory');
  let processed = 0;
  let failed = 0;

  // Claim pending items (not backed off)
  const { data: items } = await inv
    .from('embedding_queue')
    .select('*')
    .eq('status', 'pending')
    .or('backoff_until.is.null,backoff_until.lte.' + new Date().toISOString())
    .order('created_at')
    .limit(batchSize);

  if (!items || items.length === 0) return { processed: 0, failed: 0 };

  for (const item of items) {
    await inv.from('embedding_queue')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', item.id);

    try {
      const embedding = await generateEmbedding(item.content);

      if (embedding.length === 0) throw new Error('Empty embedding returned');

      // Update the source entity with the embedding
      if (item.entity_type.startsWith('chunk:')) {
        await inv.from('document_chunks')
          .update({
            embedding,
            last_embedded: new Date().toISOString(),
            content_hash: item.entity_content_hash,
            updated_at: new Date().toISOString(),
          })
          .eq('tenant_id', item.tenant_id)
          .eq('content', item.content)
          .is('embedding', null)
          .limit(1);
      }

      await inv.from('embedding_queue')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', item.id);

      processed++;
    } catch (err: any) {
      const attempts = (item.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await inv.from('embedding_queue')
          .update({ status: 'failed', error: err.message, attempts, updated_at: new Date().toISOString() })
          .eq('id', item.id);
        failed++;
      } else {
        await inv.from('embedding_queue')
          .update({
            status: 'pending',
            attempts,
            backoff_until: new Date(Date.now() + BACKOFF_MS * attempts).toISOString(),
            error: err.message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);
      }
    }
  }

  return { processed, failed };
}
