import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/inventory/items/:id/snapshot
 *
 * Returns stock snapshot for a catalog item:
 * on_hand, reserved, available, inbound, per-location breakdown.
 * Tenant-scoped via RLS + JWT.
 */
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/inventory/items/[id]/snapshot -> segments = ['', 'api', 'inventory', 'items', ID, 'snapshot']
  const id = segments[segments.length - 2];

  if (!id) {
    throw AppError.badRequest('Item ID required');
  }

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });

  const { data, error } = await (supabase as any).schema('inventory').rpc('rpc_item_stock_snapshot', {
    p_catalog_item_id: id,
  });

  if (error) {
    log.error('[ItemSnapshot] RPC error:', error);
    if (error.message?.includes('not found')) {
      throw AppError.notFound('Item not found');
    }
    throw AppError.internal('Snapshot failed');
  }

  return Response.json(data);
}, { serviceName: SERVICE_NAME });
