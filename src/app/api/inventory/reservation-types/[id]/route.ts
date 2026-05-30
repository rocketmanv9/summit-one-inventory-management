import { z } from 'zod';
import { updateRoute, deleteRoute } from '@/lib/api/typed-crud';

export const PATCH = updateRoute({
  schema: 'inventory',
  table: 'reservation_types',
  segment: 'reservation-types',
  bodySchema: z.object({
    display_name: z.string().min(1).optional(),
    description: z.string().nullish(),
    sort_order: z.number().optional(),
    is_active: z.boolean().optional(),
  }),
});

export const DELETE = deleteRoute({
  schema: 'inventory',
  table: 'reservation_types',
  segment: 'reservation-types',
});
