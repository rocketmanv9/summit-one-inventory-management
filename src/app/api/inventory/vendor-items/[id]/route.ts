import { z } from 'zod';
import { updateRouteOCC, deleteRouteOCC } from '@/lib/api/typed-crud';

// vendor_items real table lives in supply_chain (inventory.vendor_items is a view).
export const PATCH = updateRouteOCC({
  schema: 'supply_chain',
  table: 'vendor_items',
  segment: 'vendor-items',
  bodySchema: z.object({ expected_last_event_id: z.string().min(1) }).passthrough(),
  // Marking an item's vendor as preferred is gated; other edits aren't.
  requireCapability: { capability: 'vendors.preferred', when: (b) => b?.is_preferred === true },
});

export const DELETE = deleteRouteOCC({
  schema: 'supply_chain',
  table: 'vendor_items',
  segment: 'vendor-items',
  entityLabel: 'vendor item',
  bodySchema: z.object({ expected_last_event_id: z.string().min(1) }),
});
