import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('buyable-groups') + 1];
  if (!id) throw AppError.badRequest('Missing buyable group id');
  return z.string().uuid().parse(id);
}

const GroupItemSchema = z.object({
  catalog_item_id: z.string().uuid(),
  default_qty: z.number().int().positive().max(100000).optional(),
  preferred_vendor_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().optional(),
});

const UpdateGroupSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  allowed_positions: z.array(z.string().min(1).max(200)).max(200).optional(),
  active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  // When present, replaces the group's item set wholesale (add/remove/reorder).
  // Omit to leave items untouched (e.g. a rename or reorder of the group only).
  items: z.array(GroupItemSchema).max(500).optional(),
});

// Edit a group (incl. deactivate via active:false) and, when `items` is present,
// replace its item set wholesale. Groups are config, not transactional records,
// so a delete + re-insert of the child rows is the simplest correct edit.
export const PATCH = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const id = extractId(req);
  const body = UpdateGroupSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;

  const sc = (supabase as any).schema('supply_chain');

  const updates: Record<string, unknown> = { last_event_id: idempotencyKey, updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(body)) {
    if (k === 'items') continue;
    if (v !== undefined) updates[k] = v;
  }

  const { data: group, error } = await sc
    .from('buyable_item_groups')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('*')
    .maybeSingle();
  if (error) { log.error('buyable_groups.update_failed', { error: error.message }); throw AppError.internal(error.message); }
  if (!group) throw AppError.notFound('Buyable group not found');

  if (body.items) {
    const { error: delErr } = await sc
      .from('buyable_item_group_items')
      .delete()
      .eq('group_id', id)
      .eq('tenant_id', tenantId);
    if (delErr) { log.error('buyable_groups.items_clear_failed', { error: delErr.message }); throw AppError.internal(delErr.message); }

    if (body.items.length > 0) {
      const rows = body.items.map((it, idx) => ({
        tenant_id: tenantId,
        group_id: id,
        catalog_item_id: it.catalog_item_id,
        default_qty: it.default_qty ?? 1,
        preferred_vendor_id: it.preferred_vendor_id ?? null,
        sort_order: it.sort_order ?? idx,
        last_event_id: crypto.randomUUID(),
      }));
      const { error: insErr } = await sc
        .from('buyable_item_group_items')
        .upsert(rows, { onConflict: 'group_id,catalog_item_id' });
      if (insErr) { log.error('buyable_groups.items_insert_failed', { error: insErr.message }); throw AppError.internal(insErr.message); }
    }
  }

  return {
    data: group,
    status: 200,
    events: [{
      event_name: 'buyable_item_group.updated',
      payload: { id: group.id, name: group.name, active: group.active },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/buyable-groups/[id]' });

// Soft-delete: deactivate the group.
export const DELETE = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const id = extractId(req);
  const tenantId = ctx.tenantId!;

  const sc = (supabase as any).schema('supply_chain');
  const { data, error } = await sc
    .from('buyable_item_groups')
    .update({ active: false, last_event_id: idempotencyKey, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id, name')
    .maybeSingle();
  if (error) { log.error('buyable_groups.delete_failed', { error: error.message }); throw AppError.internal(error.message); }
  if (!data) throw AppError.notFound('Buyable group not found');

  return {
    data,
    status: 200,
    events: [{
      event_name: 'buyable_item_group.deactivated',
      payload: { id: data.id, name: data.name },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/buyable-groups/[id]' });
