import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { updateRouteOCC, idFromPath } from '@/lib/api/typed-crud';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const PATCH = updateRouteOCC({
  schema: 'inventory',
  table: 'item_categories',
  segment: 'categories',
  bodySchema: z.object({ expected_last_event_id: z.string().min(1) }).passthrough(),
});

// Delete preserves the prior cascade: remove the category's sku_settings first,
// then the category itself (optimistic concurrency). The item_categories
// trigger owns event emission.
const DeleteCategorySchema = z.object({ expected_last_event_id: z.string().min(1) });

export const DELETE = createSessionWriteRoute(async ({ req, body, log, supabase }) => {
  const id = idFromPath(req, 'categories');
  const inv = (supabase as any).schema('inventory');

  const { error: skuErr } = await inv.from('sku_settings').delete().eq('category_id', id);
  if (skuErr) {
    log.error('item_category.delete_sku_failed', { error: skuErr.message });
    throw AppError.internal(skuErr.message);
  }

  const { data, error } = await inv
    .from('item_categories')
    .delete()
    .eq('id', id)
    .eq('last_event_id', body.expected_last_event_id)
    .select('id')
    .maybeSingle();
  if (error) { log.error('item_category.delete_failed', { error: error.message }); throw AppError.internal(error.message); }
  if (!data) throw AppError.conflict('Category was updated by someone else. Please refresh and try again.');

  return { data, status: 200, events: [] };
}, {
  bodySchema: DeleteCategorySchema,
  emissionOwner: 'trigger',
  serviceName: SERVICE_NAME,
  scope: 'DELETE /api/inventory/categories/[id]',
});
