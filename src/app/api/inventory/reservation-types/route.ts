import { z } from 'zod';
import { createRoute } from '@/lib/api/typed-crud';

// reservation_types: tenant scoping enforced by the tenant service client + RLS
// (no optimistic-concurrency version check, matching the prior RPC behavior).
export const POST = createRoute({
  schema: 'inventory',
  table: 'reservation_types',
  bodySchema: z.object({
    type_key: z.string().min(1),
    display_name: z.string().min(1),
    description: z.string().nullish(),
    sort_order: z.number().default(0),
    is_active: z.boolean().default(true),
  }),
});
