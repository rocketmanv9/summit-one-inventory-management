/**
 * AI Audit Logger — Structured decision audit trail.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = any;

export interface AuditEntry {
  tenantId: string;
  conversationId?: string | null;
  traceId?: string | null;
  userId: string;
  actionType: string;
  actionName: string;
  input: Record<string, any>;
  output?: Record<string, any>;
  confidence?: number;
  modelUsed?: string;
  tokensUsed?: number;
  latencyMs?: number;
}

export async function logAuditEntry(supabase: SupabaseClientLike, entry: AuditEntry): Promise<void> {
  try {
    await supabase.schema('inventory').from('ai_audit_log').insert({
      tenant_id: entry.tenantId,
      conversation_id: entry.conversationId || null,
      trace_id: entry.traceId || null,
      user_id: entry.userId,
      action_type: entry.actionType,
      action_name: entry.actionName,
      input: entry.input,
      output: entry.output || null,
      confidence: entry.confidence || null,
      model_used: entry.modelUsed || null,
      tokens_used: entry.tokensUsed || null,
      latency_ms: entry.latencyMs || null,
    });
  } catch {
    // Audit logging is non-critical
  }
}
