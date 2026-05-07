import { z } from 'zod';
import { createWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { requireMobileSession } from '@/lib/mobile-auth';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const RecordCountSchema = z.object({
  catalog_item_id: z.string().uuid(),
  counted_qty: z.number().min(0),
});

export const POST = createWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const session = await requireMobileSession(req);
  const body = RecordCountSchema.parse(await req.json());

  const { data, error } = await (supabase as any).schema('inventory').rpc('rpc_inv_cycle_count_record', {
    p_tenant_id: session.tenantId,
    p_cycle_count_id: session.cycleCountId,
    p_catalog_item_id: body.catalog_item_id,
    p_counted_qty: body.counted_qty,
    p_last_event_id: idempotencyKey,
  });

  if (error) {
    log.error('mobile_count.record_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('mobile_count.recorded', {
    cycleCountId: session.cycleCountId,
    catalogItemId: body.catalog_item_id,
    qty: body.counted_qty,
  });

  return {
    data: { success: data },
    status: 200,
    events: [{
      event_name: 'mobile_count.recorded',
      payload: {
        cycle_count_id: session.cycleCountId,
        catalog_item_id: body.catalog_item_id,
        counted_qty: body.counted_qty,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, {
  serviceName: SERVICE_NAME,
  scope: 'POST /api/m/count/record',
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
