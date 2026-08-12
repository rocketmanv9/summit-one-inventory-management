/**
 * Duplicate Detector — Hybrid search + ontology aliases before entity creation.
 */
import { hybridSearch } from '../semantic/hybrid-search';
import { findAliases } from '../ontology/ontology-client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = any;

export interface DuplicateCandidate {
  entityType: string;
  entityId: string;
  name: string;
  matchMethod: 'alias' | 'semantic';
  score: number;
}

export async function checkForDuplicates(
  supabase: SupabaseClientLike,
  tenantId: string,
  entityType: string,
  name: string
): Promise<DuplicateCandidate[]> {
  const candidates: DuplicateCandidate[] = [];

  // Check aliases
  try {
    const aliases = await findAliases(supabase, tenantId, entityType, name);
    for (const a of aliases) {
      candidates.push({ entityType: a.entity_type, entityId: a.entity_id, name: a.alias, matchMethod: 'alias', score: 0.9 });
    }
  } catch { /* non-critical */ }

  // Semantic search
  try {
    const results = await hybridSearch(supabase, tenantId, name, { sourceTypes: [entityType], limit: 3 });
    for (const r of results) {
      if (r.combined_score > 0.8 && r.source_id) {
        candidates.push({ entityType: r.source_type, entityId: r.source_id, name: r.content.slice(0, 100), matchMethod: 'semantic', score: r.combined_score });
      }
    }
  } catch { /* non-critical */ }

  // Deduplicate by entityId
  const seen = new Set<string>();
  return candidates.filter((c) => { if (seen.has(c.entityId)) return false; seen.add(c.entityId); return true; });
}
