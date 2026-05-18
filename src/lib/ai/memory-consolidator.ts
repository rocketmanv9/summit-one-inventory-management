/**
 * Memory Consolidator — Decay scoring, merge similar memories, expire low-decay.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = any;

const DECAY_RATE = 0.05; // 5% decay per day since last access
const MERGE_THRESHOLD = 0.95; // Cosine similarity threshold for merging
const EXPIRE_THRESHOLD = 0.1; // Decay score below which memories expire

/**
 * Update decay scores for all memories of a user.
 * Decay = max(0, 1 - DECAY_RATE * days_since_last_access)
 */
export async function updateDecayScores(
  supabase: SupabaseClientLike,
  tenantId: string,
  userId: string
): Promise<number> {
  const inv = supabase.schema('inventory');
  const { data: memories } = await inv
    .from('ai_memory')
    .select('id, last_accessed, decay_score')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .is('expires_at', null)
    .limit(500);

  if (!memories || memories.length === 0) return 0;

  const now = Date.now();
  let updated = 0;

  for (const mem of memories) {
    const lastAccess = mem.last_accessed ? new Date(mem.last_accessed).getTime() : now;
    const daysSince = (now - lastAccess) / (1000 * 60 * 60 * 24);
    const newDecay = Math.max(0, 1 - DECAY_RATE * daysSince);
    const rounded = Math.round(newDecay * 10000) / 10000;

    if (rounded !== Number(mem.decay_score)) {
      await inv.from('ai_memory')
        .update({ decay_score: rounded, updated_at: new Date().toISOString() })
        .eq('id', mem.id);
      updated++;
    }

    // Expire memories below threshold
    if (rounded < EXPIRE_THRESHOLD) {
      await inv.from('ai_memory')
        .update({ expires_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', mem.id);
    }
  }

  return updated;
}

/**
 * Consolidate duplicate/similar memories.
 * Merges memories with cosine similarity > MERGE_THRESHOLD.
 */
export async function consolidateMemories(
  supabase: SupabaseClientLike,
  tenantId: string,
  userId: string
): Promise<number> {
  // This is a placeholder for the full consolidation logic.
  // Full implementation would compare embeddings pairwise and merge.
  // For now, deduplicate exact content matches.
  const inv = supabase.schema('inventory');
  const { data: memories } = await inv
    .from('ai_memory')
    .select('id, content, access_count')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .is('expires_at', null)
    .order('access_count', { ascending: false })
    .limit(200);

  if (!memories || memories.length < 2) return 0;

  const seen = new Map<string, string>(); // content → id (keep highest access_count)
  const toExpire: string[] = [];

  for (const mem of memories) {
    const normalized = mem.content.trim().toLowerCase();
    if (seen.has(normalized)) {
      toExpire.push(mem.id);
    } else {
      seen.set(normalized, mem.id);
    }
  }

  if (toExpire.length > 0) {
    await inv.from('ai_memory')
      .update({ expires_at: new Date().toISOString() })
      .in('id', toExpire);
  }

  return toExpire.length;
}
