/**
 * Audit & Emit Node — Persists workflow trace to ai_workflow_traces.
 */
import type { ChatGraphState, ChatGraphUpdate } from '../graph-types';

export async function auditEmitNode(state: ChatGraphState): Promise<ChatGraphUpdate> {
  try {
    const inv = state.supabase.schema('inventory');
    const { data } = await inv.from('ai_workflow_traces').insert({
      tenant_id: state.tenantId,
      conversation_id: state.conversationId,
      workflow_type: state.intent || 'general',
      nodes_visited: state.nodesVisited,
      status: state.error ? 'failed' : 'completed',
      final_output: { response: state.response?.slice(0, 2000), tools: state.toolResults.map((t) => t.name) },
      error: state.error,
      total_duration_ms: null, // Set by caller
    }).select('id').single();

    return { traceId: data?.id || null, nodesVisited: ['audit_emit'] };
  } catch {
    return { nodesVisited: ['audit_emit'] };
  }
}
