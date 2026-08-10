import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { assertCapability } from '@/lib/access-server';
import { idFromPath } from '@/lib/api/typed-crud';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Set (uuid) or clear (null) the per-location PO approver override. A focused
// editor deliberately separate from the address-gated locations PATCH — this
// touches one column and shouldn't drag in address/ZIP validation.
const BodySchema = z.object({
  po_approver_user_id: z.string().uuid().nullable(),
  expected_last_event_id: z.string().min(1),
});

/**
 * PATCH /api/inventory/locations/[id]/po-approver — set or clear a location's
 * PO approver override (sprint item 10, the natural editing home for the
 * approval-flow settings page). Admin/`vendors.manage`-gated; optimistic
 * concurrency via expected_last_event_id. The inventory.locations update
 * trigger owns the location.updated emission, so this returns events: [].
 *
 * This edits the resolver's step-1 input only — it does not change resolution
 * logic. Clearing the override drops the location back to the default path
 * (buyer's supervisor → admins).
 */
export const PATCH = createSessionWriteRoute(async ({ req, ctx, body, supabase, idempotencyKey, log }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'vendors.manage');
  const id = idFromPath(req, 'locations');
  const { po_approver_user_id, expected_last_event_id } = body as z.infer<typeof BodySchema>;

  // A set approver must be a real user in this tenant (and not the "pending
  // sync" sentinel) — otherwise the location would route to a dead id.
  if (po_approver_user_id) {
    const { data: approver } = await supabase
      .from('local_users')
      .select('user_id')
      .eq('tenant_id', ctx.tenantId!)
      .eq('user_id', po_approver_user_id)
      .maybeSingle();
    if (!approver) throw AppError.badRequest('Chosen approver is not a user in this organization.');
  }

  const { data, error } = await (supabase as any)
    .schema('inventory')
    .from('locations')
    .update({ po_approver_user_id, last_event_id: idempotencyKey })
    .eq('id', id)
    .eq('last_event_id', expected_last_event_id)
    .select('id, name, po_approver_user_id, last_event_id')
    .maybeSingle();
  if (error) {
    log.error('locations.po_approver_update_failed', { error: error.message });
    throw AppError.internal(error.message);
  }
  if (!data) throw AppError.conflict('Location was updated by someone else. Please refresh and try again.');

  // The inventory.locations UPDATE trigger emits location.updated for us.
  return { data, status: 200, events: [] };
}, { bodySchema: BodySchema, emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/locations/[id]/po-approver' });
