import { z } from 'zod';
import { createRoute } from '@/lib/api/typed-crud';

export const POST = createRoute({
  schema: 'inventory',
  table: 'uom_conversions',
  bodySchema: z.object({
    from_uom_term_id: z.string().min(1),
    to_uom_term_id: z.string().min(1),
    conversion_factor: z.number(),
    is_bidirectional: z.boolean().default(true),
  }),
});
