import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CreateCycleCountSchema = z.object({
  location_id: z.string().uuid(),
  count_type: z.enum(['full', 'partial', 'spot_check']),
  is_blind: z.boolean().optional().default(false),
  scheduled_for: z.string().optional(),
  catalog_item_ids: z.array(z.string().uuid()).nullable().optional(),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = CreateCycleCountSchema.parse(await req.json());

  const inv = (supabase as any).schema('inventory');

  const { data, error } = await inv.rpc('rpc_inv_cycle_count_start', {
    p_tenant_id: ctx.tenantId,
    p_location_id: body.location_id,
    p_count_type: body.count_type,
    p_catalog_item_ids: body.catalog_item_ids || null,
    p_counted_by_user_id: ctx.userId,
    p_last_event_id: idempotencyKey,
  });

  if (error) {
    log.error('cycle_count.start_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('cycle_count.started', { cycleCountId: data, countType: body.count_type });

  return {
    data: { id: data },
    status: 201,
    events: [{
      event_name: 'cycle_count.started',
      payload: {
        cycle_count_id: data,
        location_id: body.location_id,
        count_type: body.count_type,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, {
  serviceName: SERVICE_NAME,
  scope: 'POST /api/inventory/cycle-counts',
});
