/**
 * Approval Gate Node — Human-in-the-loop for high-risk operations.
 */
import type { ChatGraphState, ChatGraphUpdate } from '../graph-types';
import { toolRegistry } from '../../tool-registry';

export async function approvalGateNode(state: ChatGraphState): Promise<ChatGraphUpdate> {
  const highRiskTools = state.selectedTools.filter((t) => {
    const gov = toolRegistry.getGovernance(t);
    return gov?.riskLevel === 'high' && gov?.requiresConfirmation;
  });

  if (highRiskTools.length === 0) {
    return { requiresApproval: false, nodesVisited: ['approval_gate'] };
  }

  try {
    const inv = state.supabase.schema('inventory');
    // Create workflow trace first if needed
    let traceId = state.traceId;
    if (!traceId) {
      const { data } = await inv.from('ai_workflow_traces').insert({
        tenant_id: state.tenantId,
        conversation_id: state.conversationId,
        workflow_type: 'approval_required',
        nodes_visited: state.nodesVisited,
        status: 'awaiting_approval',
      }).select('id').single();
      traceId = data?.id;
    }

    if (traceId) {
      const { data: gate } = await inv.from('ai_approval_gates').insert({
        tenant_id: state.tenantId,
        trace_id: traceId,
        gate_type: 'high_risk_tool',
        description: `Approval required for: ${highRiskTools.join(', ')}`,
        proposed_action: { tools: highRiskTools, params: {} },
      }).select('id').single();

      return {
        requiresApproval: true,
        approvalGateId: gate?.id || null,
        traceId,
        response: 'This action requires approval. An approval request has been created.',
        nodesVisited: ['approval_gate'],
      };
    }
  } catch { /* non-critical */ }

  return {
    requiresApproval: true,
    response: 'This action requires approval. An approval request has been created.',
    nodesVisited: ['approval_gate'],
  };
}
