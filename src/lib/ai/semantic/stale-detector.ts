/**
 * Stale Embedding Detector — Detects when content has changed since last embedding.
 *
 * Uses SHA-256 content hashing to compare current content with the stored hash
 * at embedding time. If they differ, the embedding is stale.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = any;

/**
 * Generate a SHA-256 hash of the given text.
 */
export async function hashContent(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Check if a document chunk's embedding is stale.
 * Returns true if the content hash has changed since last embedding.
 */
export async function isChunkStale(
  currentContent: string,
  storedHash: string | null
): Promise<boolean> {
  if (!storedHash) return true;
  const currentHash = await hashContent(currentContent);
  return currentHash !== storedHash;
}

/**
 * Mark stale chunks in the database for a given source.
 * Compares current content hashes with stored hashes and flags mismatches.
 */
export async function markStaleChunks(
  supabase: SupabaseClientLike,
  tenantId: string,
  sourceType: string,
  sourceId: string,
  currentContent: string
): Promise<number> {
  const currentHash = await hashContent(currentContent);

  const { data: chunks } = await supabase
    .schema('inventory')
    .from('document_chunks')
    .select('id, content_hash')
    .eq('tenant_id', tenantId)
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('stale', false)
    .limit(100);

  if (!chunks || chunks.length === 0) return 0;

  let staleCount = 0;
  const staleIds: string[] = [];

  for (const chunk of chunks) {
    if (chunk.content_hash !== currentHash) {
      staleIds.push(chunk.id);
      staleCount++;
    }
  }

  if (staleIds.length > 0) {
    await supabase
      .schema('inventory')
      .from('document_chunks')
      .update({ stale: true, updated_at: new Date().toISOString() })
      .in('id', staleIds);
  }

  return staleCount;
}
