import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Bulk upsert of per-location reorder levels. No event trigger → route-owned.
const RowSchema = z.object({ catalog_item_id: z.string().min(1), location_id: z.string().min(1) }).passthrough();

export const POST = createSessionWriteRoute(async ({ body, log, supabase }) => {
  const rows = body as z.infer<typeof RowSchema>[];
  const inv = (supabase as any).schema('inventory');
  const { error } = await inv.from('inventory_levels').upsert(rows, { onConflict: 'catalog_item_id,location_id' });
  if (error) { log.error('inventory_levels.save_failed', { error: error.message }); throw AppError.internal(error.message); }
  return { data: { ok: true, count: rows.length }, status: 200, events: [] };
}, {
  bodySchema: z.array(RowSchema),
  emissionOwner: 'route',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/inventory/inventory-levels',
});
