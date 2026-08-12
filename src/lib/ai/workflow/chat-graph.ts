/**
 * LangGraph Chat Workflow — Real StateGraph implementation.
 *
 * Graph topology:
 *   START → classify_intent → resolve_entities → select_tools → check_permissions
 *     → [routeAfterPermissions]
 *         if permissionDenied → summarize → audit_emit → END
 *         else → approval_gate
 *     → [routeAfterApproval]
 *         if requiresApproval → summarize → audit_emit → END
 *         else → semantic_retrieve → execute_tools
 *     → [routeAfterTools]
 *         if needsMoreTools → execute_tools (retry loop)
 *         else → summarize → audit_emit → END
 *
 * Feature-flagged via AI_GRAPH_WORKFLOW env var.
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import { ChatGraphAnnotation, type ChatGraphState } from './graph-types';
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

// ── Conditional edge routers ──────────────────────────────────────────

function routeAfterPermissions(state: ChatGraphState): 'summarize' | 'approval_gate' {
  return state.permissionDenied ? 'summarize' : 'approval_gate';
}

function routeAfterApproval(state: ChatGraphState): 'summarize' | 'semantic_retrieve' {
  return state.requiresApproval ? 'summarize' : 'semantic_retrieve';
}

function routeAfterTools(state: ChatGraphState): 'execute_tools' | 'summarize' {
  return state.needsMoreTools ? 'execute_tools' : 'summarize';
}

// ── Build and compile the graph (singleton) ───────────────────────────

function buildGraph() {
  const graph = new StateGraph(ChatGraphAnnotation)
    // Add all nodes
    .addNode('classify_intent', classifyIntentNode)
    .addNode('resolve_entities', resolveEntitiesNode)
    .addNode('select_tools', selectToolsNode)
    .addNode('check_permissions', checkPermissionsNode)
    .addNode('approval_gate', approvalGateNode)
    .addNode('semantic_retrieve', semanticRetrieveNode)
    .addNode('execute_tools', executeToolsNode)
    .addNode('summarize', summarizeNode)
    .addNode('audit_emit', auditEmitNode)

    // Linear edges: START → classify → resolve → select → check
    .addEdge(START, 'classify_intent')
    .addEdge('classify_intent', 'resolve_entities')
    .addEdge('resolve_entities', 'select_tools')
    .addEdge('select_tools', 'check_permissions')

    // Conditional: after permissions check
    .addConditionalEdges('check_permissions', routeAfterPermissions, {
      summarize: 'summarize',
      approval_gate: 'approval_gate',
    })

    // Conditional: after approval gate
    .addConditionalEdges('approval_gate', routeAfterApproval, {
      summarize: 'summarize',
      semantic_retrieve: 'semantic_retrieve',
    })

    // Linear: semantic_retrieve → execute_tools
    .addEdge('semantic_retrieve', 'execute_tools')

    // Conditional: after tool execution (retry loop or done)
    .addConditionalEdges('execute_tools', routeAfterTools, {
      execute_tools: 'execute_tools',
      summarize: 'summarize',
    })

    // Linear: summarize → audit → END
    .addEdge('summarize', 'audit_emit')
    .addEdge('audit_emit', END);

  return graph.compile();
}

let _compiled: ReturnType<typeof buildGraph> | null = null;

function getCompiledGraph() {
  if (!_compiled) {
    _compiled = buildGraph();
  }
  return _compiled;
}

// ── Public API ────────────────────────────────────────────────────────

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
}): Promise<ChatGraphState> {
  const graph = getCompiledGraph();

  const initial: Parameters<typeof graph.invoke>[0] = {
    tenantId: params.tenantId,
    userId: params.userId,
    userMessage: params.userMessage,
    conversationId: params.conversationId,
    userRole: params.userRole,
    surface: params.surface,
    serverToolCtx: params.serverToolCtx,
    supabase: params.supabase,
    // Defaults
    intent: null,
    intentConfidence: 0,
    resolvedEntities: [],
    retrievedContext: [],
    selectedTools: [],
    toolResults: [],
    permissionDenied: null,
    requiresApproval: false,
    approvalGateId: null,
    toolRound: 0,
    maxToolRounds: 5,
    needsMoreTools: false,
    response: '',
    dataDisplay: null,
    confidence: 0,
    traceId: null,
    nodesVisited: [],
    error: null,
  };

  return graph.invoke(initial);
}
