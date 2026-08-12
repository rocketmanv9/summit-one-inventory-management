import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/inventory/locations/:id/snapshot
 *
 * Returns "What's here?" for a location:
 * totals (on_hand, reserved, available) + itemized breakdown.
 * Tenant-scoped via RLS + JWT.
 */
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/inventory/locations/[id]/snapshot -> segments = ['', 'api', 'inventory', 'locations', ID, 'snapshot']
  const id = segments[segments.length - 2];

  if (!id) {
    throw AppError.badRequest('Location ID required');
  }

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });

  // Pass tenant explicitly — same reasoning as the item snapshot route: the
  // SECURITY DEFINER RPC's current_tenant_id() fallback depends on a GUC set by
  // a prior set_claim request that PostgREST pooling can strand on another
  // connection. p_tenant_id resolves tenant atomically within this call.
  const { data, error } = await (supabase as any).schema('inventory').rpc('rpc_location_inventory_snapshot', {
    p_location_id: id,
    p_tenant_id: session.tenantId,
  });

  if (error) {
    log.error('[LocationSnapshot] RPC error', { locationId: id, code: error.code, message: error.message });
    if (error.message?.includes('not found')) {
      throw AppError.notFound('Location not found');
    }
    throw AppError.internal(`Location snapshot failed: ${error.message ?? 'unknown error'}`);
  }

  return Response.json(data);
}, { serviceName: SERVICE_NAME });
