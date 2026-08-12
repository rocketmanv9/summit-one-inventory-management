/**
 * Punchout Orders API
 * GET — list punchout orders for the tenant
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ session, req }) => {
  const adminClient = getAdminClient();
  const inv = (adminClient as any).schema('inventory');

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const orderId = url.searchParams.get('id');

  if (orderId) {
    const { data: order, error } = await inv
      .from('punchout_orders')
      .select('id, status, setup_payload_id, punchout_url, user_email, poom_items, poom_total, items, shipping_address, total_cost, order_payload_id, order_submitted_at, order_response_status, amazon_order_id, purchase_order_id, error_message, metadata, created_at, updated_at')
      .eq('id', orderId)
      .eq('tenant_id', session.tenantId!)
      .limit(1)
      .single();

    if (error || !order) throw AppError.notFound('Punchout order not found.');

    return Response.json({ data: order });
  }

  let query = inv
    .from('punchout_orders')
    .select('id, status, user_email, poom_total, total_cost, items, order_payload_id, purchase_order_id, error_message, created_at, updated_at')
    .eq('tenant_id', session.tenantId!)
    .order('created_at', { ascending: false })
    .limit(100);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw AppError.internal(error.message);

  return Response.json({ data: data || [] });
}, { serviceName: SERVICE_NAME });
