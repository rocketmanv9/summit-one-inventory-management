/**
 * LangGraph Workflow Types
 */

import type { ServerToolContext, ServerToolResult } from '../server-tools';
import type { UserRole } from '../tool-governance';

export interface WorkflowState {
  // Input
  tenantId: string;
  userId: string;
  userMessage: string;
  conversationId: string | null;
  userRole: UserRole;
  surface: string;

  // Resolved context
  intent: string | null;
  intentConfidence: number;
  resolvedEntities: Array<{
    entity_type: string;
    entity_id: string;
    canonical_name: string;
    confidence: number;
  }>;
  retrievedContext: string[];

  // Tool execution
  selectedTools: string[];
  toolResults: Array<{ name: string; result: ServerToolResult; success: boolean }>;
  permissionDenied: string | null;

  // Approval gate
  requiresApproval: boolean;
  approvalGateId: string | null;

  // Output
  response: string;
  dataDisplay: any | null;
  confidence: number;
  traceId: string | null;
  nodesVisited: string[];
  error: string | null;

  // Server tool context (injected)
  serverToolCtx: ServerToolContext;
  supabase: any;
}

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
