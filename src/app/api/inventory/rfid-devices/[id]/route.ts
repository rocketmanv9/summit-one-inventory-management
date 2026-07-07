import { z } from 'zod';
import { updateRouteOCC } from '@/lib/api/typed-crud';

/**
 * PATCH /api/inventory/rfid-devices/[id]
 * Device lifecycle + installation management from the Device Management tab:
 * rename, suspend/re-enable/retire, and set the installed location.
 * Claiming stays on rpc_claim_device (needs the claim-code flow).
 */
export const PATCH = updateRouteOCC({
  schema: 'inventory',
  table: 'rfid_devices',
  segment: 'rfid-devices',
  bodySchema: z.object({
    expected_last_event_id: z.string().min(1),
    name: z.string().min(1).optional(),
    status: z.enum(['active', 'suspended', 'disabled', 'retired']).optional(),
    installed_location_id: z.string().uuid().nullish(),
    installation_notes: z.string().nullish(),
  }),
});
