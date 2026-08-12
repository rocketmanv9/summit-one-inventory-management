/**
 * Amazon Business Order API
 * POST — DEPRECATED: direct cXML ordering is not possible without a punchout session.
 *        Use the punchout flow instead (POST /punchout/start → Amazon → POOM webhook → POST /punchout/submit).
 * GET  — list Amazon Business orders for tenant (still active)
 */
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── POST: Deprecated — direct ordering requires punchout session ────────

const DeprecatedSchema = z.object({}).passthrough();

export const POST = createSessionWriteRoute(async ({ req }) => {
  DeprecatedSchema.parse(await req.json());

  throw AppError.badRequest(
    'This endpoint is deprecated. Amazon Business requires a punchout session (SupplierPartAuxiliaryID) ' +
    'to place orders. Use the punchout flow instead: ' +
    'POST /api/settings/integrations/amazon-business/punchout/start → shop on Amazon → ' +
    'POST /api/settings/integrations/amazon-business/punchout/submit'
  );
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/amazon-business/orders' });

// ── GET: List Amazon Business orders ─────────────────────────────────────

export const GET = createSessionReadRoute(async ({ session, req }) => {
  const adminClient = getAdminClient();
  const inv = (adminClient as any).schema('inventory');

  const url = new URL(req.url);
  const status = url.searchParams.get('status');

  let query = inv
    .from('amazon_business_orders')
    .select('id, amazon_order_id, purchase_order_id, status, items, total_cost, tracking_info, metadata, created_at, updated_at')
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
