/**
 * Entity Resolution Node — Uses ontology to resolve entities in the user message.
 */
import type { ChatGraphState, ChatGraphUpdate } from '../graph-types';
import { resolveEntities } from '../../ontology/entity-resolver';

export async function resolveEntitiesNode(state: ChatGraphState): Promise<ChatGraphUpdate> {
  try {
    const resolved = await resolveEntities(state.supabase, state.tenantId, state.userMessage);
    return {
      resolvedEntities: resolved.map((r) => ({
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        canonical_name: r.canonical_name,
        confidence: r.confidence,
      })),
      nodesVisited: ['resolve_entities'],
    };
  } catch {
    return { nodesVisited: ['resolve_entities'] };
  }
}
