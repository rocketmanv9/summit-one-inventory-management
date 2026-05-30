import { z } from 'zod';
import { deleteRouteOCC } from '@/lib/api/typed-crud';

export const DELETE = deleteRouteOCC({
  schema: 'inventory',
  table: 'uom_conversions',
  segment: 'uom-conversions',
  bodySchema: z.object({ expected_last_event_id: z.string().min(1) }),
});
