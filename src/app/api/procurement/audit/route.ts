/**
 * Procurement Audit Log
 * GET — query procurement audit trail
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session }) => {
  const url = new URL(req.url);
  const entityType = url.searchParams.get('entity_type');
  const entityId = url.searchParams.get('entity_id');
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  const offset = (page - 1) * limit;

  const adminClient = getAdminClient();
  const proc = (adminClient as any).schema('procurement');

  let query = proc
    .from('audit_log')
    .select('id, entity_type, entity_id, action, old_value, new_value, actor_user_id, details, created_at', { count: 'exact' })
    .eq('tenant_id', session.tenantId!)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (entityType) query = query.eq('entity_type', entityType);
  if (entityId) query = query.eq('entity_id', entityId);

  const { data, count } = await query;

  return Response.json({
    data: data || [],
    meta: { total: count || 0, page, pageSize: limit },
  });
}, { serviceName: SERVICE_NAME });
