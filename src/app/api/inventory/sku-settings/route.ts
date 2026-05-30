import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// sku_settings has no event trigger → route-owned (no event needed for an
// internal counter/config). Upsert keyed on category_id.
export const POST = createSessionWriteRoute(async ({ body, log, supabase }) => {
  const inv = (supabase as any).schema('inventory');
  const { error } = await inv.from('sku_settings').upsert(body, { onConflict: 'category_id' });
  if (error) { log.error('sku_settings.save_failed', { error: error.message }); throw AppError.internal(error.message); }
  return { data: { ok: true }, status: 200, events: [] };
}, {
  bodySchema: z.object({ category_id: z.string().min(1) }).passthrough(),
  emissionOwner: 'route',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/inventory/sku-settings',
});
