/**
 * Autofill — Partial form data → field suggestions via ontology + memory.
 */
import { getRelevantMemories } from '../memory';
import { resolveEntity } from '../ontology/entity-resolver';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = any;

export interface AutofillSuggestion {
  field: string;
  value: string;
  source: 'memory' | 'ontology' | 'inference';
  confidence: number;
}

export async function suggestAutofill(
  supabase: SupabaseClientLike,
  tenantId: string,
  userId: string,
  partialData: Record<string, string>
): Promise<AutofillSuggestion[]> {
  const suggestions: AutofillSuggestion[] = [];
  const context = Object.values(partialData).filter(Boolean).join(' ');
  if (!context) return suggestions;

  // Check memories for preferences
  try {
    const memories = await getRelevantMemories(supabase, tenantId, userId, context, 3);
    for (const mem of memories) {
      if (mem.memory_type === 'preference' && mem.content.includes(':')) {
        const [field, value] = mem.content.split(':').map((s) => s.trim());
        if (field && value && !partialData[field]) {
          suggestions.push({ field, value, source: 'memory', confidence: mem.similarity });
        }
      }
    }
  } catch { /* non-critical */ }

  // Resolve entity names via ontology
  for (const [field, value] of Object.entries(partialData)) {
    if (!value || value.length < 2) continue;
    try {
      const resolved = await resolveEntity(supabase, tenantId, value);
      if (resolved && resolved.confidence > 0.8) {
        suggestions.push({ field, value: resolved.canonical_name, source: 'ontology', confidence: resolved.confidence });
      }
    } catch { /* non-critical */ }
  }

  return suggestions;
}
