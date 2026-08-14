import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';
import { rethrowDeleteError } from '@/lib/api/typed-crud';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('position-kits') + 1];
  if (!id) throw AppError.badRequest('Missing position kit id');
  return z.string().uuid().parse(id);
}

const KitItemSchema = z.object({
  catalog_item_id: z.string().uuid(),
  qty: z.number().int().positive().max(10000),
  preferred_vendor_id: z.string().uuid().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  sort_order: z.number().int().optional(),
});

const UpdateKitSchema = z.object({
  location_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
  order_mode: z.enum(['draft', 'auto_submit']).optional(),
  // When present, replaces the kit's line set wholesale (add/remove/reorder).
  // Omit to leave lines untouched (e.g. an active toggle from the card).
  items: z.array(KitItemSchema).max(200).optional(),
});

// Edit a kit — including the active toggle, which is how a kit is retired and
// brought back (deactivate/reactivate rather than delete, so item 04's audit
// trail keeps pointing at a row that still exists).
export const PATCH = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const id = extractId(req);
  const body = UpdateKitSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;
  const sc = (supabase as any).schema('supply_chain');

  const updates: Record<string, unknown> = { last_event_id: idempotencyKey, updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(body)) {
    if (k === 'items') continue;
    if (v !== undefined) updates[k] = v;
  }

  const { data: kit, error } = await sc
    .from('position_kits')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('*')
    .maybeSingle();
  if (error) {
    if ((error as any).code === '23505') {
      throw AppError.conflict('A kit already exists for that position and location scope');
    }
    log.error('position_kits.update_failed', { error: error.message });
    throw AppError.internal(error.message);
  }
  if (!kit) throw AppError.notFound('Position kit not found');

  if (body.items) {
    // Diff-upsert on (kit_id, catalog_item_id) rather than delete-all +
    // re-insert: line ids stay stable across edits, so anything item 04 later
    // hangs off a line (issued/ordered tracking) survives a qty tweak.
    const { data: existing, error: exErr } = await sc
      .from('position_kit_items')
      .select('id, catalog_item_id')
      .eq('kit_id', id)
      .eq('tenant_id', tenantId)
      .limit(1000);
    if (exErr) { log.error('position_kits.items_read_failed', { error: exErr.message }); throw AppError.internal(exErr.message); }

    const nextIds = new Set(body.items.map((it) => it.catalog_item_id));
    const removeIds = (existing ?? []).filter((r: any) => !nextIds.has(r.catalog_item_id)).map((r: any) => r.id);
    if (removeIds.length > 0) {
      const { error: delErr } = await sc
        .from('position_kit_items')
        .delete()
        .in('id', removeIds)
        .eq('tenant_id', tenantId);
      if (delErr) { log.error('position_kits.items_clear_failed', { error: delErr.message }); rethrowDeleteError(delErr, 'kit item'); }
    }

    if (body.items.length > 0) {
      const rows = body.items.map((it, idx) => ({
        tenant_id: tenantId,
        kit_id: id,
        catalog_item_id: it.catalog_item_id,
        qty: it.qty,
        preferred_vendor_id: it.preferred_vendor_id ?? null,
        note: it.note ?? null,
        sort_order: it.sort_order ?? idx,
        updated_at: new Date().toISOString(),
        last_event_id: crypto.randomUUID(),
      }));
      const { error: insErr } = await sc
        .from('position_kit_items')
        .upsert(rows, { onConflict: 'kit_id,catalog_item_id' });
      if (insErr) { log.error('position_kits.items_insert_failed', { error: insErr.message }); throw AppError.internal(insErr.message); }
    }
  }

  return {
    data: kit,
    status: 200,
    events: [{
      event_name: 'position_kit.updated',
      payload: { id: kit.id, name: kit.name, active: kit.active },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/position-kits/[id]' });

// Soft-delete: deactivate.
export const DELETE = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const id = extractId(req);
  const tenantId = ctx.tenantId!;
  const sc = (supabase as any).schema('supply_chain');

  const { data, error } = await sc
    .from('position_kits')
    .update({ active: false, last_event_id: idempotencyKey, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id, name')
    .maybeSingle();
  if (error) { log.error('position_kits.delete_failed', { error: error.message }); throw AppError.internal(error.message); }
  if (!data) throw AppError.notFound('Position kit not found');

  return {
    data,
    status: 200,
    events: [{
      event_name: 'position_kit.deactivated',
      payload: { id: data.id, name: data.name },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/position-kits/[id]' });
