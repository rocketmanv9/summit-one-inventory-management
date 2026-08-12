/**
 * LangGraph Workflow Types — Annotation-based state definition
 */

import { Annotation } from '@langchain/langgraph';
import type { ServerToolContext, ServerToolResult } from '../server-tools';
import type { UserRole } from '../tool-governance';

// Entity resolved during the resolve_entities node
export interface ResolvedEntity {
  entity_type: string;
  entity_id: string;
  canonical_name: string;
  confidence: number;
}

// Single tool execution result
export interface ToolResultEntry {
  name: string;
  result: ServerToolResult;
  success: boolean;
}

/**
 * Chat graph state defined via LangGraph Annotation.
 *
 * Fields with `reducer` use append semantics — nodes return only *new* items
 * and the framework concatenates them onto the existing array.
 *
 * Fields without a reducer use last-write-wins (default LangGraph behavior).
 */
export const ChatGraphAnnotation = Annotation.Root({
  // ── Input (set once at invocation) ──────────────────────────────────
  tenantId: Annotation<string>,
  userId: Annotation<string>,
  userMessage: Annotation<string>,
  conversationId: Annotation<string | null>,
  userRole: Annotation<UserRole>,
  surface: Annotation<string>,

  // ── Resolved context ────────────────────────────────────────────────
  intent: Annotation<string | null>,
  intentConfidence: Annotation<number>,

  resolvedEntities: Annotation<ResolvedEntity[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),

  retrievedContext: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),

  // ── Tool execution ──────────────────────────────────────────────────
  selectedTools: Annotation<string[]>({
    reducer: (_left, right) => right, // overwrite — select_tools sets the full list
    default: () => [],
  }),

  toolResults: Annotation<ToolResultEntry[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),

  permissionDenied: Annotation<string | null>,

  // ── Approval gate ───────────────────────────────────────────────────
  requiresApproval: Annotation<boolean>,
  approvalGateId: Annotation<string | null>,

  // ── Loop control ────────────────────────────────────────────────────
  toolRound: Annotation<number>,
  maxToolRounds: Annotation<number>,
  needsMoreTools: Annotation<boolean>,

  // ── Output ──────────────────────────────────────────────────────────
  response: Annotation<string>,
  dataDisplay: Annotation<any | null>,
  confidence: Annotation<number>,
  traceId: Annotation<string | null>,

  nodesVisited: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),

  error: Annotation<string | null>,

  // ── Injected context (not serializable, set once) ───────────────────
  serverToolCtx: Annotation<ServerToolContext>,
  supabase: Annotation<any>,
});

/** Full state type — what nodes receive as input. */
export type ChatGraphState = typeof ChatGraphAnnotation.State;

/** Partial update type — what nodes return. */
export type ChatGraphUpdate = typeof ChatGraphAnnotation.Update;

export type WorkflowNodeName =
  | 'classify_intent'
  | 'resolve_entities'
  | 'check_permissions'
  | 'semantic_retrieve'
  | 'select_tools'
  | 'execute_tools'
  | 'approval_gate'
  | 'audit_emit'
  | 'summarize';
