import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { assertCapability } from '@/lib/access-server';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Set or deactivate a per-person PO approver override (sprint 2026-08-14 item
// 02 — the resolver's new tier 1). One override per buyer per tenant; setting a
// new approver for a buyer replaces their existing row (upsert), deactivating
// keeps the row for the audit trail.
const BodySchema = z.object({
  buyer_user_id: z.string().uuid(),
  // Required when activating; ignored when active=false.
  approver_user_id: z.string().uuid().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  // false = deactivate the buyer's override (fall back to the normal tiers).
  active: z.boolean().optional().default(true),
});

/**
 * POST /api/inventory/purchasing/approver-overrides — upsert or deactivate the
 * per-person approver override that resolve_po_approval_route consults FIRST.
 * Admin/`vendors.manage`-gated (same gate as the location override editor).
 *
 * Guards mirror the resolver's own: both sides must be real users in this
 * tenant, and a buyer can never be their own approver. This edits tier-1 input
 * only — resolution logic lives in the DB function.
 */
export const POST = createSessionWriteRoute(async ({ ctx, body, supabase, idempotencyKey, log }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'vendors.manage');
  const { buyer_user_id, approver_user_id, note, active } = body as z.infer<typeof BodySchema>;
  const sc = (supabase as any).schema('supply_chain');

  if (!active) {
    // Deactivate — the buyer drops back to the normal routing tiers.
    const { data, error } = await sc
      .from('po_approver_overrides')
      .update({ active: false, updated_at: new Date().toISOString(), last_event_id: idempotencyKey })
      .eq('tenant_id', ctx.tenantId!)
      .eq('buyer_user_id', buyer_user_id)
      .select('id, buyer_user_id, approver_user_id, active')
      .maybeSingle();
    if (error) {
      log.error('approver_overrides.deactivate_failed', { error: error.message });
      throw AppError.internal(error.message);
    }
    if (!data) throw AppError.notFound('No override exists for this buyer.');
    return {
      data,
      status: 200,
      events: [{
        event_name: 'po_approver_override.deactivated',
        payload: { override_id: data.id, buyer_user_id },
        last_event_id: idempotencyKey,
      }],
    };
  }

  if (!approver_user_id) throw AppError.badRequest('approver_user_id is required to set an override.');
  if (approver_user_id === buyer_user_id) {
    throw AppError.badRequest('A buyer cannot be their own approver — pick someone else.');
  }

  // Both sides must be real users in this tenant (never route to a dead id).
  const { data: pair } = await supabase
    .from('local_users')
    .select('user_id')
    .eq('tenant_id', ctx.tenantId!)
    .in('user_id', [buyer_user_id, approver_user_id])
    .limit(2);
  if ((pair ?? []).length !== 2) {
    throw AppError.badRequest('Buyer and approver must both be users in this organization.');
  }

  const { data, error } = await sc
    .from('po_approver_overrides')
    .upsert(
      {
        tenant_id: ctx.tenantId!,
        buyer_user_id,
        approver_user_id,
        note: note || null,
        active: true,
        created_by_user_id: ctx.userId!,
        updated_at: new Date().toISOString(),
        last_event_id: idempotencyKey,
      },
      { onConflict: 'tenant_id,buyer_user_id' },
    )
    .select('id, buyer_user_id, approver_user_id, note, active')
    .single();
  if (error) {
    log.error('approver_overrides.upsert_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return {
    data,
    status: 201,
    events: [{
      event_name: 'po_approver_override.upserted',
      payload: { override_id: data.id, buyer_user_id, approver_user_id },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: BodySchema, serviceName: SERVICE_NAME, scope: 'POST /api/inventory/purchasing/approver-overrides' });
