import { z } from 'zod';
import { updateRouteOCC, deleteRouteOCC } from '@/lib/api/typed-crud';

export const PATCH = updateRouteOCC({
  schema: 'inventory',
  table: 'assignment_types',
  segment: 'assignment-types',
  bodySchema: z.object({
    expected_last_event_id: z.string().min(1),
    display_name: z.string().min(1).optional(),
    description: z.string().nullish(),
    icon: z.string().nullish(),
    sort_order: z.number().optional(),
    requires_id: z.boolean().optional(),
    is_active: z.boolean().optional(),
  }),
});

export const DELETE = deleteRouteOCC({
  schema: 'inventory',
  table: 'assignment_types',
  segment: 'assignment-types',
  entityLabel: 'assignment type',
  bodySchema: z.object({ expected_last_event_id: z.string().min(1) }),
});
