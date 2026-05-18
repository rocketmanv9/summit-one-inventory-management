/**
 * LangGraph Chat Workflow — Stateful graph replacing the flat 5-round tool loop.
 *
 * Graph: classify_intent → resolve_entities → select_tools → check_permissions
 *        → approval_gate → execute_tools → semantic_retrieve → audit_emit → summarize
 *
 * Feature-flagged via AI_GRAPH_WORKFLOW env var.
 */

import type { WorkflowState } from './graph-types';
import type { ServerToolContext } from '../server-tools';
import type { UserRole } from '../tool-governance';

import { classifyIntentNode } from './nodes/classify-intent';
import { resolveEntitiesNode } from './nodes/resolve-entities';
import { selectToolsNode } from './nodes/select-tools';
import { checkPermissionsNode } from './nodes/check-permissions';
import { approvalGateNode } from './nodes/approval-gate';
import { executeToolsNode } from './nodes/execute-tools';
import { semanticRetrieveNode } from './nodes/semantic-retrieve';
import { auditEmitNode } from './nodes/audit-emit';
import { summarizeNode } from './nodes/summarize';

export function isGraphWorkflowEnabled(): boolean {
  return process.env.AI_GRAPH_WORKFLOW === 'true';
}

function createInitialState(params: {
  tenantId: string;
  userId: string;
  userMessage: string;
  conversationId: string | null;
  userRole: UserRole;
  surface: string;
  serverToolCtx: ServerToolContext;
  supabase: any;
}): WorkflowState {
  return {
    ...params,
    intent: null,
    intentConfidence: 0,
    resolvedEntities: [],
    retrievedContext: [],
    selectedTools: [],
    toolResults: [],
    permissionDenied: null,
    requiresApproval: false,
    approvalGateId: null,
    response: '',
    dataDisplay: null,
    confidence: 0,
    traceId: null,
    nodesVisited: [],
    error: null,
  };
}

type WorkflowNode = (state: WorkflowState) => Promise<Partial<WorkflowState>>;

/**
 * Execute the workflow graph as a sequential pipeline with conditional branching.
 * Uses LangGraph-compatible node signatures but runs them in a deterministic order.
 * This will be migrated to full StateGraph once the LangGraph API stabilizes.
 */
async function executeGraph(state: WorkflowState): Promise<WorkflowState> {
  const apply = async (node: WorkflowNode) => {
    const patch = await node(state);
    Object.assign(state, patch);
  };

  await apply(classifyIntentNode);
  await apply(resolveEntitiesNode);
  await apply(selectToolsNode);
  await apply(checkPermissionsNode);

  if (state.permissionDenied) {
    await apply(summarizeNode);
    await apply(auditEmitNode);
    return state;
  }

  await apply(approvalGateNode);

  if (state.requiresApproval) {
    state.response = `This action requires approval. An approval request has been created.`;
    await apply(auditEmitNode);
    await apply(summarizeNode);
    return state;
  }

  await apply(executeToolsNode);
  await apply(semanticRetrieveNode);
  await apply(auditEmitNode);
  await apply(summarizeNode);

  return state;
}

/**
 * Run the chat workflow graph.
 */
export async function runChatGraph(params: {
  tenantId: string;
  userId: string;
  userMessage: string;
  conversationId: string | null;
  userRole: UserRole;
  surface: string;
  serverToolCtx: ServerToolContext;
  supabase: any;
}): Promise<WorkflowState> {
  const initial = createInitialState(params);
  return executeGraph(initial);
}
