import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { adoptCatalogVendorsIntoSupplyChain } from '@/lib/vendors';
import { assertCapability } from '@/lib/access-server';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const BodySchema = z.object({ catalogVendorIds: z.array(z.string().uuid()).min(1).max(50) });

// Adopt one or more GV catalog vendors into the tenant's OWN operational vendor
// table (supply_chain.vendors) + contacts/addresses — copy-on-write from the
// shared catalog. This is the unified path: the GV side is a browse catalog,
// the tenant's real vendors live in supply_chain.
export const POST = createSessionWriteRoute(async ({ ctx, body, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'vendors.manage');
  const { catalogVendorIds } = body as z.infer<typeof BodySchema>;
  const sc = (supabase as any).schema('supply_chain');

  const result = await adoptCatalogVendorsIntoSupplyChain(sc, ctx.tenantId!, catalogVendorIds, idempotencyKey);
  log.info('adopt.completed', { adopted: result.adopted.length, skipped: result.skipped });

  // trigger_vendor_events on supply_chain.vendors emits vendor.created per insert,
  // so the route returns events: [] to avoid double-emitting.
  return { data: result, status: 201, events: [] };
}, { bodySchema: BodySchema, emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/vendors/adopt' });
