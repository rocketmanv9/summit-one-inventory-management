import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Bulk reassign catalog items from one category to another. Each row is updated
// individually with an OCC guard (last_event_id) so concurrent edits surface as
// a 409 — mirrors the prior InventoryRPC.reassignCatalogItemsCategory loop.
// The catalog_items UPDATE trigger owns outbox emission (one event per row).
const BodySchema = z.object({
  old_category_id: z.string().min(1),
  new_category_id: z.string().min(1),
});

export const POST = createSessionWriteRoute(async ({ body, supabase, log }) => {
  const { old_category_id, new_category_id } = body as z.infer<typeof BodySchema>;
  const inv = (supabase as any).schema('inventory');

  const { data: items, error: fetchError } = await inv
    .from('catalog_items')
    .select('id, last_event_id')
    .eq('category_id', old_category_id);

  if (fetchError) {
    log.error('catalog_items.reassign_fetch_failed', { error: fetchError.message });
    throw AppError.internal(fetchError.message);
  }
  if (!items || items.length === 0) return { data: { count: 0 }, status: 200, events: [] };

  for (const item of items) {
    const next = crypto.randomUUID();
    const { data: updated, error } = await inv
      .from('catalog_items')
      .update({ category_id: new_category_id, last_event_id: next })
      .eq('id', item.id)
      .eq('last_event_id', item.last_event_id)
      .select('id')
      .maybeSingle();

    if (error) {
      log.error('catalog_items.reassign_failed', { error: error.message, item_id: item.id });
      throw AppError.internal(error.message);
    }
    if (!updated) {
      throw AppError.conflict(`Catalog item ${item.id} was updated by someone else. Please refresh and try again.`);
    }
  }

  return { data: { count: items.length }, status: 200, events: [] };
}, {
  bodySchema: BodySchema,
  emissionOwner: 'trigger',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/inventory/items/reassign-category',
});
