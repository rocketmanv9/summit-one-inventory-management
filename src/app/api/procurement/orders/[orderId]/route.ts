/**
 * Procurement Order Detail
 * GET — order detail with items
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session }) => {
  const pathParts = new URL(req.url).pathname.split('/');
  const orderId = pathParts[pathParts.length - 1];
  if (!orderId) throw AppError.badRequest('Missing order ID');

  const adminClient = getAdminClient();
  const proc = (adminClient as any).schema('procurement');

  const { data: order } = await proc
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('tenant_id', session.tenantId!)
    .limit(1)
    .maybeSingle();

  if (!order) throw AppError.notFound('Order not found');

  const { data: items } = await proc
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .eq('tenant_id', session.tenantId!)
    .order('created_at', { ascending: true })
    .limit(100);

  // Get audit log entries for this order
  const { data: auditEntries } = await proc
    .from('audit_log')
    .select('id, action, old_value, new_value, actor_user_id, created_at')
    .eq('entity_type', 'order')
    .eq('entity_id', orderId)
    .eq('tenant_id', session.tenantId!)
    .order('created_at', { ascending: true })
    .limit(50);

  return Response.json({
    data: {
      ...order,
      items: items || [],
      timeline: auditEntries || [],
    },
  });
}, { serviceName: SERVICE_NAME });
