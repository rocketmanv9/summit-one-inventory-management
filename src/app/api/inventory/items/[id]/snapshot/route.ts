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

  // Pass the tenant explicitly. The RPC is SECURITY DEFINER and resolves tenant
  // via current_tenant_id(); for a service-role client that depends on the
  // app.current_tenant_id GUC set by a SEPARATE prior set_claim request, which
  // does not reliably survive PostgREST connection pooling — causing an
  // intermittent "Authentication required" (the 2026-08-06 "snapshot failed"
  // bug). Passing p_tenant_id makes tenant resolution atomic within this call.
  const { data, error } = await (supabase as any).schema('inventory').rpc('rpc_item_stock_snapshot', {
    p_catalog_item_id: id,
    p_tenant_id: session.tenantId,
  });

  if (error) {
    log.error('[ItemSnapshot] RPC error', { itemId: id, code: error.code, message: error.message });
    if (error.message?.includes('not found')) {
      throw AppError.notFound('Item not found');
    }
    // Surface the underlying cause instead of an opaque "Snapshot failed" — the
    // swallowed error is what made the original bug expensive to diagnose.
    throw AppError.internal(`Item snapshot failed: ${error.message ?? 'unknown error'}`);
  }

  return Response.json(data);
}, { serviceName: SERVICE_NAME });
