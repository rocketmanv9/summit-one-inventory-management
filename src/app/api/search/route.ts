import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/search?q=...&limit=5
 *
 * Global cross-entity search. Tenant-scoped via RLS + JWT.
 * Returns grouped results: items, assets, locations, vendors, purchase_orders, reservations.
 */
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '5', 10) || 5, 1), 20);

  if (!q || q.length === 0) {
    return Response.json({
      items: [], assets: [], locations: [], vendors: [], purchase_orders: [], reservations: [],
    });
  }

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });

  const { data, error } = await (supabase as any).schema('inventory').rpc('rpc_global_search', {
    p_query: q,
    p_limit: limit,
  });

  if (error) {
    log.error('[Search] RPC error:', error);
    throw AppError.internal('Search failed');
  }

  return Response.json(data);
}, { serviceName: SERVICE_NAME });
