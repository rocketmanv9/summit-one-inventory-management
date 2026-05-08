import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CalculateSchema = z.object({
  method: z.enum(['value', 'usage', 'hybrid']).default('value'),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = CalculateSchema.parse(await req.json());
  const inv = (supabase as any).schema('inventory');

  const { data, error } = await inv.rpc('rpc_calculate_abc_classification', {
    p_method: body.method,
  });

  if (error) {
    log.error('abc_classification.calculate_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('abc_classification.calculated', { method: body.method });

  return {
    data: data || { method: body.method },
    status: 200,
    events: [{
      event_name: 'abc_classification.calculated',
      payload: { method: body.method },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/inventory/abc-classification/calculate' });
