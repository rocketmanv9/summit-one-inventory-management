/**
 * AI Audit Log Query
 * GET /api/ai/audit?days=7&action_type=tool_execution
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session }) => {
  const url = new URL(req.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '7', 10), 1), 90);
  const actionType = url.searchParams.get('action_type');

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  let query = (supabase as any).schema('inventory')
    .from('ai_audit_log')
    .select('id, action_type, action_name, confidence, model_used, tokens_used, latency_ms, created_at')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(200);

  if (actionType) query = query.eq('action_type', actionType);

  const { data } = await query;
  return Response.json({ data: data || [] });
}, { serviceName: SERVICE_NAME });
