import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Targeted position↔group membership toggle for the buying-access matrix
// (item 02, tyler-ideas sprint). The matrix flips ONE cell at a time; doing the
// add/remove server-side (read-modify-write against the CURRENT array) means two
// admins toggling different cells of the same group concurrently don't clobber
// each other the way a wholesale allowed_positions PATCH would.

function extractGroupId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('buyable-groups') + 1];
  if (!id) throw AppError.badRequest('Missing buyable group id');
  return z.string().uuid().parse(id);
}

const ToggleSchema = z.object({
  position_title: z.string().min(1).max(200),
  allowed: z.boolean(),
});

// POST /api/inventory/buyable-groups/[id]/membership
//   { position_title, allowed } → adds/removes that HR position title in the
//   group's allowed_positions. Idempotent by nature (adding a present title or
//   removing an absent one is a no-op). Admin-gated like all group CRUD.
export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const groupId = extractGroupId(req);
  const body = ToggleSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;

  const sc = (supabase as any).schema('supply_chain');
  const { data: group, error: gErr } = await sc
    .from('buyable_item_groups')
    .select('id, name, allowed_positions')
    .eq('id', groupId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (gErr) { log.error('buyable_groups.membership_read_failed', { error: gErr.message }); throw AppError.internal(gErr.message); }
  if (!group) throw AppError.notFound('Buyable group not found');

  const current: string[] = Array.isArray(group.allowed_positions) ? group.allowed_positions : [];
  const next = body.allowed
    ? (current.includes(body.position_title) ? current : [...current, body.position_title])
    : current.filter((t) => t !== body.position_title);

  const { data: updated, error: uErr } = await sc
    .from('buyable_item_groups')
    .update({ allowed_positions: next, last_event_id: idempotencyKey, updated_at: new Date().toISOString() })
    .eq('id', groupId)
    .eq('tenant_id', tenantId)
    .select('id, name, allowed_positions, active')
    .maybeSingle();
  if (uErr) { log.error('buyable_groups.membership_update_failed', { error: uErr.message }); throw AppError.internal(uErr.message); }
  if (!updated) throw AppError.notFound('Buyable group not found');

  return {
    data: updated,
    status: 200,
    events: [{
      event_name: 'buyable_item_group.membership_toggled',
      payload: { id: updated.id, name: updated.name, position_title: body.position_title, allowed: body.allowed },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/buyable-groups/[id]/membership' });
