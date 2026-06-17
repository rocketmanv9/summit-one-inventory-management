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

  // The RPC RETURNS TABLE(...) so Supabase hands back an array of rows.
  // Flatten the single summary row and map *_count -> the keys the page reads.
  const row = Array.isArray(data) ? data[0] : data;
  return {
    data: {
      method: body.method,
      items_classified: row?.items_classified ?? 0,
      class_a: row?.class_a_count ?? 0,
      class_b: row?.class_b_count ?? 0,
      class_c: row?.class_c_count ?? 0,
      class_d: row?.class_d_count ?? 0,
    },
    status: 200,
    events: [],
  };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/abc-classification/calculate' });
