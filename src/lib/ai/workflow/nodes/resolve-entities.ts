/**
 * Entity Resolution Node — Uses ontology to resolve entities in the user message.
 */
import type { WorkflowState } from '../graph-types';
import { resolveEntities } from '../../ontology/entity-resolver';

export async function resolveEntitiesNode(state: WorkflowState): Promise<Partial<WorkflowState>> {
  try {
    const resolved = await resolveEntities(state.supabase, state.tenantId, state.userMessage);
    return {
      resolvedEntities: resolved.map((r) => ({
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        canonical_name: r.canonical_name,
        confidence: r.confidence,
      })),
      nodesVisited: [...state.nodesVisited, 'resolve_entities'],
    };
  } catch {
    return { nodesVisited: [...state.nodesVisited, 'resolve_entities'] };
  }
}
