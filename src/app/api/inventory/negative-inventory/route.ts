import { z } from 'zod';
import { createRoute } from '@/lib/api/typed-crud';

export const POST = createRoute({
  schema: 'inventory',
  table: 'negative_inventory_config',
  mode: 'upsert',
  onConflict: "tenant_id,scope,COALESCE(category_id,'00000000-0000-0000-0000-000000000000'::uuid),COALESCE(catalog_item_id,'00000000-0000-0000-0000-000000000000'::uuid)",
  bodySchema: z.object({
    scope: z.enum(['global', 'category', 'item']),
    category_id: z.string().nullish(),
    catalog_item_id: z.string().nullish(),
    allow_negative: z.boolean(),
  }),
});
