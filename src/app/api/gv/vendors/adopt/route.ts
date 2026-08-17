import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { adoptCatalogVendorsIntoSupplyChain } from '@/lib/vendors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * POST /api/gv/vendors/adopt
 *
 * Adopt one or more vendors from the platform catalog into the tenant's vendor list.
 *
 * NOTE: this used to call the chassis tenant SDK `.adopt()`, which targets
 * `public.vendors` on the GV project — a table that does NOT exist there. The
 * real tenant vendor store is inventory's `supply_chain.vendors`. This route now
 * delegates to the same copy-on-write helper as POST /api/inventory/vendors/adopt
 * so the legacy path is no longer a landmine. Prefer /api/inventory/vendors/adopt.
 */
const AdoptVendorsSchema = z.object({
  catalogVendorIds: z.array(z.string().uuid()).min(1).max(50),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = AdoptVendorsSchema.parse(await req.json());

  const sc = (supabase as any).schema('supply_chain');
  const result = await adoptCatalogVendorsIntoSupplyChain(sc, ctx.tenantId, body.catalogVendorIds, idempotencyKey);

  log.info('vendor.adopted', { adopted: result.adopted.length, skipped: result.skipped });

  // trigger_vendor_events on supply_chain.vendors emits vendor.created per insert,
  // so the route returns events: [] to avoid double-emitting.
  return { data: result, status: 201, events: [] };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/gv/vendors/adopt' });
