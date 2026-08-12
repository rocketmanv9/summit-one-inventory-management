import { z } from 'zod';
import { deleteRouteOCC } from '@/lib/api/typed-crud';

export const DELETE = deleteRouteOCC({
  schema: 'inventory',
  table: 'negative_inventory_config',
  segment: 'negative-inventory',
  entityLabel: 'negative-inventory rule',
  bodySchema: z.object({ expected_last_event_id: z.string().min(1) }),
});
