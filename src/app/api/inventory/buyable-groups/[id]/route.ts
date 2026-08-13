import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';
import { rethrowDeleteError } from '@/lib/api/typed-crud';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('buyable-groups') + 1];
  if (!id) throw AppError.badRequest('Missing buyable group id');
  return z.string().uuid().parse(id);
}

// Item 02 fulfillment fields — see /buyable-groups (POST) for the contract.
const GroupItemSchema = z.object({
  catalog_item_id: z.string().uuid(),
  default_qty: z.number().int().positive().max(100000).optional(),
  preferred_vendor_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().optional(),
  fulfillment_kind: z.enum(['catalog', 'vendor_item', 'external_link']).optional(),
  external_url: z.string().url().max(2000).nullable().optional(),
  link_label: z.string().max(200).nullable().optional(),
  vendor_item_id: z.string().uuid().nullable().optional(),
}).superRefine((it, ctx) => {
  if (it.fulfillment_kind === 'vendor_item' && !it.vendor_item_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'vendor_item fulfillment requires vendor_item_id' });
  }
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
    // Diff-upsert instead of the old delete-all + re-insert: per-person link
    // overrides (buyable_item_person_links, item 02) cascade off group-item ids,
    // so wiping the child rows on every edit would silently destroy everyone's
    // Canva links. Upserting on (group_id, catalog_item_id) keeps surviving
    // rows' ids stable; only items actually REMOVED from the group are deleted
    // (their person links go with them, which is the intent).
    const { data: existing, error: exErr } = await sc
      .from('buyable_item_group_items')
      .select('id, catalog_item_id, fulfillment_kind, external_url, link_label, vendor_item_id')
      .eq('group_id', id)
      .eq('tenant_id', tenantId)
      .limit(1000);
    if (exErr) { log.error('buyable_groups.items_read_failed', { error: exErr.message }); throw AppError.internal(exErr.message); }
    const existingByCatalog = new Map<string, any>((existing ?? []).map((r: any) => [r.catalog_item_id, r]));

    const nextIds = new Set(body.items.map((it) => it.catalog_item_id));
    const removeIds = (existing ?? []).filter((r: any) => !nextIds.has(r.catalog_item_id)).map((r: any) => r.id);
    if (removeIds.length > 0) {
      const { error: delErr } = await sc
        .from('buyable_item_group_items')
        .delete()
        .in('id', removeIds)
        .eq('tenant_id', tenantId);
      if (delErr) { log.error('buyable_groups.items_clear_failed', { error: delErr.message }); rethrowDeleteError(delErr, 'group item'); }
    }

    if (body.items.length > 0) {
      const rows = body.items.map((it, idx) => {
        // Fulfillment fields: ABSENT means "leave as-is" (pre-item-03 editors
        // don't send them — they must not reset a link item back to catalog);
        // present (incl. explicit null) means "set".
        const prev = existingByCatalog.get(it.catalog_item_id);
        return {
          tenant_id: tenantId,
          group_id: id,
          catalog_item_id: it.catalog_item_id,
          default_qty: it.default_qty ?? 1,
          preferred_vendor_id: it.preferred_vendor_id ?? null,
          sort_order: it.sort_order ?? idx,
          fulfillment_kind: it.fulfillment_kind !== undefined ? it.fulfillment_kind : prev?.fulfillment_kind ?? 'catalog',
          external_url: it.external_url !== undefined ? it.external_url : prev?.external_url ?? null,
          link_label: it.link_label !== undefined ? it.link_label : prev?.link_label ?? null,
          vendor_item_id: it.vendor_item_id !== undefined ? it.vendor_item_id : prev?.vendor_item_id ?? null,
          last_event_id: crypto.randomUUID(),
        };
      });
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
