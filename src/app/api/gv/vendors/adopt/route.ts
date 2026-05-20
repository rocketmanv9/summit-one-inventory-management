import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { getTenantVendorClient } from '@/lib/vendors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * POST /api/gv/vendors/adopt
 *
 * Adopt one or more vendors from the platform catalog into the tenant's vendor list.
 */
const AdoptVendorsSchema = z.object({
  catalogVendorIds: z.array(z.string().uuid()).min(1).max(50),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = AdoptVendorsSchema.parse(await req.json());

  const client = await getTenantVendorClient(ctx.tenantId);
  const result = await client.adopt(body.catalogVendorIds);

  log.info('vendor.adopted', { count: body.catalogVendorIds.length });

  // GV service emits its own events — no local outbox events needed for this proxy route
  return { data: result, status: 201, events: [] };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/gv/vendors/adopt' });
