import { z } from 'zod';
import { createWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { requireMobileSession } from '@/lib/mobile-auth';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const AddItemSchema = z.object({
  catalog_item_id: z.string().uuid(),
});

export const POST = createWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const session = await requireMobileSession(req);
  const body = AddItemSchema.parse(await req.json());

  const { data, error } = await (supabase as any).schema('inventory').rpc('rpc_inv_cycle_count_add_line', {
    p_cycle_count_id: session.cycleCountId,
    p_catalog_item_id: body.catalog_item_id,
    p_tenant_id: session.tenantId,
    // p_last_event_id is a UUID param; idempotencyKey is an arbitrary header value.
    // Use a guaranteed UUID (same as the create-item route).
    p_last_event_id: crypto.randomUUID(),
  });

  if (error) {
    log.error('mobile_count.add_item_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('mobile_count.item_added', {
    cycleCountId: session.cycleCountId,
    catalogItemId: body.catalog_item_id,
  });

  return {
    data,
    status: 201,
    events: [{
      event_name: 'cycle_count_line.added',
      payload: {
        cycle_count_id: session.cycleCountId,
        catalog_item_id: body.catalog_item_id,
        line_id: data?.id,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/m/count/add-item',
  authenticate: async (req: Request) => {
    const session = await requireMobileSession(req);
    const supabase = await createTenantServiceClient({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      tenantId: session.tenantId,
    });
    return { tenantId: session.tenantId, userId: session.userId, supabase };
  },
});
