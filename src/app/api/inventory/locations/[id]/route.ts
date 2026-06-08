import { z } from 'zod';
import { updateRouteOCC, deleteRouteOCC } from '@/lib/api/typed-crud';

export const PATCH = updateRouteOCC({
  schema: 'inventory',
  table: 'locations',
  segment: 'locations',
  returning: '*, location_type:location_type_id(name)',
  bodySchema: z.object({ expected_last_event_id: z.string().min(1) }).passthrough(),
});

export const DELETE = deleteRouteOCC({
  schema: 'inventory',
  table: 'locations',
  segment: 'locations',
  entityLabel: 'location',
  bodySchema: z.object({ expected_last_event_id: z.string().min(1) }),
});
